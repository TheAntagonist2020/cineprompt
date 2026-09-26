// /api/chat — talk to Claude with Dalton's whole film memory loaded.
//
//   GET    /api/chat          -> { conversations: [{ id, title, updated_at }] }
//   GET    /api/chat?id=X     -> { id, title, messages: [{ role, content, created_at }] }
//   POST   /api/chat          body { conversation_id?, message }
//                             -> text/event-stream: meta {conversation_id, title},
//                                delta {text}..., done {usage}, or error {message}
//   DELETE /api/chat?id=X     -> { ok: true }
//
// The memory (data/memory.txt, built from data.json by script/film-memory.ts)
// is the first system block with a 1-hour cache breakpoint, so a conversation
// pays to load it once per hour and a fraction of that per message after.
// Conversations live in D1 so they follow Dalton between the phone and the TV.
// Requires the ANTHROPIC_API_KEY secret on the Pages project (see DEPLOY.md).
import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-opus-5";
const MAX_HISTORY = 100;
const MAX_MESSAGE_CHARS = 20_000;

export const PERSONA = `You are Claude, talking with Dalton inside Cineprompt, the personal film app built around their Letterboxd diary. Movies are close to the center of Dalton's life, so treat this as a conversation with someone who has lived in the dark of a theater for years, not as a lookup service.

Below this note is Dalton's film memory: every film they have logged, with watch dates, star ratings, their own Letterboxd tags (where they saw it, who with, which marathon) and the opening of their own reviews. You have read all of it. Talk like a friend who has seen everything they have seen and read every word they wrote: specific, candid, warm, and never generic. Bring in their own films, dates, ratings and words when they matter, and disagree with them when you do.

When a question is about their history or habits (counts, streaks, eras, directors, how their taste moved), work it out from the memory and say how you counted. Be straight about what the memory cannot show: watches that never reached the diary, anything after the build date at the top, feelings they never wrote down. Recommend with the same care: explain why a film fits them in particular, and prefer films the memory shows they have not logged.

Keep replies conversational. Use lists or tables only when they genuinely help. Latency matters here, so begin the visible answer promptly.`;

let memoryCache: Promise<string> | null = null;

export function loadMemory(context: any): Promise<string> {
  if (!memoryCache) {
    memoryCache = (async () => {
      const url = new URL("/data/memory.txt", context.request.url);
      const r = await context.env.ASSETS.fetch(new Request(url));
      if (!r.ok) throw new Error(`film memory unavailable (${r.status})`);
      return await r.text();
    })();
    memoryCache.catch(() => {
      memoryCache = null;
    });
  }
  return memoryCache;
}

// ---------------------------------------------------------------- shared ---
// Talk and the Log app send the same first system block, so a review drafted
// right after a conversation (or the other way round) reads the memory from
// the same cache entry. Keep the request settings identical for the same reason.

export function memoryBlock(memory: string): Anthropic.Beta.BetaTextBlockParam {
  return { type: "text", text: `${PERSONA}\n\n${memory}`, cache_control: { type: "ephemeral", ttl: "1h" } };
}

export function claudeClient(env: any): Anthropic {
  // ANTHROPIC_BASE_URL is optional: a Cloudflare AI Gateway URL, or a local stub.
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, baseURL: env.ANTHROPIC_BASE_URL || undefined });
}

export const REQUEST = {
  model: MODEL,
  max_tokens: 16000,
  betas: ["server-side-fallback-2026-07-01"],
  fallbacks: "default",
  thinking: { type: "adaptive" },
  output_config: { effort: "medium" },
} as const;

/** An SSE response whose writes never block or throw once the browser leaves. */
export function sseChannel() {
  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  let open = true;
  const send = (event: string, data: unknown) => {
    if (!open) return;
    writer.write(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)).catch(() => {
      open = false;
    });
  };
  const close = () => writer.close().catch(() => {});
  const response = new Response(readable, {
    headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform" },
  });
  return { send, close, response };
}

/** Stream Claude's text to `send` as delta events, then done or error. Returns the text. */
export async function streamReply(
  client: Anthropic,
  params: { system: Anthropic.Beta.BetaTextBlockParam[]; messages: Anthropic.Beta.BetaMessageParam[] },
  send: (event: string, data: unknown) => void,
): Promise<string> {
  let text = "";
  try {
    const s = client.beta.messages.stream({ ...REQUEST, betas: [...REQUEST.betas], ...params });
    for await (const event of s) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        text += event.delta.text;
        send("delta", { text: event.delta.text });
      }
    }
    const final = await s.finalMessage();
    if (final.stop_reason === "refusal") {
      send("error", { message: "Claude declined to answer that one." });
    } else {
      const u = final.usage;
      send("done", {
        stop_reason: final.stop_reason,
        usage: {
          input: u.input_tokens,
          cache_read: u.cache_read_input_tokens,
          cache_write: u.cache_creation_input_tokens,
          output: u.output_tokens,
        },
      });
    }
  } catch (e: any) {
    const msg =
      e instanceof Anthropic.AuthenticationError
        ? "The Anthropic API key was rejected."
        : e instanceof Anthropic.RateLimitError
          ? "Rate limited by the Anthropic API; try again in a minute."
          : e instanceof Anthropic.APIError
            ? `Anthropic API error ${e.status ?? ""}: ${e.message}`
            : (e?.message ?? "request failed");
    send("error", { message: msg });
  }
  return text;
}

let schemaReady: Promise<void> | null = null;

function ensureChatSchema(db: any): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await db.batch([
        db.prepare(
          `CREATE TABLE IF NOT EXISTS chat_conversations (
             id         TEXT PRIMARY KEY,
             title      TEXT NOT NULL,
             created_at INTEGER NOT NULL,
             updated_at INTEGER NOT NULL
           )`,
        ),
        db.prepare(
          `CREATE TABLE IF NOT EXISTS chat_messages (
             id              INTEGER PRIMARY KEY AUTOINCREMENT,
             conversation_id TEXT NOT NULL,
             role            TEXT NOT NULL,
             content         TEXT NOT NULL,
             created_at      INTEGER NOT NULL
           )`,
        ),
        db.prepare(
          "CREATE INDEX IF NOT EXISTS idx_chat_messages_conv ON chat_messages(conversation_id, id)",
        ),
      ]);
    })();
    schemaReady.catch(() => {
      schemaReady = null;
    });
  }
  return schemaReady;
}

export function jsonError(status: number, msg: string) {
  return Response.json({ error: msg }, { status });
}

// Today's date where Dalton lives; day granularity keeps it stable for caching.
export function today(env: any): string {
  const tz = env.USER_TZ || "America/Chicago";
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, dateStyle: "full" }).format(new Date());
}

// What the app knows right now that the build-time memory may not: the
// shortlist and anything marked watched in the app since the last rebuild.
async function liveState(db: any): Promise<string> {
  try {
    const { results } = await db
      .prepare(
        `SELECT title, year, status, notes, updated_at FROM film_state
         WHERE status IN ('shortlist', 'watched') AND title IS NOT NULL
         ORDER BY updated_at DESC LIMIT 60`,
      )
      .all();
    const rows = (results ?? []) as any[];
    const fmt = (r: any) => `${r.title}${r.year ? ` (${r.year})` : ""}${r.notes ? ` — note: ${r.notes}` : ""}`;
    const shortlist = rows.filter((r) => r.status === "shortlist").map(fmt);
    const watched = rows.filter((r) => r.status === "watched").slice(0, 20).map(fmt);
    const out: string[] = [];
    if (shortlist.length) out.push(`On Dalton's shortlist in the app: ${shortlist.join("; ")}.`);
    if (watched.length) out.push(`Recently marked watched in the app (may not be in the diary yet): ${watched.join("; ")}.`);
    return out.join("\n");
  } catch {
    return "";
  }
}

export const onRequestGet = async (context: any) => {
  const db = context.env.DB;
  await ensureChatSchema(db);
  const id = new URL(context.request.url).searchParams.get("id");
  if (!id) {
    const { results } = await db
      .prepare("SELECT id, title, updated_at FROM chat_conversations ORDER BY updated_at DESC LIMIT 100")
      .all();
    return Response.json({ conversations: results ?? [] });
  }
  const conv = await db.prepare("SELECT id, title FROM chat_conversations WHERE id = ?").bind(id).first();
  if (!conv) return jsonError(404, "no such conversation");
  const { results } = await db
    .prepare("SELECT role, content, created_at FROM chat_messages WHERE conversation_id = ? ORDER BY id")
    .bind(id)
    .all();
  return Response.json({ ...conv, messages: results ?? [] });
};

export const onRequestDelete = async (context: any) => {
  const db = context.env.DB;
  await ensureChatSchema(db);
  const id = new URL(context.request.url).searchParams.get("id");
  if (!id) return jsonError(400, "id is required");
  await db.batch([
    db.prepare("DELETE FROM chat_messages WHERE conversation_id = ?").bind(id),
    db.prepare("DELETE FROM chat_conversations WHERE id = ?").bind(id),
  ]);
  return Response.json({ ok: true });
};

export const onRequestPost = async (context: any) => {
  const { env, request } = context;
  if (!env.ANTHROPIC_API_KEY) {
    return jsonError(502, "ANTHROPIC_API_KEY is not configured on the Pages project (see DEPLOY.md)");
  }
  const body = await request.json().catch(() => null);
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!message) return jsonError(400, "message is required");
  if (message.length > MAX_MESSAGE_CHARS) return jsonError(413, "message is too long");

  const db = env.DB;
  await ensureChatSchema(db);

  let memory: string;
  try {
    memory = await loadMemory(context);
  } catch (e: any) {
    return jsonError(503, e?.message ?? "film memory unavailable");
  }

  const now = Date.now();
  let conversationId: string = typeof body?.conversation_id === "string" ? body.conversation_id : "";
  let title: string;
  if (conversationId) {
    const conv = await db
      .prepare("SELECT title FROM chat_conversations WHERE id = ?")
      .bind(conversationId)
      .first();
    if (!conv) return jsonError(404, "no such conversation");
    title = conv.title;
  } else {
    conversationId = crypto.randomUUID();
    title = message.replace(/\s+/g, " ").slice(0, 80);
    await db
      .prepare("INSERT INTO chat_conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)")
      .bind(conversationId, title, now, now)
      .run();
  }

  const { results: prior } = await db
    .prepare(
      `SELECT role, content FROM (
         SELECT id, role, content FROM chat_messages WHERE conversation_id = ? ORDER BY id DESC LIMIT ?
       ) ORDER BY id`,
    )
    .bind(conversationId, MAX_HISTORY)
    .all();

  await db.batch([
    db
      .prepare("INSERT INTO chat_messages (conversation_id, role, content, created_at) VALUES (?, 'user', ?, ?)")
      .bind(conversationId, message, now),
    db.prepare("UPDATE chat_conversations SET updated_at = ? WHERE id = ?").bind(now, conversationId),
  ]);

  const history: Anthropic.Beta.BetaMessageParam[] = [];
  for (const m of (prior ?? []) as any[]) {
    const role = m.role === "assistant" ? "assistant" : "user";
    // A turn that failed mid-stream can leave two user messages in a row;
    // merge them so roles keep alternating.
    const last = history.at(-1);
    if (last && last.role === role && typeof last.content === "string") {
      last.content += `\n\n${m.content}`;
    } else {
      history.push({ role, content: m.content });
    }
  }
  if (history.length && history[0].role === "assistant") history.shift();
  const last = history.at(-1);
  if (last?.role === "user" && typeof last.content === "string") {
    last.content += `\n\n${message}`;
  } else {
    history.push({ role: "user", content: message });
  }
  // Cache the conversation so far for the next turn.
  const tail = history.at(-1)!;
  tail.content = [
    { type: "text", text: tail.content as string, cache_control: { type: "ephemeral" } },
  ];

  const live = await liveState(db);
  const system: Anthropic.Beta.BetaTextBlockParam[] = [
    memoryBlock(memory),
    { type: "text", text: [`Today is ${today(env)}.`, live].filter(Boolean).join("\n") },
  ];

  const client = claudeClient(env);
  const { send, close, response } = sseChannel();

  const run = async () => {
    send("meta", { conversation_id: conversationId, title });
    try {
      // The reply is saved even when the browser has gone away mid-stream.
      const reply = await streamReply(client, { system, messages: history }, send);
      if (reply.trim()) {
        const at = Date.now();
        await db.batch([
          db
            .prepare(
              "INSERT INTO chat_messages (conversation_id, role, content, created_at) VALUES (?, 'assistant', ?, ?)",
            )
            .bind(conversationId, reply, at),
          db.prepare("UPDATE chat_conversations SET updated_at = ? WHERE id = ?").bind(at, conversationId),
        ]);
      }
    } finally {
      close();
    }
  };
  context.waitUntil(run());
  return response;
};
