import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowUp, MessageCircle, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Msg = { role: "user" | "assistant"; content: string };
type Conv = { id: string; title: string; updated_at: number };

const STARTERS = [
  "I used to log 800+ films a year. Look at my diary and tell me what changed.",
  "Plan my next two weeks of watching, built from what I've loved most.",
  "Which directors have I gone deepest on, and whose work am I missing?",
  "What were my best nights at the theater?",
];

const LAST_KEY = "cineprompt.talk.last";

function remember(id: string | null) {
  try {
    if (id) localStorage.setItem(LAST_KEY, id);
    else localStorage.removeItem(LAST_KEY);
  } catch {}
}

function recall(): string | null {
  try {
    return localStorage.getItem(LAST_KEY);
  } catch {
    return null;
  }
}

async function* readSSE(res: Response): AsyncGenerator<{ event: string; data: any }> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      let event = "message";
      let data = "";
      for (const line of chunk.split("\n")) {
        if (line.startsWith("event: ")) event = line.slice(7);
        else if (line.startsWith("data: ")) data += line.slice(6);
      }
      if (data) yield { event, data: JSON.parse(data) };
    }
  }
}

export default function Talk() {
  const [convs, setConvs] = useState<Conv[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showList, setShowList] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const loadList = useCallback(async () => {
    try {
      const r = await fetch("/api/chat");
      if (r.ok) setConvs((await r.json()).conversations ?? []);
    } catch {}
  }, []);

  const open = useCallback(async (id: string | null) => {
    setError(null);
    setShowList(false);
    setCurrent(id);
    remember(id);
    if (!id) {
      setMessages([]);
      inputRef.current?.focus();
      return;
    }
    try {
      const r = await fetch(`/api/chat?id=${encodeURIComponent(id)}`);
      if (!r.ok) {
        if (r.status === 404) return open(null);
        throw new Error(`Couldn't load that conversation (${r.status}).`);
      }
      const c = await r.json();
      setMessages((c.messages ?? []).map((m: any) => ({ role: m.role, content: m.content })));
    } catch (e: any) {
      setError(e?.message ?? "Couldn't load that conversation.");
    }
  }, []);

  useEffect(() => {
    loadList();
    const last = recall();
    if (last) open(last);
  }, [loadList, open]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || busy) return;
    setError(null);
    setDraft("");
    setBusy(true);
    setMessages((m) => [...m, { role: "user", content: message }, { role: "assistant", content: "" }]);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversation_id: current, message }),
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Chat failed (${res.status}).`);
      }
      for await (const { event, data } of readSSE(res)) {
        if (event === "meta") {
          setCurrent(data.conversation_id);
          remember(data.conversation_id);
        } else if (event === "delta") {
          setMessages((m) => {
            const next = m.slice();
            const last = next[next.length - 1];
            next[next.length - 1] = { ...last, content: last.content + data.text };
            return next;
          });
        } else if (event === "error") {
          setError(data.message);
        }
      }
    } catch (e: any) {
      setError(e?.message ?? "Chat failed.");
    } finally {
      setMessages((m) => (m.length && m[m.length - 1].role === "assistant" && !m[m.length - 1].content ? m.slice(0, -1) : m));
      setBusy(false);
      loadList();
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this conversation?")) return;
    await fetch(`/api/chat?id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {});
    if (id === current) open(null);
    loadList();
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    send(draft);
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send(draft);
    }
  };

  const list = (
    <nav className="flex flex-col gap-1" data-testid="talk-conversations">
      <button
        onClick={() => open(null)}
        className="flex items-center gap-2 rounded-sm px-3 py-2 text-sm font-sans text-primary hover:bg-card transition-colors"
        data-testid="talk-new"
      >
        <Plus className="h-4 w-4" /> New conversation
      </button>
      {convs.map((c) => (
        <div
          key={c.id}
          className={cn(
            "group flex items-center rounded-sm transition-colors",
            c.id === current ? "bg-card" : "hover:bg-card/60",
          )}
        >
          <button
            onClick={() => open(c.id)}
            className="flex-1 min-w-0 text-left px-3 py-2"
            data-testid={`talk-conv-${c.id}`}
          >
            <p className="truncate text-sm text-foreground/85">{c.title}</p>
            <p className="font-mono text-[10px] text-muted-foreground">
              {new Date(c.updated_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
            </p>
          </button>
          <button
            onClick={() => remove(c.id)}
            aria-label="Delete conversation"
            className="px-2 text-muted-foreground/60 hover:text-destructive opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="px-4 sm:px-8 lg:px-14 pt-8 sm:pt-12 max-w-[1180px] mx-auto flex gap-8 min-h-[calc(100dvh-4rem)]">
      <aside className="hidden lg:block w-60 shrink-0 pt-20">{list}</aside>

      <section className="flex-1 min-w-0 flex flex-col">
        <header className="mb-6 flex items-end justify-between gap-4">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-primary mb-3">
              Your whole diary, in conversation
            </p>
            <h1 className="font-serif text-4xl sm:text-5xl tracking-tight text-foreground">Talk</h1>
          </div>
          <button
            onClick={() => setShowList((v) => !v)}
            className="lg:hidden font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground hover:text-primary"
            data-testid="talk-toggle-list"
          >
            {showList ? "Close" : `History${convs.length ? ` (${convs.length})` : ""}`}
          </button>
        </header>

        {showList && <div className="lg:hidden mb-6 border border-border rounded-sm p-2">{list}</div>}

        <div className="flex-1 space-y-6 pb-6" data-testid="talk-messages">
          {messages.length === 0 && (
            <div className="py-6">
              <p className="text-muted-foreground leading-relaxed max-w-xl mb-6">
                Claude has read every film in your Letterboxd diary: dates, stars, tags and your own reviews. Ask
                it anything about what you've watched, what it says about you, or what to watch next.
              </p>
              <div className="grid sm:grid-cols-2 gap-3">
                {STARTERS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    disabled={busy}
                    className="text-left rounded-sm border border-border bg-card/40 px-4 py-3 text-sm text-foreground/85 hover:border-primary/60 hover:text-foreground transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="flex justify-end">
                <p className="max-w-[85%] whitespace-pre-wrap rounded-sm bg-card px-4 py-3 text-sm text-foreground">
                  {m.content}
                </p>
              </div>
            ) : (
              <div key={i} className="flex gap-3">
                <MessageCircle className="h-4 w-4 mt-1 shrink-0 text-primary" />
                <div className="min-w-0 flex-1 prose prose-sm dark:prose-invert max-w-none prose-p:leading-relaxed prose-a:text-primary">
                  {m.content ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                  ) : (
                    <p className="font-mono text-xs text-muted-foreground animate-pulse">Going through your diary…</p>
                  )}
                </div>
              </div>
            ),
          )}

          {error && (
            <p className="font-mono text-xs text-destructive" data-testid="talk-error">
              {error}
            </p>
          )}
          <div ref={bottomRef} />
        </div>

        <form
          onSubmit={onSubmit}
          className="sticky bottom-20 lg:bottom-4 mb-4 flex items-end gap-2 rounded-sm border border-border bg-background/95 backdrop-blur p-2"
        >
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKey}
            rows={Math.min(6, Math.max(1, draft.split("\n").length))}
            placeholder="Ask about anything you've watched…"
            className="flex-1 resize-none bg-transparent px-2 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
            data-testid="talk-input"
          />
          <button
            type="submit"
            disabled={busy || !draft.trim()}
            aria-label="Send"
            className="h-9 w-9 shrink-0 grid place-items-center rounded-sm bg-primary text-primary-foreground disabled:opacity-40 transition-opacity"
            data-testid="talk-send"
          >
            <ArrowUp className="h-4 w-4" />
          </button>
        </form>
      </section>
    </div>
  );
}
