import { useEffect, useState } from "react";
import { PenLine, X } from "lucide-react";
import { formatMonthDayShort, type UnloggedWatch } from "@/lib/data";
import { Poster } from "@/components/film-ui";

/**
 * "Did you watch these?" The pipeline lists titles it saw (a Trakt scrobble,
 * an in-app Watched) that have no Letterboxd diary entry. A Trakt scrobble is
 * only a question: Stremio scrobbles every title opened to check the Plex
 * library. Log opens the Log app on that film; the X records "just a check" in
 * D1 (the Log app's list), so the title is gone on every device and the 9pm
 * check-in never asks about it. The list clears itself once the diary has the
 * entry and the next run's RSS pass sees it.
 */
const KEY = "cineprompt.unloggedDismissed.v1";

function readDismissed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(KEY) || "[]"));
  } catch {
    return new Set();
  }
}

const idOf = (u: UnloggedWatch) => `${u.tmdb}:${u.watched_at}`;

function logAppUrl(u: UnloggedWatch): string {
  const q = new URLSearchParams({ tmdb: String(u.tmdb), title: u.title, year: String(u.year || "") });
  if (u.poster) q.set("poster", u.poster);
  return `/log/?${q}`;
}

export function UnloggedPrompt({ items }: { items: UnloggedWatch[] }) {
  const [dismissed, setDismissed] = useState<Set<string>>(() => readDismissed());
  const [handled, setHandled] = useState<Set<number>>(new Set());

  // Anything the Log app already has (logged, drafted, or "just a check").
  useEffect(() => {
    fetch("/api/log")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!j) return;
        // A check is for good; a Log entry only covers the last two weeks, so
        // a later rewatch of the same film is still asked about.
        const recent = Date.now() - 14 * 86_400_000;
        const ids = [
          ...(j.checks ?? []),
          ...(j.entries ?? []).filter((e: any) => e.updated_at >= recent).map((e: any) => e.tmdb_id),
        ];
        setHandled(new Set(ids.filter((n: unknown) => typeof n === "number")));
      })
      .catch(() => {});
  }, []);

  const open = items.filter((u) => !dismissed.has(idOf(u)) && !handled.has(u.tmdb));
  if (!open.length) return null;

  function justACheck(u: UnloggedWatch) {
    const next = new Set(dismissed);
    next.add(idOf(u));
    setDismissed(next);
    try {
      localStorage.setItem(KEY, JSON.stringify([...next]));
    } catch {
      /* the D1 record below is the one that counts */
    }
    fetch("/api/log", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tmdb_id: u.tmdb, title: u.title, year: String(u.year || ""), status: "check" }),
    }).catch(() => {});
  }

  return (
    <section
      className="mb-8 rounded-md border border-primary/40 bg-primary/[0.07] p-4 sm:p-5"
      data-testid="unlogged-prompt"
    >
      <div className="flex items-center gap-3 mb-3">
        <PenLine className="h-4 w-4 text-primary" />
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-primary">Did you watch these?</p>
        <span className="h-px flex-1 bg-primary/20" />
      </div>
      <ul className="space-y-2">
        {open.map((u) => (
          <li key={idOf(u)} className="flex items-center gap-3" data-testid={`unlogged-${u.tmdb}`}>
            <Poster path={u.poster} alt={u.title} className="w-8 aspect-[2/3] rounded-sm shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="font-serif text-[15px] leading-tight text-foreground truncate">
                {u.title}
                {u.year ? <span className="font-mono text-[11px] text-muted-foreground"> {u.year}</span> : null}
              </p>
              <p className="font-mono text-[10px] text-muted-foreground/80">
                {formatMonthDayShort(u.watched_at)} ·{" "}
                {u.source === "app" ? "marked watched here, not in the diary" : "opened in Stremio"}
              </p>
            </div>
            <a
              href={logAppUrl(u)}
              data-testid={`unlogged-log-${u.tmdb}`}
              className="inline-flex items-center gap-1.5 rounded-sm bg-primary px-3 py-1.5 font-sans text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors shrink-0"
            >
              <PenLine className="h-3 w-3" /> Log it
            </a>
            <button
              onClick={() => justACheck(u)}
              aria-label={`${u.title} was just a library check`}
              data-testid={`unlogged-dismiss-${u.tmdb}`}
              className="h-7 w-7 inline-flex items-center justify-center rounded-sm text-muted-foreground hover:text-foreground hover:bg-card transition-colors shrink-0"
              title="Just a library check: never ask about it again"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
