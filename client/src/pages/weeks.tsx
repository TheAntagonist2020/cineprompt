import {
  useAppData,
  tmdbUrl,
  letterboxdTmdbUrl,
  type ThemedWeek,
  type ThemedWeekFilm,
} from "@/lib/data";
import { Poster } from "@/components/film-ui";
import { LoadingScreen, PageShell } from "@/components/layout";

export default function Weeks() {
  const { data, loading } = useAppData();
  if (loading || !data) return <LoadingScreen />;

  const weeks = data.themed_weeks ?? [];

  return (
    <PageShell
      eyebrow={`${weeks.length} themed weeks`}
      title="Themes"
      intro="Self-contained seasons of cinema — a week of films built around a movement, a mood, or an idea. The amber dot marks the ones you've already seen."
    >
      <div className="space-y-12">
        {weeks.map((w) => (
          <WeekCard key={w.slug} week={w} />
        ))}
        {weeks.length === 0 && (
          <p className="font-serif italic text-muted-foreground">No themed weeks yet.</p>
        )}
      </div>
    </PageShell>
  );
}

function WeekCard({ week }: { week: ThemedWeek }) {
  return (
    <article
      className="rounded-md border border-border bg-card/30 p-6 sm:p-8"
      data-testid={`week-card-${week.slug}`}
    >
      <div className="flex items-baseline justify-between gap-4 flex-wrap">
        <h2 className="font-serif text-3xl sm:text-4xl tracking-tight text-foreground">
          {week.title}
        </h2>
        <span className="font-mono text-xs uppercase tracking-[0.16em] text-primary/80 shrink-0">
          {week.seen_count}/{week.total} seen
        </span>
      </div>
      <p className="text-muted-foreground mt-3 max-w-3xl leading-relaxed text-[15px]">
        {week.intro}
      </p>

      <div className="mt-6 -mx-1 flex gap-4 overflow-x-auto hide-scrollbar pb-2 px-1">
        {week.films.map((f, i) => (
          <WeekFilm key={`${f.tmdb_id}-${i}`} film={f} />
        ))}
      </div>
    </article>
  );
}

function WeekFilm({ film }: { film: ThemedWeekFilm }) {
  const href = film.seen ? letterboxdTmdbUrl(film.tmdb_id) : tmdbUrl(film.tmdb_id, film.title);
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      data-testid={`week-film-${film.tmdb_id}`}
      className="group shrink-0 w-[120px] sm:w-[132px]"
    >
      <div className="relative">
        <Poster
          path={film.poster}
          alt={film.title}
          className="w-full aspect-[2/3] rounded-sm border border-border group-hover:border-primary/50 transition-colors"
        />
        {film.seen && (
          <span
            className="absolute top-2 right-2 h-2.5 w-2.5 rounded-full bg-primary ring-2 ring-background"
            aria-label="Seen"
          />
        )}
      </div>
      <p
        className={`font-serif text-sm leading-tight mt-2 line-clamp-2 transition-colors ${
          film.seen ? "text-foreground/80 group-hover:text-primary" : "text-foreground group-hover:text-primary"
        }`}
      >
        {film.title}
      </p>
      <p className="font-mono text-[10px] text-muted-foreground/60 mt-0.5">{film.year}</p>
    </a>
  );
}
