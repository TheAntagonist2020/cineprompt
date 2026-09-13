import { useState } from "react";
import { PenLine, X, ExternalLink } from "lucide-react";
import { formatMonthDayShort, type UnloggedWatch } from "@/lib/data";
import { Poster } from "@/components/film-ui";

/**
 * "You watched this. It isn't in your diary." The pipeline lists watches it
 * can see (a Trakt scrobble, an in-app Watched) that have no Letterboxd
 * diary entry; this is the prompt to go write one. It clears itself: once
 * the entry exists, the next run's RSS pass drops the film from the list.
 * Dismissals are per device and per watch, for the odd scrobble that wasn't
 * really a viewing.
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

export function UnloggedPrompt({ items }: { items: UnloggedWatch[] }) {
  const [dismissed, setDismissed] = useState<Set<string>>(() => readDismissed());
  const open = items.filter((u) => !dismissed.has(idOf(u)));
  if (!open.length) return null;

  function dismiss(u: UnloggedWatch) {
    const next = new Set(dismissed);
    next.add(idOf(u));
    setDismissed(next);
    try {
      localStorage.setItem(KEY, JSON.stringify([...next]));
    } catch {
      /* per-device convenience only */
    }
  }

  return (
    <section
      className="mb-8 rounded-md border border-primary/40 bg-primary/[0.07] p-4 sm:p-5"
      data-testid="unlogged-prompt"
    >
      <div className="flex items-center gap-3 mb-3">
        <PenLine className="h-4 w-4 text-primary" />
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-primary">
          Watched, not in your diary
        </p>
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
                {formatMonthDayShort(u.watched_at)} · {u.source === "app" ? "marked watched here" : "scrobbled to Trakt"}
              </p>
            </div>
            <a
              href={u.letterboxd_url}
              target="_blank"
              rel="noopener noreferrer"
              data-testid={`unlogged-log-${u.tmdb}`}
              className="inline-flex items-center gap-1.5 rounded-sm bg-primary px-3 py-1.5 font-sans text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors shrink-0"
            >
              Log it <ExternalLink className="h-3 w-3" />
            </a>
            <button
              onClick={() => dismiss(u)}
              aria-label={`Dismiss ${u.title}`}
              data-testid={`unlogged-dismiss-${u.tmdb}`}
              className="h-7 w-7 inline-flex items-center justify-center rounded-sm text-muted-foreground hover:text-foreground hover:bg-card transition-colors shrink-0"
              title="Not a real viewing — hide this one"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
