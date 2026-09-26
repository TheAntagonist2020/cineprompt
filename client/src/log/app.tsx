import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  Copy,
  Heart,
  Loader2,
  Mic,
  MicOff,
  Plus,
  RefreshCw,
  Repeat,
  Search,
  Sparkles,
  Star,
  X,
} from "lucide-react";
import { posterUrl } from "@/lib/data";
import { readSSE } from "@/lib/sse";
import { cn } from "@/lib/utils";

type Status = "draft" | "words_later" | "copied" | "logged" | "check";
type Length = "line" | "paragraph" | "full";

interface Entry {
  id?: string;
  tmdb_id: number | null;
  title: string;
  year: string;
  poster: string | null;
  watched_on: string;
  stars: number | null;
  rewatch: boolean;
  liked: boolean;
  tags: string[];
  notes: string;
  review: string;
  status: Status;
  updated_at?: number;
}

interface Pick {
  tmdb_id: number | null;
  title: string;
  year: string;
  poster: string | null;
  seen?: boolean;
  director?: string;
  seen_on?: string | null;
}

interface Meta {
  user: string | null;
  tags: string[];
  tonight: Pick | null;
  maybe: Pick[];
}

type SearchRow = [number, string, string | number, string, string | null, 0 | 1];

// ---------------------------------------------------------------- helpers --

function localISO(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toLocaleDateString("en-CA");
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function letterboxdUrl(e: Pick): string {
  return e.tmdb_id
    ? `https://letterboxd.com/tmdb/${e.tmdb_id}/`
    : `https://letterboxd.com/search/films/${encodeURIComponent(e.title)}/`;
}

function starText(n: number | null): string {
  if (!n) return "no stars";
  return "★".repeat(Math.floor(n)) + (n % 1 ? "½" : "");
}

function blankEntry(p: Pick): Entry {
  return {
    tmdb_id: p.tmdb_id,
    title: p.title,
    year: p.year,
    poster: p.poster,
    watched_on: localISO(),
    stars: null,
    rewatch: !!p.seen,
    liked: false,
    tags: [],
    notes: "",
    review: "",
    status: "draft",
  };
}

async function saveEntry(e: Entry): Promise<Entry> {
  const r = await fetch("/api/log", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(e),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `Save failed (${r.status})`);
  return (await r.json()).entry as Entry;
}

function copyText(text: string, fallback?: HTMLTextAreaElement | null): void {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).catch(() => legacyCopy(fallback));
  } else {
    legacyCopy(fallback);
  }
}

function legacyCopy(el?: HTMLTextAreaElement | null) {
  if (!el) return;
  el.select();
  document.execCommand("copy");
}

// -------------------------------------------------------------- pieces ----

function Poster({ path, title, className }: { path: string | null; title: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  const src = path && !failed ? (path.startsWith("http") ? path : posterUrl(path, "w185")) : null;
  return src ? (
    <img
      src={src}
      alt=""
      title={title}
      loading="lazy"
      onError={() => setFailed(true)}
      className={cn("object-cover rounded-sm bg-card", className)}
    />
  ) : (
    <div className={cn("rounded-sm bg-card grid place-items-center text-muted-foreground/50", className)}>
      <Star className="h-4 w-4" />
    </div>
  );
}

function Stars({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex" role="radiogroup" aria-label="Stars">
        {[1, 2, 3, 4, 5].map((n) => {
          const fill = value == null ? 0 : value >= n ? 1 : value >= n - 0.5 ? 0.5 : 0;
          return (
            <div key={n} className="relative h-11 w-11">
              <Star className="absolute inset-1.5 h-8 w-8 text-muted-foreground/40" />
              <div className="absolute inset-y-0 left-0 overflow-hidden" style={{ width: `${fill * 100}%` }}>
                <Star className="m-1.5 h-8 w-8 fill-primary text-primary" />
              </div>
              <button
                type="button"
                aria-label={`${n - 0.5} stars`}
                onClick={() => onChange(n - 0.5)}
                className="absolute inset-y-0 left-0 w-1/2"
                data-testid={`star-${n - 0.5}`}
              />
              <button
                type="button"
                aria-label={`${n} stars`}
                onClick={() => onChange(n)}
                className="absolute inset-y-0 right-0 w-1/2"
                data-testid={`star-${n}`}
              />
            </div>
          );
        })}
      </div>
      <span className="font-mono text-sm text-foreground/80 w-8">{value ?? "–"}</span>
      {value != null && (
        <button type="button" onClick={() => onChange(null)} className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

function Toggle({
  on,
  onClick,
  icon: Icon,
  label,
  testid,
}: {
  on: boolean;
  onClick: () => void;
  icon: typeof Heart;
  label: string;
  testid: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      data-testid={testid}
      className={cn(
        "flex items-center gap-2 rounded-full border px-4 py-2 text-sm transition-colors",
        on ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className={cn("h-4 w-4", on && "fill-primary")} />
      {label}
    </button>
  );
}

function useDictation(onText: (t: string) => void) {
  const SR = typeof window !== "undefined" ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition : null;
  const recRef = useRef<any>(null);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");

  const stop = useCallback(() => {
    recRef.current?.stop();
  }, []);

  const start = useCallback(() => {
    if (!SR) return;
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = navigator.language || "en-US";
    rec.onresult = (ev: any) => {
      let live = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) onText(r[0].transcript.trim());
        else live += r[0].transcript;
      }
      setInterim(live);
    };
    rec.onend = () => {
      setListening(false);
      setInterim("");
    };
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    rec.start();
    setListening(true);
  }, [SR, onText]);

  useEffect(() => () => recRef.current?.abort?.(), []);
  return { supported: !!SR, listening, interim, start, stop };
}

// ------------------------------------------------------------------ app ---

export default function LogApp() {
  const [meta, setMeta] = useState<Meta>({ user: null, tags: [], tonight: null, maybe: [] });
  const [entries, setEntries] = useState<Entry[]>([]);
  const [checks, setChecks] = useState<Set<number>>(new Set());
  const [inApp, setInApp] = useState<Pick[]>([]);
  const [entry, setEntry] = useState<Entry | null>(null);
  const [screen, setScreen] = useState<"home" | "entry" | "review">("home");
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/log");
      if (r.ok) {
        const j = await r.json();
        setEntries(j.entries ?? []);
        setChecks(new Set(j.checks ?? []));
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetch("/data/log-meta.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((m) => m && setMeta(m))
      .catch(() => {});
    // Films marked Watched in Cineprompt in the last three days.
    fetch("/api/state")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        const since = Date.now() - 3 * 86_400_000;
        setInApp(
          (j?.films ?? [])
            .filter((f: any) => f.status === "watched" && f.title && f.updated_at >= since)
            .map((f: any) => ({ tmdb_id: f.tmdb_id, title: f.title, year: String(f.year ?? ""), poster: f.poster ?? null })),
        );
      })
      .catch(() => {});
    refresh();
  }, [refresh]);

  const persist = useCallback(
    async (e: Entry): Promise<Entry | null> => {
      try {
        const saved = await saveEntry(e);
        setEntry(saved);
        refresh();
        return saved;
      } catch (err: any) {
        setError(err?.message ?? "Couldn't save.");
        return null;
      }
    },
    [refresh],
  );

  const begin = (p: Pick) => {
    const existing = entries.find(
      (e) => e.status !== "logged" && ((p.tmdb_id && e.tmdb_id === p.tmdb_id) || (!p.tmdb_id && e.title === p.title)),
    );
    setError(null);
    setEntry(existing ?? blankEntry(p));
    setScreen("entry");
  };

  const markCheck = async (p: Pick) => {
    await saveEntry({ ...blankEntry(p), status: "check" }).catch(() => null);
    setFlash(`Got it: ${p.title} was just a library check. It won't come up again.`);
    refresh();
  };

  const done = (message: string) => {
    setFlash(message);
    setEntry(null);
    setScreen("home");
    refresh();
  };

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <div className="mx-auto max-w-xl px-4 pb-24 pt-[max(1.25rem,env(safe-area-inset-top))]">
        {screen === "home" && (
          <Home
            meta={meta}
            entries={entries}
            checks={checks}
            inApp={inApp}
            flash={flash}
            onDismissFlash={() => setFlash(null)}
            onPick={begin}
            onCheck={markCheck}
            onOpen={(e) => {
              setError(null);
              setEntry(e);
              // No review yet means talking it out first; Claude never drafts from stars alone.
              setScreen(e.review?.trim() ? "review" : "entry");
            }}
            onLogged={async (e) => {
              await persist({ ...e, status: "logged" });
              done(`${e.title} is logged.`);
            }}
          />
        )}
        {screen === "entry" && entry && (
          <EntryForm
            entry={entry}
            tagChoices={meta.tags}
            error={error}
            onBack={() => setScreen("home")}
            onChange={setEntry}
            onDraft={async () => {
              const saved = await persist({ ...entry, status: entry.status === "check" ? "draft" : entry.status });
              if (saved) setScreen("review");
            }}
            onStarsOnly={async () => {
              window.open(letterboxdUrl(entry), "_blank", "noopener");
              const saved = await persist({ ...entry, status: "words_later" });
              if (saved) done(`Stars are in for ${entry.title}. It's waiting under "Still to write up".`);
            }}
          />
        )}
        {screen === "review" && entry && (
          <ReviewStep
            entry={entry}
            onBack={() => setScreen("entry")}
            onChange={setEntry}
            onSave={persist}
            onLogged={async (e) => {
              await persist({ ...e, status: "logged" });
              done(`${e.title} is logged.`);
            }}
            onLater={async (e) => {
              await persist({ ...e, status: e.review.trim() ? "draft" : "words_later" });
              done(`Saved ${e.title} for later.`);
            }}
          />
        )}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------- home ---

function Home(props: {
  meta: Meta;
  entries: Entry[];
  checks: Set<number>;
  inApp: Pick[];
  flash: string | null;
  onDismissFlash: () => void;
  onPick: (p: Pick) => void;
  onCheck: (p: Pick) => void;
  onOpen: (e: Entry) => void;
  onLogged: (e: Entry) => void;
}) {
  const { meta, entries, checks, inApp, flash } = props;
  const [q, setQ] = useState("");
  const [index, setIndex] = useState<SearchRow[] | null>(null);
  const loading = useRef(false);

  const loadIndex = () => {
    if (index || loading.current) return;
    loading.current = true;
    const rows = (url: string) =>
      fetch(url)
        .then((r) => (r.ok ? r.json() : { films: [] }))
        .then((j) => (j.films ?? []) as SearchRow[])
        .catch(() => [] as SearchRow[]);
    // The library index plus every film in the diary (rewatches, new releases).
    Promise.all([rows("/data/search.json"), rows("/data/log-films.json")]).then(([lib, diary]) => {
      const byId = new Map<number, SearchRow>();
      for (const r of lib) byId.set(r[0], r);
      for (const r of diary) {
        const hit = byId.get(r[0]);
        if (hit) hit[5] = 1;
        else byId.set(r[0], r);
      }
      setIndex([...byId.values()]);
    });
  };

  const results = useMemo(() => {
    const raw = norm(q);
    if (!raw || !index) return [];
    const m = /^(.*?)\s*\b((?:18|19|20)\d{2})$/.exec(raw);
    const text = m && m[1] ? m[1] : raw;
    const year = m && m[1] ? m[2] : "";
    const scored: Array<[number, SearchRow]> = [];
    for (const row of index) {
      const t = norm(row[1]);
      if (year && String(row[2]) !== year) continue;
      const score = t === text ? 0 : t.startsWith(text) ? 1 : t.includes(text) ? 2 : -1;
      if (score >= 0) scored.push([score, row]);
    }
    scored.sort((a, b) => a[0] - b[0] || Number(b[1][2]) - Number(a[1][2]));
    return scored.slice(0, 12).map(([, r]) => r);
  }, [q, index]);

  const known = new Set(entries.filter((e) => e.tmdb_id).map((e) => e.tmdb_id));
  const maybe = meta.maybe.filter((p) => p.tmdb_id && !checks.has(p.tmdb_id) && !known.has(p.tmdb_id));
  const marked = inApp.filter((p) => p.tmdb_id && !known.has(p.tmdb_id));
  const tonight = meta.tonight && !known.has(meta.tonight.tmdb_id) ? meta.tonight : null;
  const toWrite = entries.filter((e) => e.status === "words_later");
  const waiting = entries.filter((e) => e.status === "draft" || e.status === "copied");
  const logged = entries.filter((e) => e.status === "logged");
  const month = localISO().slice(0, 7);
  const thisMonth = logged.filter((e) => (e.watched_on ?? "").startsWith(month)).length;

  return (
    <>
      <header className="flex items-center justify-between mb-8">
        <div className="flex items-baseline gap-3">
          <span className="font-serif text-3xl tracking-tight">Log</span>
          {thisMonth > 0 && (
            <span className="font-mono text-[11px] text-muted-foreground" data-testid="month-count">
              {thisMonth} this month
            </span>
          )}
        </div>
        <a href="/" className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground hover:text-primary">
          Cineprompt
        </a>
      </header>

      {flash && (
        <div className="mb-6 flex items-start gap-3 rounded-sm border border-primary/40 bg-primary/10 px-4 py-3 text-sm">
          <Check className="h-4 w-4 mt-0.5 text-primary shrink-0" />
          <p className="flex-1">{flash}</p>
          <button onClick={props.onDismissFlash} aria-label="Dismiss" className="text-muted-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <label className="block">
        <span className="font-serif text-2xl">What did you watch?</span>
        <div className="mt-3 flex items-center gap-2 rounded-sm border border-border bg-card/40 px-3 focus-within:border-primary/60">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onFocus={loadIndex}
            placeholder="Title, or title and year"
            className="flex-1 bg-transparent py-3 text-base focus:outline-none"
            autoComplete="off"
            data-testid="log-search"
          />
          {q && (
            <button onClick={() => setQ("")} aria-label="Clear" className="text-muted-foreground">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </label>

      {q.trim() ? (
        <div className="mt-3 divide-y divide-border/60" data-testid="log-results">
          {results.map((r) => (
            <button
              key={r[0]}
              onClick={() =>
                props.onPick({ tmdb_id: r[0], title: r[1], year: String(r[2] ?? ""), poster: r[4], seen: !!r[5] })
              }
              className="flex w-full items-center gap-3 py-2 text-left hover:bg-card/40"
            >
              <Poster path={r[4]} title={r[1]} className="h-14 w-10 shrink-0" />
              <div className="min-w-0">
                <p className="truncate">{r[1]}</p>
                <p className="font-mono text-[11px] text-muted-foreground">
                  {r[2]}
                  {r[3] ? ` · ${r[3]}` : ""}
                  {r[5] ? " · seen before" : ""}
                </p>
              </div>
            </button>
          ))}
          {!index && <p className="py-3 font-mono text-xs text-muted-foreground">Loading the library…</p>}
          <button
            onClick={() => {
              const m = /^(.*?)\s*\b((?:18|19|20)\d{2})$/.exec(q.trim());
              props.onPick({ tmdb_id: null, title: (m && m[1]) || q.trim(), year: m && m[1] ? m[2] : "", poster: null });
            }}
            className="flex w-full items-center gap-3 py-3 text-left text-sm text-primary"
            data-testid="log-freeform"
          >
            <Plus className="h-4 w-4" /> Log “{q.trim()}”
            {index && !results.length ? " (not in the library)" : ""}
          </button>
        </div>
      ) : (
        <div className="mt-8 space-y-8">
          {marked.length > 0 && (
            <Section title="Marked watched in Cineprompt">
              {marked.map((p) => (
                <PickRow key={p.tmdb_id} p={p} onLog={() => props.onPick(p)} />
              ))}
            </Section>
          )}

          {maybe.length > 0 && (
            <Section
              title="Did you watch these?"
              note="Stremio opened these recently. Some were only library checks."
            >
              {maybe.map((p) => (
                <PickRow key={p.tmdb_id} p={p} onLog={() => props.onPick(p)} onCheck={() => props.onCheck(p)} />
              ))}
            </Section>
          )}

          {toWrite.length > 0 && (
            <Section title="Still to write up" note="The stars are in. Say a few words and Claude drafts the rest.">
              {toWrite.map((e) => (
                <EntryRow key={e.id} e={e} action="Write it" onClick={() => props.onOpen(e)} />
              ))}
            </Section>
          )}

          {waiting.length > 0 && (
            <Section title="Waiting on Letterboxd">
              {waiting.map((e) => (
                <EntryRow
                  key={e.id}
                  e={e}
                  action={e.status === "copied" ? "Logged it" : "Finish"}
                  onClick={() => (e.status === "copied" ? props.onLogged(e) : props.onOpen(e))}
                />
              ))}
            </Section>
          )}

          {tonight && (
            <Section title="Tonight's pick">
              <PickRow p={tonight} onLog={() => props.onPick(tonight)} />
            </Section>
          )}

          {logged.length > 0 && (
            <Section title="Logged">
              {logged.slice(0, 12).map((e) => (
                <EntryRow key={e.id} e={e} onClick={() => props.onOpen(e)} />
              ))}
            </Section>
          )}
        </div>
      )}
    </>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="font-mono text-[11px] uppercase tracking-[0.24em] text-primary">{title}</h2>
      {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
      <div className="mt-3 divide-y divide-border/60">{children}</div>
    </section>
  );
}

function PickRow({ p, onLog, onCheck }: { p: Pick; onLog: () => void; onCheck?: () => void }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <Poster path={p.poster} title={p.title} className="h-14 w-10 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="truncate">{p.title}</p>
        <p className="font-mono text-[11px] text-muted-foreground">
          {p.year}
          {p.seen_on ? ` · opened ${p.seen_on}` : ""}
        </p>
      </div>
      {onCheck && (
        <button
          onClick={onCheck}
          className="rounded-sm px-2 py-2 text-xs text-muted-foreground hover:text-foreground"
          data-testid={`check-${p.tmdb_id}`}
        >
          Just a check
        </button>
      )}
      <button
        onClick={onLog}
        className="rounded-sm bg-primary px-3 py-2 text-xs font-medium text-primary-foreground"
        data-testid={`pick-${p.tmdb_id}`}
      >
        Log
      </button>
    </div>
  );
}

function EntryRow({ e, action, onClick }: { e: Entry; action?: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-3 py-2 text-left hover:bg-card/40">
      <Poster path={e.poster} title={e.title} className="h-14 w-10 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="truncate">{e.title}</p>
        <p className="font-mono text-[11px] text-muted-foreground">
          {e.watched_on} · {starText(e.stars)}
          {e.rewatch ? " · rewatch" : ""}
        </p>
      </div>
      {action && <span className="text-xs text-primary">{action}</span>}
    </button>
  );
}

// ---------------------------------------------------------------- entry ---

function EntryForm(props: {
  entry: Entry;
  tagChoices: string[];
  error: string | null;
  onBack: () => void;
  onChange: (e: Entry) => void;
  onDraft: () => void;
  onStarsOnly: () => void;
}) {
  const { entry: e, onChange } = props;
  const set = (patch: Partial<Entry>) => onChange({ ...e, ...patch });
  const [newTag, setNewTag] = useState("");
  const [busy, setBusy] = useState(false);
  const addText = useCallback(
    (t: string) => onChange({ ...e, notes: e.notes ? `${e.notes.trimEnd()} ${t}` : t }),
    [e, onChange],
  );
  const mic = useDictation(addText);
  const tags = [...new Set([...props.tagChoices, ...e.tags])];

  const run = async (fn: () => void | Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-7">
      <button onClick={props.onBack} className="flex items-center gap-2 text-sm text-muted-foreground">
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      <div className="flex gap-4">
        <Poster path={e.poster} title={e.title} className="h-28 w-[76px] shrink-0" />
        <div className="min-w-0">
          <h1 className="font-serif text-2xl leading-tight">{e.title}</h1>
          {e.tmdb_id ? (
            <p className="font-mono text-xs text-muted-foreground mt-1">{e.year}</p>
          ) : (
            <input
              value={e.year}
              onChange={(ev) => set({ year: ev.target.value.replace(/\D/g, "").slice(0, 4) })}
              placeholder="Year"
              inputMode="numeric"
              className="mt-2 w-20 rounded-sm border border-border bg-transparent px-2 py-1 font-mono text-xs"
            />
          )}
        </div>
      </div>

      <div>
        <p className="mb-2 text-sm text-muted-foreground">Watched</p>
        <div className="flex flex-wrap items-center gap-2">
          {[
            ["Today", localISO()],
            ["Yesterday", localISO(-1)],
          ].map(([label, d]) => (
            <button
              key={d}
              onClick={() => set({ watched_on: d })}
              className={cn(
                "rounded-full border px-4 py-2 text-sm",
                e.watched_on === d ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground",
              )}
            >
              {label}
            </button>
          ))}
          <input
            type="date"
            value={e.watched_on}
            max={localISO()}
            onChange={(ev) => ev.target.value && set({ watched_on: ev.target.value })}
            className="rounded-full border border-border bg-transparent px-3 py-2 text-sm text-muted-foreground [color-scheme:dark]"
          />
        </div>
      </div>

      <Stars value={e.stars} onChange={(v) => set({ stars: v })} />

      <div className="flex flex-wrap gap-2">
        <Toggle on={e.rewatch} onClick={() => set({ rewatch: !e.rewatch })} icon={Repeat} label="Rewatch" testid="toggle-rewatch" />
        <Toggle on={e.liked} onClick={() => set({ liked: !e.liked })} icon={Heart} label="Liked" testid="toggle-liked" />
      </div>

      <div>
        <p className="mb-2 text-sm text-muted-foreground">Tags</p>
        <div className="flex flex-wrap gap-2">
          {tags.map((t) => {
            const on = e.tags.includes(t);
            return (
              <button
                key={t}
                onClick={() => set({ tags: on ? e.tags.filter((x) => x !== t) : [...e.tags, t] })}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-xs",
                  on ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground",
                )}
              >
                {t}
              </button>
            );
          })}
          <form
            onSubmit={(ev) => {
              ev.preventDefault();
              const t = newTag.trim().toLowerCase();
              if (t && !e.tags.includes(t)) set({ tags: [...e.tags, t] });
              setNewTag("");
            }}
          >
            <input
              value={newTag}
              onChange={(ev) => setNewTag(ev.target.value)}
              placeholder="+ tag"
              className="w-24 rounded-full border border-dashed border-border bg-transparent px-3 py-1.5 text-xs focus:outline-none focus:border-primary/60"
            />
          </form>
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm text-muted-foreground">What did you think? Say it however it comes out.</p>
          {mic.supported && (
            <button
              type="button"
              onClick={mic.listening ? mic.stop : mic.start}
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs",
                mic.listening ? "border-destructive text-destructive" : "border-border text-muted-foreground",
              )}
            >
              {mic.listening ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
              {mic.listening ? "Stop" : "Talk"}
            </button>
          )}
        </div>
        <textarea
          value={e.notes + (mic.interim ? ` ${mic.interim}` : "")}
          onChange={(ev) => set({ notes: ev.target.value })}
          rows={5}
          placeholder="couldn't stop thinking about the conversation with the stranger. Saw it at the Village with my son…"
          className="w-full rounded-sm border border-border bg-card/40 px-3 py-3 text-base leading-relaxed focus:outline-none focus:border-primary/60"
          data-testid="log-notes"
        />
      </div>

      {props.error && <p className="font-mono text-xs text-destructive">{props.error}</p>}

      <div className="space-y-3">
        <button
          onClick={() => run(props.onDraft)}
          disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded-sm bg-primary py-3.5 font-medium text-primary-foreground disabled:opacity-50"
          data-testid="log-draft"
        >
          <Sparkles className="h-4 w-4" /> Draft my review
        </button>
        {e.status !== "words_later" && (
        <button
          onClick={() => run(props.onStarsOnly)}
          disabled={busy}
          className="w-full rounded-sm border border-border py-3 text-sm text-foreground/85 disabled:opacity-50"
          data-testid="log-stars-only"
        >
          Just the stars for now: open Letterboxd, words later
        </button>
        )}
      </div>
    </div>
  );
}

// --------------------------------------------------------------- review ---

const LENGTHS: Array<[Length, string]> = [
  ["line", "A line"],
  ["paragraph", "A paragraph"],
  ["full", "Full review"],
];

function ReviewStep(props: {
  entry: Entry;
  onBack: () => void;
  onChange: (e: Entry) => void;
  onSave: (e: Entry) => Promise<Entry | null>;
  onLogged: (e: Entry) => void;
  onLater: (e: Entry) => void;
}) {
  const { entry: e } = props;
  const [length, setLength] = useState<Length>("paragraph");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [direction, setDirection] = useState("");
  const [opened, setOpened] = useState(e.status === "copied");
  const [copied, setCopied] = useState(false);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const started = useRef(false);

  const draft = useCallback(
    async (len: Length, previous?: string, instruction?: string) => {
      setError(null);
      setStreaming(true);
      let text = "";
      props.onChange({ ...e, review: "" });
      try {
        const res = await fetch("/api/log/draft", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ entry: e, length: len, previous, instruction }),
        });
        if (!res.ok || !res.body) {
          const b = await res.json().catch(() => ({}));
          throw new Error(b.error ?? `Drafting failed (${res.status}).`);
        }
        for await (const { event, data } of readSSE(res)) {
          if (event === "delta") {
            text += data.text;
            props.onChange({ ...e, review: text });
          } else if (event === "error") {
            setError(data.message);
          }
        }
        if (text.trim()) {
          await props.onSave({ ...e, review: text.trim(), status: e.status === "words_later" ? "draft" : e.status });
        }
      } catch (err: any) {
        setError(err?.message ?? "Drafting failed.");
        if (previous) props.onChange({ ...e, review: previous });
      } finally {
        setStreaming(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [e.id, e.title, e.stars, e.notes, e.rewatch, e.liked, e.watched_on, e.tags.join("|")],
  );

  useEffect(() => {
    if (!started.current && !e.review.trim()) {
      started.current = true;
      draft(length);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const copyAndOpen = () => {
    copyText(e.review.trim(), boxRef.current);
    setCopied(true);
    window.open(letterboxdUrl(e), "_blank", "noopener");
    setOpened(true);
    props.onSave({ ...e, review: e.review.trim(), status: "copied" });
  };

  return (
    <div className="space-y-6">
      <button onClick={props.onBack} className="flex items-center gap-2 text-sm text-muted-foreground">
        <ArrowLeft className="h-4 w-4" /> {e.title}
      </button>

      <div className="flex items-center gap-3 font-mono text-xs text-muted-foreground">
        <span className="text-primary text-base">{starText(e.stars)}</span>
        <span>{e.watched_on}</span>
        {e.rewatch && <span>rewatch</span>}
        {e.liked && <Heart className="h-3.5 w-3.5 fill-primary text-primary" />}
      </div>

      <div className="flex gap-2">
        {LENGTHS.map(([id, label]) => (
          <button
            key={id}
            disabled={streaming}
            onClick={() => {
              setLength(id);
              draft(id, e.review.trim() || undefined, `Make it ${label.toLowerCase()} long.`);
            }}
            className={cn(
              "rounded-full border px-3 py-1.5 text-xs disabled:opacity-50",
              length === id ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="relative">
        <textarea
          ref={boxRef}
          value={e.review}
          readOnly={streaming}
          onChange={(ev) => props.onChange({ ...e, review: ev.target.value })}
          onBlur={() => !streaming && e.review.trim() && props.onSave({ ...e, review: e.review })}
          rows={Math.max(6, Math.ceil(e.review.length / 42))}
          placeholder={streaming ? "" : "Your review"}
          className="w-full rounded-sm border border-border bg-card/40 px-3 py-3 text-base leading-relaxed focus:outline-none focus:border-primary/60"
          data-testid="log-review"
        />
        {streaming && !e.review && (
          <p className="absolute left-3 top-3 flex items-center gap-2 font-mono text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Writing it in your voice…
          </p>
        )}
      </div>

      {error && <p className="font-mono text-xs text-destructive" data-testid="log-error">{error}</p>}

      <form
        onSubmit={(ev) => {
          ev.preventDefault();
          draft(length, e.review.trim() || undefined, direction.trim() || undefined);
          setDirection("");
        }}
        className="flex items-center gap-2"
      >
        <input
          value={direction}
          onChange={(ev) => setDirection(ev.target.value)}
          placeholder="Redo it: funnier, mention the score, less formal…"
          className="flex-1 rounded-sm border border-border bg-transparent px-3 py-2 text-sm focus:outline-none focus:border-primary/60"
        />
        <button
          type="submit"
          disabled={streaming}
          className="flex items-center gap-1.5 rounded-sm border border-border px-3 py-2 text-sm text-muted-foreground disabled:opacity-50"
          data-testid="log-redo"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Redo
        </button>
      </form>

      <div className="space-y-3 pt-2">
        <button
          onClick={copyAndOpen}
          disabled={streaming || !e.review.trim()}
          className="flex w-full items-center justify-center gap-2 rounded-sm bg-primary py-3.5 font-medium text-primary-foreground disabled:opacity-50"
          data-testid="log-copy-open"
        >
          <Copy className="h-4 w-4" /> {copied ? "Copied. Open Letterboxd again" : "Copy review & open Letterboxd"}
        </button>
        {opened && (
          <p className="text-xs text-muted-foreground leading-relaxed">
            On Letterboxd: tap Log, paste the review, set {starText(e.stars)}
            {e.rewatch ? ", tick rewatch" : ""} and the date ({e.watched_on}), then Save.
          </p>
        )}
        {opened && (
          <button
            onClick={() => props.onLogged(e)}
            className="flex w-full items-center justify-center gap-2 rounded-sm border border-primary/60 py-3 text-sm text-primary"
            data-testid="log-logged"
          >
            <Check className="h-4 w-4" /> It's on Letterboxd
          </button>
        )}
        <button
          onClick={() => props.onLater(e)}
          disabled={streaming}
          className="w-full py-2 text-sm text-muted-foreground disabled:opacity-50"
        >
          Save for later
        </button>
      </div>
    </div>
  );
}
