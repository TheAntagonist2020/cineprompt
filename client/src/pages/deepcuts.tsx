import { useMemo, useState } from "react";
import { Shuffle, Dices } from "lucide-react";
import { useAppData, formatRuntime, type DeepCutFilm } from "@/lib/data";
import { FocusCard, FilmDetailModal, useFilmModal, Poster, GenreTags } from "@/components/film-ui";
import { LoadingScreen, PageShell } from "@/components/layout";
import { useFilmState } from "@/lib/filmState";

/**
 * The optionality lane. The queue answers "what should I watch"; this answers
 * "what haven't I thought of". Nothing here is competing with the canon — the
 * canon keeps the queue. These are the other doors.
 */

type Sort = "surprise" | "obscure" | "year";

const SORTS: { key: Sort; label: string }[] = [
  { key: "surprise", label: "Most unexpected" },
  { key: "obscure", label: "Least written about" },
  { key: "year", label: "Oldest first" },
];

export default function DeepCuts() {
  const { data, loading } = useAppData();
  const modal = useFilmModal();
  const fs = useFilmState();
  const [sort, setSort] = useState<Sort>("surprise");
  const [drawn, setDrawn] = useState<DeepCutFilm | null>(null);

  const cuts = useMemo(() => {
    const arr = (data?.deep_cuts ?? []).filter((f) => !fs.isHidden(f.tmdb_id));
    const c = [...arr];
    if (sort === "obscure") c.sort((a, b) => (a.vote_count || 0) - (b.vote_count || 0));
    else if (sort === "year") c.sort((a, b) => parseInt(a.year || "9999") - parseInt(b.year || "9999"));
    else c.sort((a, b) => b.surprise - a.surprise);
    return c;
  }, [data, sort, fs]);

  if (loading || !data) return <LoadingScreen />;

  if (!cuts.length) {
    return (
      <PageShell eyebrow="Deep Cuts" title="Deep Cuts">
        <p className="py-16 text-center font-serif italic text-muted-foreground">
          No deep cuts in this build yet — they arrive with the next data rebuild.
        </p>
      </PageShell>
    );
  }

  const wildcard = drawn ?? data.wildcard ?? cuts[0];

  return (
    <PageShell
      eyebrow={`${cuts.length} roads not taken`}
      title="Deep Cuts"
      intro="Scored on a different question than the queue: not what's best, but what would make you stop and say — oh, I hadn't thought of that."
    >
      {/* The daily draw */}
      <div className="mb-10 rounded-md border border-primary/35 bg-primary/[0.06] p-5 sm:p-6">
        <div className="flex items-center gap-3 mb-5">
          <Dices className="h-4 w-4 text-primary" />
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-primary">
            The wildcard
          </p>
          <span className="h-px flex-1 bg-border" />
          <button
            onClick={() => setDrawn(cuts[Math.floor(Math.random() * cuts.length)])}
            data-testid="button-draw-wildcard"
            className="inline-flex items-center gap-2 rounded-sm border border-primary/35 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-primary/85 transition-colors hover:border-primary/60 hover:text-primary"
          >
            <Shuffle className="h-3 w-3" /> Draw again
          </button>
        </div>

        <div className="grid gap-5 sm:grid-cols-[140px_1fr]">
          <button
            onClick={() => modal.open(wildcard)}
            className="block w-full max-w-[140px]"
            aria-label={`Open ${wildcard.title}`}
          >
            <Poster
              path={wildcard.poster}
              alt={wildcard.title}
              className="w-full aspect-[2/3] rounded-sm border border-border hover:border-primary/50 transition-colors"
            />
          </button>
          <div className="min-w-0">
            <button onClick={() => modal.open(wildcard)} className="text-left">
              <h2 className="font-serif text-3xl leading-tight text-foreground hover:text-primary transition-colors">
                {wildcard.title}
              </h2>
            </button>
            <p className="mt-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
              {[wildcard.year, wildcard.directors?.join(", "), formatRuntime(wildcard.runtime)]
                .filter(Boolean)
                .join(" · ")}
            </p>
            {wildcard.genres?.length > 0 && (
              <div className="mt-3">
                <GenreTags genres={wildcard.genres} />
              </div>
            )}
            <ul className="mt-4 space-y-1.5">
              {wildcard.reasons?.slice(0, 4).map((r, i) => (
                <li key={i} className="font-mono text-[11.5px] leading-relaxed text-primary/85">
                  → {r}
                </li>
              ))}
            </ul>
            {wildcard.overview && (
              <p className="mt-4 max-w-prose text-sm leading-relaxed text-muted-foreground line-clamp-4">
                {wildcard.overview}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="mb-6 flex flex-wrap gap-1.5">
        {SORTS.map((s) => (
          <button
            key={s.key}
            onClick={() => setSort(s.key)}
            data-testid={`deepcuts-sort-${s.key}`}
            className={`rounded-sm px-2.5 py-1.5 font-mono text-[11px] transition-colors ${
              sort === s.key
                ? "border border-primary/40 bg-primary/15 text-primary"
                : "border border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-6">
        {cuts.map((f) => (
          <FocusCard
            key={f.tmdb_id}
            film={f}
            onOpen={() => modal.open(f)}
            rationaleLabel="Why this one"
          />
        ))}
      </div>

      <FilmDetailModal film={modal.film} onClose={modal.close} />
    </PageShell>
  );
}
