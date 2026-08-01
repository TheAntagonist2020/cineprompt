import { Link, useParams } from "wouter";
import {
  useAppData,
  useDirector,
  formatRuntime,
  tmdbUrl,
  stripHtml,
  type DirectorFilm,
  type DirectorTarget,
  type DirectorTargetFilm,
  type ReviewQuote,
} from "@/lib/data";
import { Poster, ActionButtons, RatingBar, KenBurnsBackdrop } from "@/components/film-ui";
import { LoadingScreen } from "@/components/layout";
import { ArrowLeft, Check, Star, Plus } from "lucide-react";

export default function DirectorDetail() {
  const { data, loading } = useAppData();
  const params = useParams();
  const param = decodeURIComponent(params.name || "");

  // Routes are slug-based now, but links shared before the change used the
  // director's name — resolve either through the core index.
  const slug = data
    ? data.directors_index[param]?.slug ??
      (Object.values(data.directors_index).some((d) => d.slug === param) ? param : undefined)
    : undefined;

  const { director: dir, loading: dirLoading } = useDirector(slug);

  if (loading || !data || (slug && dirLoading)) return <LoadingScreen />;

  const name = dir?.name ?? param;

  if (!dir) {
    return (
      <div className="px-6 py-24 text-center">
        <p className="font-serif text-3xl text-foreground mb-4">Director not found</p>
        <Link href="/directors">
          <span className="font-mono text-sm text-primary cursor-pointer">← Back to library</span>
        </Link>
      </div>
    );
  }

  const loved = data.blindspots.loved_directors.find((d) => d.name === name);

  // chronological
  const films = [...dir.films].sort((a, b) => {
    const ya = parseInt(a.year, 10) || 9999;
    const yb = parseInt(b.year, 10) || 9999;
    return ya - yb;
  });

  // hero backdrop from a seen film with a backdrop, else any
  const heroFilm =
    films.find((f) => f.seen && f.backdrop) ||
    films.find((f) => f.backdrop) ||
    films.find((f) => f.seen && f.poster);
  const pct = dir.total > 0 ? Math.round((dir.seen / dir.total) * 100) : 0;

  const target = data.director_targets?.[name];
  const quotes = (dir.quotes ?? []).slice(0, 3);

  return (
    <div className="pb-12">
      {/* Hero */}
      <div className="relative h-[40vh] min-h-[280px] max-h-[440px] w-full overflow-hidden">
        <KenBurnsBackdrop path={heroFilm?.backdrop} size="original" className="absolute inset-0" />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/75 to-background/30" />
      </div>

      <div className="px-5 sm:px-8 lg:px-14 max-w-[1180px] mx-auto -mt-32 relative">
        <Link href="/directors" data-testid="back-directors">
          <span className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground hover:text-primary cursor-pointer mb-6">
            <ArrowLeft className="h-3.5 w-3.5" /> Library
          </span>
        </Link>

        <h1 className="font-serif text-4xl sm:text-6xl tracking-tight text-foreground text-balance">
          {name}
        </h1>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mt-4">
          <span className="font-mono text-sm text-foreground">
            <span className="text-primary text-lg">{dir.seen}</span> seen
            <span className="text-muted-foreground"> / {dir.total} films</span>
          </span>
          {loved && (
            <span className="font-mono text-sm text-primary">{loved.avg_rating.toFixed(1)}★ your avg</span>
          )}
          <span className="font-mono text-sm text-muted-foreground">{pct}% complete</span>
        </div>

        <div className="mt-4 max-w-md h-1.5 bg-muted rounded-full overflow-hidden">
          <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
        </div>

        {/* Completion target */}
        {target && <CompletionTarget name={name} target={target} />}

        {/* Your reviews */}
        {quotes.length > 0 && <YourReviews quotes={quotes} />}

        {/* Filmography */}
        <div className="mt-12">
          <div className="flex items-center gap-4 mb-6">
            <h2 className="font-mono text-[12px] uppercase tracking-[0.28em] text-muted-foreground">
              Filmography
            </h2>
            <span className="h-px flex-1 bg-border" />
          </div>

          <div className="divide-y divide-border border-t border-border">
            {films.map((f) => (
              <FilmRow key={f.tmdb_id} film={f} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function CompletionTarget({ name, target }: { name: string; target: DirectorTarget }) {
  return (
    <div
      className="mt-10 rounded-md border border-primary/30 bg-primary/[0.05] p-5 sm:p-6"
      data-testid="completion-target"
    >
      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-primary mb-3">
        Completion target
      </p>
      <p className="font-serif text-lg sm:text-xl text-foreground/90 leading-snug">
        <span className="text-primary">{target.seen_count}</span> seen ·{" "}
        <span className="text-foreground">{target.unseen_quality_count}</span> unseen ·{" "}
        <span className="text-primary">{target.total_runtime_hours}h</span> to complete
      </p>

      {target.next_up?.length > 0 && (
        <div className="mt-5">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-3">
            Queue these next
          </p>
          <div className="-mx-1 flex gap-4 overflow-x-auto hide-scrollbar pb-2 px-1">
            {target.next_up.map((f) => (
              <NextUpCard key={f.tmdb_id} film={f} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function NextUpCard({ film }: { film: DirectorTargetFilm }) {
  return (
    <div className="shrink-0 w-[128px]" data-testid={`next-up-${film.tmdb_id}`}>
      <a href={tmdbUrl(film.tmdb_id, film.title)} target="_blank" rel="noopener noreferrer" className="group block">
        <Poster
          path={film.poster}
          alt={film.title}
          className="w-full aspect-[2/3] rounded-sm border border-border group-hover:border-primary/50 transition-colors"
        />
        <p className="font-serif text-sm leading-tight mt-2 line-clamp-2 text-foreground group-hover:text-primary transition-colors">
          {film.title}
        </p>
      </a>
      <p className="font-mono text-[10px] text-muted-foreground/70 mt-0.5">
        {film.year}
        {film.runtime ? ` · ${formatRuntime(film.runtime)}` : ""}
      </p>
      <p className="font-mono text-[10px] text-primary/80 mt-0.5 flex items-center gap-1">
        <Star className="h-2.5 w-2.5 fill-primary text-primary" />
        {film.vote_average ? film.vote_average.toFixed(1) : "—"}
      </p>
      <a
        href={tmdbUrl(film.tmdb_id, film.title)}
        target="_blank"
        rel="noopener noreferrer"
        data-testid={`add-queue-${film.tmdb_id}`}
        className="mt-2 inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.14em] text-foreground/80 border border-border rounded-sm px-2 py-1 hover:border-primary/50 hover:text-primary transition-colors"
      >
        <Plus className="h-2.5 w-2.5" /> Add to Queue
      </a>
    </div>
  );
}

function YourReviews({ quotes }: { quotes: ReviewQuote[] }) {
  return (
    <div className="mt-10" data-testid="your-reviews">
      <div className="flex items-center gap-4 mb-5">
        <h2 className="font-mono text-[12px] uppercase tracking-[0.28em] text-primary">
          Your reviews
        </h2>
        <span className="h-px flex-1 bg-border" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {quotes.map((q, i) => {
          const full = Math.max(0, Math.min(5, Math.round(q.rating)));
          const snippet = stripHtml(q.snippet);
          return (
            <div
              key={`${q.title}-${i}`}
              className="rounded-md border border-border/60 bg-card/30 p-4"
              data-testid={`review-quote-${i}`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <p className="font-serif text-base leading-tight text-foreground">
                  {q.title} <span className="text-muted-foreground/60 font-mono text-xs">{q.year}</span>
                </p>
              </div>
              {q.rating > 0 && (
                <div className="flex items-center gap-0.5 mt-1.5">
                  {[0, 1, 2, 3, 4].map((s) => (
                    <Star
                      key={s}
                      className={`h-3 w-3 ${s < full ? "fill-primary text-primary" : "text-muted-foreground/40"}`}
                    />
                  ))}
                </div>
              )}
              {snippet && (
                <blockquote className="font-serif italic text-[13.5px] leading-relaxed text-foreground/80 border-l-2 border-primary/40 pl-3 mt-3 line-clamp-5">
                  {snippet}
                </blockquote>
              )}
              {q.uri && (
                <a
                  href={q.uri}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-block font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground hover:text-primary transition-colors"
                >
                  View on Letterboxd ↗
                </a>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FilmRow({ film }: { film: DirectorFilm }) {
  return (
    <article className="py-5 flex gap-4 sm:gap-5" data-testid={`film-${film.tmdb_id}`}>
      <span className="font-mono text-sm text-muted-foreground pt-1 w-12 shrink-0 tabular-nums">
        {film.year || "—"}
      </span>
      <Poster
        path={film.poster}
        alt={film.title}
        className="w-14 sm:w-16 aspect-[2/3] rounded-sm shrink-0"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-3">
          <h3 className="font-serif text-lg sm:text-xl leading-tight text-foreground">
            {film.title}
          </h3>
          {film.seen ? (
            <span className="ml-auto shrink-0 inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.15em] text-primary border border-primary/40 bg-primary/10 rounded-sm px-2 py-1">
              <Check className="h-3 w-3" /> Seen
            </span>
          ) : null}
        </div>

        {film.vote_average > 0 && (
          <div className="mt-2 max-w-[200px]">
            <RatingBar value={film.vote_average} count={film.vote_count} />
          </div>
        )}

        {film.overview && (
          <p className="text-sm text-muted-foreground mt-2 line-clamp-2 max-w-prose">
            {film.overview}
          </p>
        )}

        {!film.seen && (
          <div className="mt-3">
            <ActionButtons film={{ tmdb_id: film.tmdb_id, title: film.title }} size="sm" />
          </div>
        )}
      </div>
    </article>
  );
}
