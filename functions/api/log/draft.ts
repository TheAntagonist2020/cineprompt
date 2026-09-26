// /api/log/draft — Claude drafts a Letterboxd review in Dalton's own voice.
//
//   POST body { entry: { title, year?, stars?, rewatch?, liked?, watched_on?, tags?, notes? },
//               length?: "line" | "paragraph" | "full", previous?, instruction? }
//     -> text/event-stream: delta {text}..., done {usage} | error {message}
//
// Same cached memory block as Talk, so the voice comes from every review they
// have written. Nothing is saved here; the Log app saves the edited draft.

import { claudeClient, jsonError, loadMemory, memoryBlock, sseChannel, streamReply, today } from "../chat";

const LENGTHS: Record<string, string> = {
  line: "One or two sentences. The kind of quick, punchy entry they write when a film just hit or just missed.",
  paragraph: "One paragraph, roughly three to six sentences.",
  full: "A full review: several paragraphs, like the longest, most considered reviews in the memory.",
};

const DRAFTING = `Right now you are not chatting. You are drafting a Letterboxd review that Dalton will post as their own, so it has to sound like them and say what they think.

Voice: learn it from their reviews in the memory, especially the recent ones. Match their rhythm, vocabulary, casing, punctuation, humor and the way they open. Don't sand it into generic critic prose, and don't imitate a single review word for word.

Substance: build it only from what they told you below: stars, rewatch, where and who with, and their notes. Never invent a reaction, a scene, a plot point or a personal detail they didn't give you. Many films are newer than your training, so describe the film itself only as far as their notes do. You may add a fact you are certain of (the director, a lead actor) and a connection to their own history in the memory: an earlier watch of this film, the director's other films they rated, a tag that recurs.

Output only the review text, as plain text: no markdown (Letterboxd shows asterisks and pound signs literally), no title, no stars, no quotation marks around it, no preface or sign-off. Separate paragraphs with a blank line.`;

function describe(entry: any): string {
  const lines = [`Film: ${entry.title}${entry.year ? ` (${entry.year})` : ""}`];
  if (typeof entry.stars === "number") lines.push(`Stars: ${entry.stars} out of 5`);
  if (entry.rewatch) lines.push("Rewatch: yes");
  if (entry.liked) lines.push("Liked: yes (heart)");
  if (entry.watched_on) lines.push(`Watched on: ${entry.watched_on}`);
  if (Array.isArray(entry.tags) && entry.tags.length) lines.push(`Tags: ${entry.tags.join(", ")}`);
  const notes = typeof entry.notes === "string" ? entry.notes.trim() : "";
  lines.push(notes ? `What they said about it:\n${notes}` : "They gave no notes, only the details above.");
  return lines.join("\n");
}

export const onRequestPost = async (context: any) => {
  const { env, request } = context;
  if (!env.ANTHROPIC_API_KEY) {
    return jsonError(502, "ANTHROPIC_API_KEY is not configured on the Pages project (see DEPLOY.md)");
  }
  const body = await request.json().catch(() => null);
  const entry = body?.entry;
  if (!entry || typeof entry.title !== "string" || !entry.title.trim()) return jsonError(400, "entry.title is required");
  if (typeof entry.notes === "string" && entry.notes.length > 20_000) return jsonError(413, "notes are too long");
  const length = LENGTHS[body?.length] ? body.length : "paragraph";

  let memory: string;
  try {
    memory = await loadMemory(context);
  } catch (e: any) {
    return jsonError(503, e?.message ?? "film memory unavailable");
  }

  let ask = `${describe(entry)}\n\nLength: ${LENGTHS[length]}`;
  const previous = typeof body?.previous === "string" ? body.previous.trim().slice(0, 20_000) : "";
  const instruction = typeof body?.instruction === "string" ? body.instruction.trim().slice(0, 2_000) : "";
  if (previous) {
    ask += `\n\nYour previous draft was:\n${previous}\n\nWrite a new version. ${
      instruction ? `Their direction: ${instruction}` : "Take a different angle; keep what they said."
    }`;
  }

  const system = [
    memoryBlock(memory),
    { type: "text" as const, text: `Today is ${today(env)}.\n\n${DRAFTING}` },
  ];

  const { send, close, response } = sseChannel();
  const run = async () => {
    try {
      await streamReply(claudeClient(env), { system, messages: [{ role: "user", content: ask }] }, send);
    } finally {
      close();
    }
  };
  context.waitUntil(run());
  return response;
};
