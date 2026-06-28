import { useMemo, useState } from "react";
import { useAppData } from "@/lib/data";
import {
  BackgroundCard,
  FilmDetailModal,
  useFilmModal,
} from "@/components/film-ui";
import { LoadingScreen, PageShell } from "@/components/layout";
import { MoodStrip } from "@/components/mood-strip";
import { useMood, moodMetaByIds, moodPicks, withKind } from "@/lib/mood";
import type { BackgroundFilm } from "@/lib/data";

type Filter = "all" | "rewatch" | "new";

export default function Background() {
  const { data, loading } = useAppData();
  const modal = useFilmModal();
  const { activeMoods } = useMood();
  const [filter, setFilter] = useState<Filter>("all");

  const moods = data ? moodMetaByIds(data, activeMoods) : [];
  const moodActive = moods.length > 0;
  const moodLabel = moods.map((m) => m.label).join(" + ");
  const moodKey = activeMoods.join("-") || "all";

  // When moods are active: filter the pool to films tagged with ANY selected
  // mood, and add rewatches from mood_picks that carry kind === "rewatch".
  const pool: BackgroundFilm[] = useMemo(() => {
    if (!data) return [];
    if (!moodActive) return data.background_pool ?? [];
    const tagged = (data.background_pool ?? []).filter((f) =>
      f.moods?.some((m) => activeMoods.includes(m)),
    );
    const seen = new Set(tagged.map((f) => f.tmdb_id));
    const rewatches = moodPicks(data, activeMoods)
      .filter((f) => f.kind === "rewatch" && !seen.has(f.tmdb_id))
      .map(withKind) as unknown as BackgroundFilm[];
    return [...tagged, ...rewatches];
  }, [data, moodActive, activeMoods]);

  const counts = useMemo(() => {
    return {
      all: pool.length,
      rewatch: pool.filter((f) => f.kind === "rewatch").length,
      new: pool.filter((f) => f.kind === "new").length,
    };
  }, [pool]);

  if (loading || !data) return <LoadingScreen />;

  const filtered = pool.filter((f) => filter === "all" || f.kind === filter);

  const tabs: { v: Filter; l: string; n: number }[] = [
    { v: "all", l: "All", n: counts.all },
    { v: "rewatch", l: "Rewatches", n: counts.rewatch },
    { v: "new", l: "New finds", n: counts.new },
  ];

  return (
    <>
      <PageShell
        eyebrow={moodActive ? `${pool.length} ${moodLabel.toUpperCase()} films` : `${pool.length} films to live with`}
        title="Background Cinema"
        intro="Films to live with. Rewatches from your archive, ambient new finds, slow cinema that rewards glances."
      >
        <MoodStrip />

        {/* Tabs */}
        <div className="flex flex-wrap items-center gap-2 mb-8 border-b border-border pb-4">
          {tabs.map((t) => (
            <button
              key={t.v}
              onClick={() => setFilter(t.v)}
              data-testid={`bg-filter-${t.v}`}
              className={`font-mono text-[11px] uppercase tracking-[0.14em] px-3 py-1.5 rounded-sm border transition-colors ${
                filter === t.v
                  ? "bg-primary/15 text-primary border-primary/40"
                  : "text-muted-foreground hover:text-foreground border-border"
              }`}
            >
              {t.l}
              <span className="ml-2 text-muted-foreground/60">{t.n}</span>
            </button>
          ))}
        </div>

        {/* Grid */}
        {filtered.length > 0 ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5 animate-in fade-in duration-200" key={moodKey}>
            {filtered.map((f) => (
              <BackgroundCard key={f.tmdb_id} film={f} onOpen={() => modal.open(f)} />
            ))}
          </div>
        ) : (
          <p className="py-16 text-center font-serif italic text-muted-foreground">
            No films in this category yet.
          </p>
        )}
      </PageShell>
      <FilmDetailModal film={modal.film} onClose={modal.close} />
    </>
  );
}
