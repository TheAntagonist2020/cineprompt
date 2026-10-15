import { useMemo, useState, type FormEvent } from "react";
import { Search } from "lucide-react";
import { matchInterest } from "@/lib/interest";
import { usePlex } from "@/lib/plexSession";
import { Poster } from "@/components/film-ui";
import { AccountLinks } from "@/components/account-links";
import type { AppData, QueueFilm } from "@/lib/data";

const EXAMPLES = ["70s horror", "Japanese crime or slow cinema", "heist or western"];

export function WatchPrompt({
  data,
  hidden,
  onOpen,
}: {
  data: AppData;
  hidden: (tmdbId: number) => boolean;
  onOpen: (film: QueueFilm) => void;
}) {
  const plex = usePlex();
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");

  const hits = useMemo(() => {
    if (!query.trim()) return [];
    return matchInterest(data, query).filter((hit) => !hidden(hit.film.tmdb_id));
  }, [data, query, hidden]);

  function submit(event?: FormEvent, next?: string) {
    event?.preventDefault();
    setQuery((next ?? draft).trim());
  }

  return (
    <section className="mb-10" data-testid="watch-prompt">
      <div className="rounded-md border border-border bg-card/40 p-4 sm:p-5">
        <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-primary">
              Or ask
            </p>
            <h2 className="font-serif text-2xl sm:text-3xl tracking-tight mt-1">
              A particular kind of movie
            </h2>
          </div>
          <button
            type="button"
            onClick={plex.connected ? plex.disconnect : plex.connect}
            data-testid="plex-connect"
            className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground hover:text-primary transition-colors"
          >
            {plex.connecting ? "Waiting for Plex…" : plex.connected ? "Plex connected · disconnect" : "Connect Plex"}
          </button>
        </div>
        <p className="text-sm text-muted-foreground max-w-xl mb-4">
          Name one interest, or two with <span className="text-foreground/80">or</span>. Matches come from the films already picked for you, each with a link into Stremio and Plex.
        </p>
        <form onSubmit={submit} className="flex flex-col sm:flex-row gap-2">
          <label className="sr-only" htmlFor="watch-prompt-input">
            Kind of movie
          </label>
          <input
            id="watch-prompt-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="70s horror, or Japanese crime"
            data-testid="watch-prompt-input"
            className="flex-1 rounded-sm border border-border bg-background px-3 py-2.5 font-serif text-base text-foreground placeholder:text-muted-foreground/60 focus:border-primary/60 focus:outline-none"
          />
          <button
            type="submit"
            data-testid="watch-prompt-submit"
            className="inline-flex items-center justify-center gap-2 rounded-sm bg-primary px-4 py-2.5 font-sans text-sm font-semibold text-primary-foreground hover:bg-primary/90"
          >
            <Search className="h-4 w-4" /> Show titles
          </button>
        </form>
        <div className="mt-3 flex flex-wrap gap-2">
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              data-testid={`watch-prompt-example-${example}`}
              onClick={() => {
                setDraft(example);
                setQuery(example);
              }}
              className="rounded-full border border-border px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground hover:border-primary/40 hover:text-primary"
            >
              {example}
            </button>
          ))}
        </div>
        {plex.error && (
          <p className="mt-3 font-mono text-[11px] text-muted-foreground" data-testid="plex-connect-error">
            {plex.error}
          </p>
        )}

        {query && (
          <div className="mt-5 space-y-3" data-testid="watch-prompt-results">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              {hits.length} {hits.length === 1 ? "title" : "titles"} for “{query}”
            </p>
            {hits.length === 0 && (
              <p className="font-serif italic text-muted-foreground">
                Nothing in the current picks matches that. Try a mood, a decade, or a genre — 70s, horror, Japanese, heist.
              </p>
            )}
            {hits.map(({ film, line }) => (
              <article
                key={film.tmdb_id}
                className="grid grid-cols-[72px_1fr] sm:grid-cols-[84px_1fr] gap-3 sm:gap-4 border border-border/80 rounded-sm p-3"
                data-testid={`prompt-hit-${film.tmdb_id}`}
              >
                <button onClick={() => onOpen(film)} className="block" aria-label={`Open ${film.title}`}>
                  <Poster path={film.poster} alt={film.title} className="w-full aspect-[2/3] rounded-sm border border-border" />
                </button>
                <div className="min-w-0">
                  <button onClick={() => onOpen(film)} className="text-left">
                    <h3 className="font-serif text-xl leading-tight hover:text-primary">{film.title}</h3>
                  </button>
                  <p className="font-mono text-[11px] text-muted-foreground mt-1">
                    {[film.year, film.directors?.slice(0, 2).join(", ")].filter(Boolean).join(" · ")}
                  </p>
                  <p className="font-serif italic text-[14px] text-foreground/80 mt-2">{line}</p>
                  <div className="mt-3">
                    <AccountLinks
                      title={film.title}
                      year={film.year}
                      imdbId={film.imdb_id}
                      tmdbId={film.tmdb_id}
                    />
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
