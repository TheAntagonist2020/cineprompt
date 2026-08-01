import { Fragment, useMemo, useState } from "react";
import { Check, ExternalLink, Filter, Search, Shuffle } from "lucide-react";
import {
  formatNumber,
  letterboxdTmdbUrl,
  posterUrl,
  tmdbUrl,
  useAppData,
  useShard,
  type CollectionFilm,
  type CollectionMeta,
} from "@/lib/data";
import { LoadingScreen, PageShell } from "@/components/layout";

function pctSeen(meta: CollectionMeta): number {
  return meta.total > 0 ? (meta.seen / meta.total) * 100 : 0;
}

function mdblistUrl(meta: CollectionMeta): string {
  if (meta.slug) return `https://mdblist.com/lists/theantagonist2049/${meta.slug}`;
  return `https://mdblist.com/lists/${meta.mdblist_id}`;
}

type ShufflePick = {
  film: CollectionFilm;
  meta: CollectionMeta;
};

export default function Collections() {
  const { data, loading } = useAppData();
  const { shard, loading: shardLoading } = useShard("collections");
  const [query, setQuery] = useState("");
  const [lane, setLane] = useState<string>("all");
  const [open, setOpen] = useState<string | null>(null);
  const [pick, setPick] = useState<ShufflePick | null>(null);

  const laneOptions = useMemo(() => {
    const meta = data?.collections_meta ?? [];
    const seen = new Map<string, CollectionMeta>();
    for (const m of meta) {
      if (!seen.has(m.lane)) seen.set(m.lane, m);
    }
    return Array.from(seen.values()).sort(
      (a, b) => a.lane_order - b.lane_order || a.lane_label.localeCompare(b.lane_label)
    );
  }, [data]);

  const lists = useMemo(() => {
    const meta = data?.collections_meta ?? [];
    const q = query.trim().toLowerCase();
    return meta
      .filter((m) => lane === "all" || m.lane === lane)
      .filter((m) => {
        if (!q) return true;
        return `${m.name} ${m.description} ${m.slug} ${m.lane_label}`
          .toLowerCase()
          .includes(q);
      })
      .sort((a, b) => a.lane_order - b.lane_order || a.name.localeCompare(b.name));
  }, [data, query, lane]);

  const shufflePool = useMemo(() => {
    const collections = shard?.collections ?? {};
    const byFilm = new Map<string, ShufflePick>();
    for (const meta of lists) {
      for (const film of collections[meta.key] ?? []) {
        if (film.seen) continue;
        const key = film.tmdb_id ? `tmdb:${film.tmdb_id}` : `title:${film.title}:${film.year}`;
        if (!byFilm.has(key)) byFilm.set(key, { film, meta });
      }
    }
    return Array.from(byFilm.values());
  }, [shard, lists]);

  function drawRandom() {
    if (!shufflePool.length) return;
    setOpen(null);
    setPick(shufflePool[Math.floor(Math.random() * shufflePool.length)]);
  }

  if (loading || !data || shardLoading) return <LoadingScreen />;

  const collections = shard?.collections ?? {};
  const totalLists = data.collections_meta?.length ?? 0;
  const totalTitles = data.collections_meta?.reduce((sum, m) => sum + m.total, 0) ?? 0;
  const totalUnseen = data.collections_meta?.reduce((sum, m) => sum + m.unseen, 0) ?? 0;
  const totalLanes = laneOptions.length;

  return (
    <PageShell
      eyebrow="MDBList library"
      title="Collections"
      intro="Your compiled list library, preserved as exact TMDB-linked watch terrain."
    >
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mb-6">
        <Metric label="Lists" value={formatNumber(totalLists)} />
        <Metric label="Titles" value={formatNumber(totalTitles)} />
        <Metric label="Unseen" value={formatNumber(totalUnseen)} />
        <Metric label="Lanes" value={formatNumber(totalLanes)} />
      </div>

      <div className="mb-6 grid gap-3">
        <div className="flex gap-2 overflow-x-auto pb-1">
          <LaneButton
            label="All"
            active={lane === "all"}
            onClick={() => {
              setLane("all");
              setOpen(null);
              setPick(null);
            }}
          />
          {laneOptions.map((option) => (
            <LaneButton
              key={option.lane}
              label={option.lane_label}
              active={lane === option.lane}
              onClick={() => {
                setLane(option.lane);
                setOpen(null);
                setPick(null);
              }}
            />
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <label className="relative block">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPick(null);
              }}
              placeholder="Search collections"
              className="h-11 w-full rounded-sm border border-border bg-card/30 pl-10 pr-3 font-mono text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary/60"
            />
          </label>
          <button
            type="button"
            onClick={drawRandom}
            disabled={!shufflePool.length}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-sm border border-primary/35 bg-primary/10 px-4 font-mono text-[11px] uppercase tracking-[0.16em] text-primary transition-colors hover:border-primary/60 hover:bg-primary/15 disabled:border-border disabled:bg-card/20 disabled:text-muted-foreground"
          >
            <Shuffle className="h-4 w-4" />
            Shuffle unseen
          </button>
        </div>
      </div>

      {pick && <ShufflePickCard pick={pick} onShuffle={drawRandom} />}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 sm:gap-6">
        {lists.map((meta) => {
          const expanded = open === meta.key;
          const pct = pctSeen(meta);
          return (
            <Fragment key={meta.key}>
              <button
                onClick={() => setOpen(expanded ? null : meta.key)}
                aria-expanded={expanded}
                className={`text-left rounded-md border bg-card/40 p-5 transition-colors ${
                  expanded ? "border-primary/50" : "border-border hover:border-primary/40"
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <span className="mb-3 inline-flex items-center gap-1 rounded-sm border border-primary/30 bg-primary/10 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-primary/80">
                      <Filter className="h-3 w-3" />
                      {meta.lane_label}
                    </span>
                    <h2 className="font-serif text-2xl leading-tight text-foreground">
                      {meta.name}
                    </h2>
                    {meta.description && (
                      <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
                        {meta.description}
                      </p>
                    )}
                  </div>
                  <span className="shrink-0 rounded-sm border border-border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                    {formatNumber(meta.total)}
                  </span>
                </div>

                <div className="mt-5 flex items-baseline gap-3">
                  <span className="font-serif text-5xl text-primary leading-none">
                    {pct.toFixed(0)}%
                  </span>
                  <span className="font-mono text-xs uppercase tracking-[0.16em] text-muted-foreground">
                    seen
                  </span>
                </div>
                <div className="mt-4 h-1.5 bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                </div>
                <div className="mt-3 flex items-center justify-between gap-3">
                  <p className="font-mono text-sm text-muted-foreground tabular-nums">
                    {formatNumber(meta.seen)} seen / {formatNumber(meta.unseen)} unseen
                  </p>
                  <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-primary/70">
                    {expanded ? "Hide" : "Open"}
                  </span>
                </div>
              </button>
              {expanded && collections[meta.key] && (
                <CollectionGrid meta={meta} films={collections[meta.key]} />
              )}
            </Fragment>
          );
        })}
      </div>
    </PageShell>
  );
}

function ShufflePickCard({
  pick,
  onShuffle,
}: {
  pick: ShufflePick;
  onShuffle: () => void;
}) {
  const href = pick.film.tmdb_id ? tmdbUrl(pick.film.tmdb_id, pick.film.title) : tmdbUrl(null, pick.film.title);
  return (
    <div className="mb-6 grid gap-4 rounded-md border border-primary/40 bg-primary/10 p-4 sm:grid-cols-[96px_1fr_auto]">
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="block aspect-[2/3] w-24 overflow-hidden rounded-sm border border-primary/20 bg-muted"
      >
        {posterUrl(pick.film.poster, "w342") ? (
          <img
            src={posterUrl(pick.film.poster, "w342") ?? ""}
            alt=""
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center px-2 text-center font-serif text-sm text-muted-foreground">
            {pick.film.title}
          </div>
        )}
      </a>
      <div className="min-w-0">
        <div className="flex flex-wrap gap-2">
          <span className="rounded-sm border border-primary/30 bg-background/40 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-primary/80">
            {pick.meta.lane_label}
          </span>
          <span className="rounded-sm border border-border bg-background/30 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {pick.meta.name}
          </span>
        </div>
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 block font-serif text-3xl leading-tight text-foreground hover:text-primary"
        >
          {pick.film.title}
        </a>
        <p className="mt-2 font-mono text-xs uppercase tracking-[0.14em] text-muted-foreground">
          {pick.film.year || "Undated"} / Unseen
        </p>
        {pick.film.overview && (
          <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-muted-foreground">
            {pick.film.overview}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={onShuffle}
        className="inline-flex h-10 items-center justify-center gap-2 rounded-sm border border-primary/35 px-3 font-mono text-[11px] uppercase tracking-[0.16em] text-primary/85 transition-colors hover:border-primary/60 hover:text-primary sm:self-start"
      >
        <Shuffle className="h-4 w-4" />
        Again
      </button>
    </div>
  );
}

function LaneButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 rounded-sm border px-3 py-2 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors ${
        active
          ? "border-primary/60 bg-primary/15 text-primary"
          : "border-border bg-card/25 text-muted-foreground hover:border-primary/40 hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-card/30 p-4">
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-2 font-serif text-3xl text-foreground">{value}</p>
    </div>
  );
}

function CollectionGrid({
  meta,
  films,
}: {
  meta?: CollectionMeta;
  films: CollectionFilm[];
}) {
  const CAP = 600;
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? films : films.slice(0, CAP);
  return (
    <div className="animate-in fade-in duration-300 md:col-span-2">
      <div className="flex items-center gap-4 mb-6">
        <h3 className="font-mono text-[12px] uppercase tracking-[0.28em] text-muted-foreground">
          {meta?.name ?? "Collection"}
        </h3>
        <span className="h-px flex-1 bg-border" />
        {meta && (
          <a
            href={mdblistUrl(meta)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-[0.14em] text-primary/80 hover:text-primary"
          >
            MDBList <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {shown.map((film, i) => {
          const href = film.seen
            ? film.tmdb_id
              ? letterboxdTmdbUrl(film.tmdb_id)
              : tmdbUrl(null, film.title)
            : tmdbUrl(film.tmdb_id, film.title);
          return (
            <a
              key={`${film.tmdb_id ?? film.title}-${i}`}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className={`cv-card group rounded-sm border bg-card/20 transition-colors ${
                film.seen
                  ? "border-primary/30 hover:border-primary/60"
                  : "border-border/60 hover:border-primary/40"
              }`}
            >
              <div className="aspect-[2/3] overflow-hidden rounded-t-sm bg-muted">
                {posterUrl(film.poster, "w342") ? (
                  <img
                    src={posterUrl(film.poster, "w342") ?? ""}
                    alt=""
                    loading="lazy"
                    className={`h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03] ${
                      film.seen ? "opacity-70 saturate-75" : ""
                    }`}
                  />
                ) : (
                  <div className="flex h-full items-center justify-center px-3 text-center font-serif text-sm text-muted-foreground">
                    {film.title}
                  </div>
                )}
              </div>
              <div className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <span
                    className={`font-mono text-[9px] uppercase tracking-[0.14em] inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 ${
                      film.seen
                        ? "text-primary border border-primary/40 bg-primary/10"
                        : "text-muted-foreground/60 border border-border/60"
                    }`}
                  >
                    {film.seen ? <Check className="h-2.5 w-2.5" /> : null}
                    {film.seen ? "Seen" : "Unseen"}
                  </span>
                  <span className="font-mono text-[10px] text-muted-foreground/60 tabular-nums">
                    {film.year || ""}
                  </span>
                </div>
                <p className="mt-2 line-clamp-2 font-serif text-[15px] leading-snug text-foreground group-hover:text-primary">
                  {film.title}
                </p>
              </div>
            </a>
          );
        })}
      </div>
      {!showAll && films.length > CAP && (
        <button
          onClick={() => setShowAll(true)}
          className="mt-6 rounded-sm border border-primary/30 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-primary/80 transition-colors hover:border-primary/60 hover:text-primary"
        >
          Show all {formatNumber(films.length)} titles
        </button>
      )}
    </div>
  );
}
