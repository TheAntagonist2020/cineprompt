import { Play, ExternalLink, ChevronRight } from "lucide-react";
import {
  actionLinks,
  formatRuntime,
  languageName,
  type QueueFilm,
} from "@/lib/data";
import { Poster, KenBurnsBackdrop, FilmActions } from "@/components/film-ui";

/**
 * The one decision the app exists to make. Everything else on Today is
 * optional; this is the instruction: this film, tonight, here's where.
 *
 * "Not tonight" advances to the next candidate instantly (the state store
 * hides the snoozed film), "Watched" retires it. Both persist locally and to
 * the cloud, so the pick you skipped on your phone stays skipped on the TV.
 */
export function TonightHero({
  film,
  next,
  source,
  onOpen,
}: {
  film: QueueFilm;
  next?: QueueFilm | null;
  source: "shortlist" | "slate" | "mood";
  onOpen: () => void;
}) {
  const links = actionLinks(film);
  const stremio = links.find((l) => l.label === "Stremio");
  const others = links.filter((l) => l.label !== "Stremio");
  const kicker =
    source === "shortlist"
      ? "Tonight · from your shortlist"
      : source === "mood"
        ? "Tonight · for this mood"
        : "Tonight";
  const meta = [
    film.year,
    film.directors?.length ? film.directors.slice(0, 2).join(", ") : null,
    film.runtime ? formatRuntime(film.runtime) : null,
    film.original_language ? languageName(film.original_language) : null,
  ].filter(Boolean);

  return (
    <section
      className="relative mb-12 overflow-hidden rounded-md border border-primary/40 bg-card/60 film-shadow"
      data-testid="tonight-hero"
    >
      {film.backdrop && (
        <div className="absolute inset-0 opacity-30 pointer-events-none">
          <KenBurnsBackdrop path={film.backdrop} size="w1280" className="absolute inset-0" />
          <div className="absolute inset-0 bg-gradient-to-r from-card via-card/85 to-card/40" />
          <div className="absolute inset-0 bg-gradient-to-t from-card via-transparent to-transparent" />
        </div>
      )}
      <div className="relative grid gap-6 p-5 sm:p-7 sm:grid-cols-[160px_1fr] lg:grid-cols-[200px_1fr]">
        <button
          onClick={onOpen}
          className="block w-full max-w-[200px] mx-auto sm:mx-0"
          aria-label={`Open ${film.title}`}
        >
          <Poster
            path={film.poster}
            alt={film.title}
            className="w-full aspect-[2/3] rounded-sm border border-border film-shadow hover:border-primary/60 transition-colors"
          />
        </button>
        <div className="min-w-0 flex flex-col">
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-primary mb-3">
            {kicker}
          </p>
          <button onClick={onOpen} className="text-left">
            <h2 className="font-serif text-3xl sm:text-5xl leading-[1.02] tracking-tight text-foreground hover:text-primary transition-colors text-balance">
              {film.title}
            </h2>
          </button>
          {meta.length > 0 && (
            <p className="font-mono text-xs sm:text-sm text-muted-foreground mt-2.5">
              {meta.join(" · ")}
            </p>
          )}
          {film.reasons?.length > 0 && (
            <ul className="mt-4 space-y-1.5 max-w-xl">
              {film.reasons.slice(0, 3).map((r, i) => (
                <li key={i} className="font-serif italic text-[15px] leading-snug text-foreground/85 flex gap-2.5">
                  <span className="text-primary/70 not-italic font-mono text-[11px] pt-1">→</span>
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          )}

          {/* Where to watch */}
          <div className="mt-6 flex flex-wrap gap-2">
            {stremio && (
              <a
                href={stremio.href}
                target="_blank"
                rel="noopener noreferrer"
                data-testid={`tonight-play-${film.tmdb_id}`}
                className="inline-flex items-center gap-2 rounded-sm bg-primary px-5 py-2.5 font-sans text-sm font-semibold tracking-wide text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                <Play className="h-4 w-4 fill-current" /> Play in Stremio
              </a>
            )}
            {others.map((l) => (
              <a
                key={l.label}
                href={l.href}
                target="_blank"
                rel="noopener noreferrer"
                data-testid={`tonight-link-${l.label.toLowerCase()}-${film.tmdb_id}`}
                className="inline-flex items-center gap-1.5 rounded-sm border border-border bg-card/60 px-3.5 py-2.5 font-sans text-sm font-medium tracking-wide text-foreground/85 hover:border-primary/50 hover:text-primary transition-colors"
              >
                <ExternalLink className="h-3 w-3 opacity-60" /> {l.label}
              </a>
            ))}
          </div>

          {/* Decide */}
          <div className="mt-4">
            <FilmActions film={film} />
          </div>

          {next && (
            <p className="mt-5 font-mono text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground/70 inline-flex items-center gap-1.5">
              <ChevronRight className="h-3 w-3" /> If not: {next.title}
              {next.year ? ` (${next.year})` : ""}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
