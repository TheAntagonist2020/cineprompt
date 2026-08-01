import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Search, Check, CornerDownLeft, Loader2, Users, Library, Film } from "lucide-react";
import {
  useShard,
  posterUrl,
  letterboxdTmdbUrl,
  type SearchFilmRow,
} from "@/lib/data";

/**
 * Global search over the whole library — every film the app knows about
 * (queue, pools, every filmography, every collection, every canon list),
 * not just what the current page happens to be showing.
 *
 * The index is a shard fetched on first open, so this costs nothing on the
 * critical path. This module is itself lazily imported by Layout.
 */

type Result =
  | { kind: "film"; id: number; title: string; year: string; director: string; poster: string | null; seen: boolean; score: number }
  | { kind: "director"; name: string; slug: string; seen: number; total: number; score: number }
  | { kind: "collection"; key: string; name: string; total: number; score: number };

const MAX_RESULTS = 40;

/**
 * Rank by where the match lands: title start beats word start beats a match
 * buried mid-word, and shorter titles win ties so "Heat" outranks
 * "The Heat of the Day" when you type "heat".
 */
function score(haystack: string, needle: string): number {
  if (!haystack) return -1;
  const h = haystack.toLowerCase();
  const i = h.indexOf(needle);
  if (i < 0) return -1;
  const brevity = Math.max(0, 30 - haystack.length) * 0.2;
  if (i === 0) return 1000 + brevity;
  if (!/[a-z0-9]/i.test(h[i - 1])) return 600 + brevity;
  return 200 + brevity;
}

export default function CommandPalette({ onClose }: { onClose: () => void }) {
  const { shard, loading } = useShard("search");
  const [, navigate] = useLocation();
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Lock background scroll while the palette owns the screen.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const results = useMemo<Result[]>(() => {
    const needle = q.trim().toLowerCase();
    if (!shard || needle.length < 2) return [];
    const out: Result[] = [];

    // People and lists outrank individual films on an equal-quality match:
    // typing "bergman" should reach the filmography, not stop at a film whose
    // title happens to start with the word.
    for (const [name, slug, seen, total] of shard.directors) {
      const s = score(name, needle);
      if (s > 0) out.push({ kind: "director", name, slug, seen, total, score: s + 450 });
    }
    for (const [key, name, total] of shard.collections) {
      const s = score(name, needle);
      if (s > 0) out.push({ kind: "collection", key, name, total, score: s + 420 });
    }
    for (const row of shard.films as SearchFilmRow[]) {
      const [id, title, year, director, poster, seen] = row;
      const titleScore = score(title, needle);
      // A director match still surfaces the film, but ranks below its title.
      const dirScore = titleScore > 0 ? -1 : score(director, needle) - 400;
      const s = Math.max(titleScore, dirScore);
      if (s > 0) {
        out.push({
          kind: "film",
          id,
          title,
          year: String(year ?? ""),
          director,
          poster,
          seen: seen === 1,
          score: s,
        });
      }
    }

    return out.sort((a, b) => b.score - a.score).slice(0, MAX_RESULTS);
  }, [shard, q]);

  useEffect(() => {
    setActive(0);
  }, [q]);

  // Keep the highlighted row visible during keyboard navigation.
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-idx="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function open(r: Result) {
    if (r.kind === "film") {
      window.open(letterboxdTmdbUrl(r.id), "_blank", "noopener,noreferrer");
    } else if (r.kind === "director") {
      navigate(`/directors/${r.slug}`);
    } else {
      navigate("/collections");
    }
    onClose();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (results.length ? (i + 1) % results.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (results.length ? (i - 1 + results.length) % results.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const r = results[active];
      if (r) open(r);
    }
  }

  const showHint = q.trim().length < 2;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[12vh]"
      role="dialog"
      aria-modal="true"
      aria-label="Search the library"
    >
      <button
        aria-label="Close search"
        className="absolute inset-0 bg-background/80 backdrop-blur-sm"
        onClick={onClose}
        tabIndex={-1}
      />

      <div
        className="relative w-full max-w-2xl overflow-hidden rounded-md border border-border bg-card shadow-2xl"
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-3 border-b border-border px-4">
          {loading ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
          ) : (
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search films, directors, collections…"
            data-testid="input-command-palette"
            className="h-14 w-full bg-transparent font-sans text-[15px] text-foreground outline-none placeholder:text-muted-foreground/60"
          />
          <kbd className="hidden shrink-0 rounded-sm border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:block">
            ESC
          </kbd>
        </div>

        <div ref={listRef} className="max-h-[52vh] overflow-y-auto">
          {showHint && (
            <p className="px-4 py-8 text-center font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground/70">
              {shard
                ? `${shard.films.length.toLocaleString("en-US")} films · ${shard.directors.length} directors · ${shard.collections.length} collections`
                : "Loading index…"}
            </p>
          )}

          {!showHint && results.length === 0 && !loading && (
            <p className="px-4 py-8 text-center font-serif italic text-muted-foreground">
              Nothing matches “{q}”.
            </p>
          )}

          {results.map((r, i) => {
            const isActive = i === active;
            const base = `flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${
              isActive ? "bg-primary/10" : "hover:bg-muted/40"
            }`;
            if (r.kind === "film") {
              return (
                <button
                  key={`f${r.id}`}
                  data-idx={i}
                  className={base}
                  onMouseMove={() => setActive(i)}
                  onClick={() => open(r)}
                >
                  <div className="h-12 w-8 shrink-0 overflow-hidden rounded-sm bg-muted">
                    {posterUrl(r.poster, "w92") && (
                      <img
                        src={posterUrl(r.poster, "w92")!}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className="h-full w-full object-cover"
                      />
                    )}
                  </div>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-serif text-[15px] text-foreground">
                        {r.title}
                      </span>
                      {r.seen && (
                        <Check className="h-3 w-3 shrink-0 text-primary" aria-label="Seen" />
                      )}
                    </span>
                    <span className="block truncate font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      {[r.year, r.director].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  {isActive && (
                    <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-primary/70" />
                  )}
                </button>
              );
            }
            if (r.kind === "director") {
              return (
                <button
                  key={`d${r.slug}`}
                  data-idx={i}
                  className={base}
                  onMouseMove={() => setActive(i)}
                  onClick={() => open(r)}
                >
                  <span className="flex h-12 w-8 shrink-0 items-center justify-center rounded-sm border border-border/60 bg-muted/40">
                    <Users className="h-3.5 w-3.5 text-primary/80" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-serif text-[15px] text-foreground">
                      {r.name}
                    </span>
                    <span className="block font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      Director · {r.seen}/{r.total} seen
                    </span>
                  </span>
                  {isActive && (
                    <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-primary/70" />
                  )}
                </button>
              );
            }
            return (
              <button
                key={`c${r.key}`}
                data-idx={i}
                className={base}
                onMouseMove={() => setActive(i)}
                onClick={() => open(r)}
              >
                <span className="flex h-12 w-8 shrink-0 items-center justify-center rounded-sm border border-border/60 bg-muted/40">
                  <Library className="h-3.5 w-3.5 text-primary/80" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-serif text-[15px] text-foreground">
                    {r.name}
                  </span>
                  <span className="block font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                    Collection · {r.total} titles
                  </span>
                </span>
                {isActive && <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-primary/70" />}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-4 border-t border-border px-4 py-2 font-mono text-[9.5px] uppercase tracking-[0.14em] text-muted-foreground/70">
          <span className="flex items-center gap-1">
            <Film className="h-3 w-3" /> Enter opens Letterboxd
          </span>
          <span className="ml-auto hidden sm:block">↑↓ to navigate</span>
        </div>
      </div>
    </div>
  );
}
