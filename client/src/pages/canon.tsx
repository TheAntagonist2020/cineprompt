import { useState } from "react";
import { Check } from "lucide-react";
import { useAppData, useShard, tmdbUrl, letterboxdTmdbUrl, type CanonFilm } from "@/lib/data";
import { LoadingScreen, PageShell } from "@/components/layout";

interface ListMeta {
  key: string;
  name: string;
}

const LIST_ORDER: ListMeta[] = [
  { key: "best_picture", name: "Best Picture Winners" },
  { key: "sight_and_sound_2022", name: "Sight & Sound 2022" },
  { key: "afi_100", name: "AFI 100 Years…100 Movies" },
  { key: "criterion", name: "Criterion Collection" },
];

function pctSeen(films: CanonFilm[]): { seen: number; total: number; pct: number } {
  const total = films.length;
  const seen = films.filter((f) => f.seen).length;
  const pct = total > 0 ? (seen / total) * 100 : 0;
  return { seen, total, pct };
}

export default function Canon() {
  const { data, loading } = useAppData();
  const { shard, loading: shardLoading } = useShard("canon");
  const [open, setOpen] = useState<string | null>(null);
  if (loading || !data || shardLoading) return <LoadingScreen />;

  const canon = shard?.canon ?? {};
  // Prefer the data-driven order/names (canon_meta, written by build_lists.py);
  // fall back to the built-in order for older data.
  const order = data.canon_meta?.length ? data.canon_meta : LIST_ORDER;
  const lists = order.filter((l) => Array.isArray(canon[l.key]));

  return (
    <PageShell
      eyebrow="Canon coverage"
      title="The Canon"
      intro="How much of the agreed-upon greats you've actually seen. Click any list to inspect every title and fill the gaps."
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 sm:gap-6">
        {lists.map((l) => {
          const films = canon[l.key];
          const { seen, total, pct } = pctSeen(films);
          const expanded = open === l.key;
          return (
            <button
              key={l.key}
              onClick={() => setOpen(expanded ? null : l.key)}
              data-testid={`canon-card-${l.key}`}
              aria-expanded={expanded}
              className={`text-left rounded-md border bg-card/40 p-6 transition-colors ${
                expanded ? "border-primary/50" : "border-border hover:border-primary/40"
              }`}
            >
              <h2 className="font-serif text-2xl sm:text-3xl leading-tight text-foreground">
                {l.name}
              </h2>
              <div className="mt-4 flex items-baseline gap-3">
                <span className="font-serif text-5xl sm:text-6xl text-primary leading-none">
                  {pct.toFixed(1)}%
                </span>
                <span className="font-mono text-xs uppercase tracking-[0.16em] text-muted-foreground">
                  seen
                </span>
              </div>
              <div className="mt-4 h-1.5 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
              </div>
              <p className="font-mono text-sm text-muted-foreground mt-3 tabular-nums">
                {seen} of {total} seen
              </p>
              <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-primary/70 mt-2">
                {expanded ? "Hide titles ↑" : "Show all titles ↓"}
              </p>
            </button>
          );
        })}
      </div>

      {open && Array.isArray(canon[open]) && (
        <CanonGrid
          key={open}
          name={order.find((l) => l.key === open)?.name ?? open}
          films={canon[open]}
        />
      )}
    </PageShell>
  );
}

function CanonGrid({ name, films }: { name: string; films: CanonFilm[] }) {
  // Cap the initial render so expanding a 1,700-title list stays snappy; the
  // counts/percentages above are still computed over the full list.
  const CAP = 600;
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? films : films.slice(0, CAP);
  return (
    <div className="mt-10 animate-in fade-in duration-300" data-testid="canon-grid">
      <div className="flex items-center gap-4 mb-6">
        <h3 className="font-mono text-[12px] uppercase tracking-[0.28em] text-muted-foreground">
          {name}
        </h3>
        <span className="h-px flex-1 bg-border" />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {shown.map((f, i) => {
          const href = f.seen
            ? f.tmdb_id
              ? letterboxdTmdbUrl(f.tmdb_id)
              : tmdbUrl(null, f.title)
            : tmdbUrl(f.tmdb_id, f.title);
          return (
            <a
              key={`${f.title}-${f.year}-${i}`}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              data-testid={`canon-film-${i}`}
              className={`group flex flex-col rounded-sm border p-3.5 transition-colors ${
                f.seen
                  ? "border-primary/30 bg-primary/[0.06] hover:border-primary/60"
                  : "border-border/60 bg-card/20 hover:border-primary/40"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <span
                  className={`font-mono text-[9px] uppercase tracking-[0.14em] inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 ${
                    f.seen
                      ? "text-primary border border-primary/40 bg-primary/10"
                      : "text-muted-foreground/60 border border-border/60"
                  }`}
                >
                  {f.seen ? <Check className="h-2.5 w-2.5" /> : null}
                  {f.seen ? "Seen" : "Unseen"}
                </span>
                <span className="font-mono text-[10px] text-muted-foreground/60 tabular-nums">
                  {f.year}
                </span>
              </div>
              <p
                className={`font-serif text-[15px] leading-snug mt-2.5 ${
                  f.seen
                    ? "text-foreground group-hover:text-primary"
                    : "text-foreground/65 group-hover:text-foreground"
                } transition-colors`}
              >
                {f.title}
              </p>
            </a>
          );
        })}
      </div>
      {!showAll && films.length > CAP && (
        <button
          onClick={() => setShowAll(true)}
          data-testid="canon-show-all"
          className="mt-6 font-mono text-[11px] uppercase tracking-[0.16em] text-primary/80 hover:text-primary border border-primary/30 hover:border-primary/60 rounded-sm px-4 py-2 transition-colors"
        >
          Show all {films.length} titles ↓
        </button>
      )}
    </div>
  );
}
