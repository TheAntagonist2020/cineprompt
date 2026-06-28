import { useMemo, useState } from "react";
import { useAppData, formatRuntime, languageName, type QueueFilm } from "@/lib/data";
import {
  Poster,
  RatingBar,
  Rationale,
  ActionButtons,
  FilmDetailModal,
  useFilmModal,
  ReviewCallout,
  PairWithCard,
} from "@/components/film-ui";
import { LoadingScreen, PageShell } from "@/components/layout";
import { MoodStrip } from "@/components/mood-strip";
import { useMood, moodMetaByIds, moodPicks } from "@/lib/mood";
import { ChevronDown } from "lucide-react";

function decadeOf(year: string): string {
  const y = parseInt(year, 10);
  if (isNaN(y)) return "—";
  return `${Math.floor(y / 10) * 10}s`;
}

export default function Queue() {
  const { data, loading } = useAppData();
  const modal = useFilmModal();
  const { activeMoods } = useMood();
  const [decade, setDecade] = useState("all");
  const [lang, setLang] = useState("all");
  const [genre, setGenre] = useState("all");
  const [expanded, setExpanded] = useState<number | null>(null);

  const moods = data ? moodMetaByIds(data, activeMoods) : [];
  const moodActive = moods.length > 0;
  const moodLabel = moods.map((m) => m.label).join(" + ");
  const moodKey = activeMoods.join("-") || "all";
  // Source list: mood picks when moods are active, else the standard queue.
  const source = useMemo(() => {
    if (!data) return [];
    return moodActive ? moodPicks(data, activeMoods) : data.queue;
  }, [data, moodActive, activeMoods]);

  const decades = useMemo(() => {
    return Array.from(new Set(source.map((f) => decadeOf(f.year)))).sort();
  }, [source]);
  const genres = useMemo(() => {
    return Array.from(new Set(source.flatMap((f) => f.genres))).sort();
  }, [source]);

  if (loading || !data) return <LoadingScreen />;

  const filtered = source.filter((f) => {
    if (decade !== "all" && decadeOf(f.year) !== decade) return false;
    if (lang === "en" && f.original_language !== "en") return false;
    if (lang === "non" && f.original_language === "en") return false;
    if (genre !== "all" && !f.genres.includes(genre)) return false;
    return true;
  });

  return (
    <>
      <PageShell
        eyebrow={moodActive ? `${source.length} ${moodLabel.toUpperCase()} picks` : "50 films selected for you"}
        title="The Queue"
        intro="A curated watchlist tuned to your gaps and the directors you love. Each pick comes with its reasoning."
      >
        <MoodStrip />

        {/* Filter bar */}
        <div className="sticky top-0 md:top-0 z-20 -mx-5 sm:-mx-8 lg:-mx-14 px-5 sm:px-8 lg:px-14 py-3 mb-8 bg-background/90 backdrop-blur border-y border-border">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <FilterGroup label="Decade" value={decade} onChange={setDecade} options={[{ v: "all", l: "All" }, ...decades.map((d) => ({ v: d, l: d }))]} />
            <FilterGroup
              label="Language"
              value={lang}
              onChange={setLang}
              options={[
                { v: "all", l: "All" },
                { v: "en", l: "English" },
                { v: "non", l: "Non-English" },
              ]}
            />
            <FilterGroup
              label="Genre"
              value={genre}
              onChange={setGenre}
              options={[{ v: "all", l: "All" }, ...genres.map((g) => ({ v: g, l: g }))]}
            />
            <span className="ml-auto font-mono text-xs text-muted-foreground">
              {filtered.length} {filtered.length === 1 ? "film" : "films"}
            </span>
          </div>
        </div>

        {/* Rows */}
        <div className="divide-y divide-border border-t border-border animate-in fade-in duration-200" key={moodKey}>
          {filtered.map((f) => (
            <QueueRow
              key={f.tmdb_id}
              film={f}
              expanded={expanded === f.tmdb_id}
              onToggle={() => setExpanded(expanded === f.tmdb_id ? null : f.tmdb_id)}
              onOpen={() => modal.open(f)}
            />
          ))}
          {filtered.length === 0 && (
            <p className="py-16 text-center font-serif italic text-muted-foreground">
              No films match these filters.
            </p>
          )}
        </div>
      </PageShell>
      <FilmDetailModal film={modal.film} onClose={modal.close} />
    </>
  );
}

function FilterGroup({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { v: string; l: string }[];
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">
        {label}
      </span>
      <div className="flex flex-wrap gap-1">
        {options.map((o) => (
          <button
            key={o.v}
            onClick={() => onChange(o.v)}
            data-testid={`filter-${label.toLowerCase()}-${o.v}`}
            className={`font-mono text-[11px] px-2 py-1 rounded-sm transition-colors ${
              value === o.v
                ? "bg-primary/15 text-primary border border-primary/40"
                : "text-muted-foreground hover:text-foreground border border-transparent"
            }`}
          >
            {o.l}
          </button>
        ))}
      </div>
    </div>
  );
}

function QueueRow({
  film,
  expanded,
  onToggle,
  onOpen,
}: {
  film: QueueFilm;
  expanded: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  return (
    <article className="py-6 group" data-testid={`queue-row-${film.tmdb_id}`}>
      <div className="flex gap-5 sm:gap-7">
        <button onClick={onOpen} className="shrink-0" aria-label={`Open ${film.title}`}>
          <Poster
            path={film.poster}
            alt={film.title}
            className="w-24 sm:w-32 aspect-[2/3] rounded-sm film-shadow group-hover:brightness-110 transition-all"
          />
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-4">
            <div className="min-w-0">
              <button onClick={onOpen} className="text-left">
                <h3 className="font-serif text-2xl sm:text-[28px] leading-tight text-foreground hover:text-primary transition-colors">
                  {film.title}
                </h3>
              </button>
              <p className="font-mono text-xs sm:text-sm text-muted-foreground mt-1.5">
                {film.year}
                {film.directors?.length ? ` · ${film.directors.join(", ")}` : ""}
              </p>
              <p className="font-mono text-[11px] text-muted-foreground/70 mt-1">
                {formatRuntime(film.runtime)} · {languageName(film.original_language)}
                {film.genres?.length ? ` · ${film.genres.join(", ")}` : ""}
              </p>
            </div>
            <span className="ml-auto shrink-0 font-mono text-[11px] text-primary/80 border border-primary/30 rounded-sm px-2 py-1">
              {film.score}
            </span>
          </div>

          {/* Rationale (always visible, the heart of the product) */}
          <div className="mt-4 max-w-2xl">
            <Rationale reasons={film.reasons} />
          </div>

          <div className="mt-4 max-w-xs">
            <RatingBar value={film.vote_average} count={film.vote_count} />
          </div>

          <button
            onClick={onToggle}
            data-testid={`expand-${film.tmdb_id}`}
            className="mt-4 inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.15em] text-muted-foreground hover:text-primary transition-colors"
          >
            {expanded ? "Less" : "Details & where to watch"}
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`}
            />
          </button>

          {expanded && (
            <div className="mt-5 pt-5 border-t border-border space-y-4 animate-in fade-in duration-300">
              {film.tagline && (
                <p className="font-serif italic text-primary/90 text-lg">“{film.tagline}”</p>
              )}
              {film.overview && (
                <p className="text-[15px] leading-relaxed text-foreground/80 max-w-prose">
                  {film.overview}
                </p>
              )}
              <div className="grid sm:grid-cols-2 gap-x-8 gap-y-3">
                {film.cast?.length > 0 && (
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-1">
                      Cast
                    </p>
                    <p className="text-sm text-foreground/75">{film.cast.join(" · ")}</p>
                  </div>
                )}
                {film.writers?.length > 0 && (
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-1">
                      Written by
                    </p>
                    <p className="text-sm text-foreground/75">{film.writers.join(" · ")}</p>
                  </div>
                )}
              </div>
              <ActionButtons film={film} size="sm" />
              {film.user_review && <ReviewCallout review={film.user_review} />}
              {film.pair_with && <PairWithCard pair={film.pair_with} />}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
