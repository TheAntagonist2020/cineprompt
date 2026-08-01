import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, X, Star, StarHalf, ExternalLink, ArrowDownAZ, Film } from "lucide-react";
import {
  useAppData,
  useShard,
  letterboxdSlugUrl,
  type TagEntry,
  type TagFilm,
  type TagCategory,
} from "@/lib/data";
import { LoadingScreen, PageShell } from "@/components/layout";

// Category dot colors keyed off the existing amber-led palette.
const CAT_COLOR: Record<TagCategory, string> = {
  director: "hsl(38 55% 60%)",
  genre: "hsl(200 45% 58%)",
  channel: "hsl(280 35% 64%)",
  viewing: "hsl(150 35% 55%)",
  other: "hsl(40 8% 55%)",
};

const CAT_LABEL: Record<TagCategory, string> = {
  director: "Director",
  genre: "Genre",
  channel: "Channel",
  viewing: "Viewing",
  other: "Other",
};

// Single-select category filter row.
const CATEGORY_FILTERS: { key: "all" | TagCategory; label: string }[] = [
  { key: "all", label: "All" },
  { key: "director", label: "Directors" },
  { key: "genre", label: "Genres" },
  { key: "channel", label: "Channels" },
  { key: "other", label: "Other" },
];

type SortMode = "films" | "az";

function filmKey(f: { title: string; year: number }): string {
  return `${f.title}|${f.year}`;
}

// ---------- Small filled-star rating row for diary ratings (supports half) ----------
function Stars({ rating }: { rating: number }) {
  const r = Math.max(0, Math.min(5, rating || 0));
  const full = Math.floor(r);
  const hasHalf = r - full >= 0.25 && r - full < 0.75;
  const fullCount = r - full >= 0.75 ? full + 1 : full;
  return (
    <span
      className="flex items-center gap-0.5"
      aria-label={`${r} out of 5 stars`}
    >
      {[0, 1, 2, 3, 4].map((i) => {
        if (i < fullCount)
          return <Star key={i} className="h-3 w-3 fill-primary text-primary" />;
        if (hasHalf && i === full)
          return (
            <span key={i} className="relative inline-flex">
              <Star className="h-3 w-3 text-muted-foreground/30" />
              <StarHalf className="h-3 w-3 fill-primary text-primary absolute inset-0" />
            </span>
          );
        return <Star key={i} className="h-3 w-3 text-muted-foreground/30" />;
      })}
    </span>
  );
}

// ---------- A single tag card in the cloud ----------
function TagCard({
  name,
  entry,
  selected,
  onToggle,
  onSelectRelated,
}: {
  name: string;
  entry: TagEntry;
  selected: boolean;
  onToggle: () => void;
  onSelectRelated: (tag: string) => void;
}) {
  const cat = (entry.category || "other") as TagCategory;
  const related = (entry.related_tags || []).slice(0, 4);
  return (
    <div
      className={`group relative flex flex-col rounded-md border bg-card/40 p-4 transition-colors ${
        selected
          ? "border-primary/70 ring-1 ring-primary/40 bg-primary/[0.06]"
          : "border-border hover:border-primary/40"
      }`}
      data-testid={`tag-card-${name}`}
    >
      <button
        onClick={onToggle}
        className="text-left flex items-start gap-2.5"
        aria-pressed={selected}
      >
        <span
          className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
          style={{ background: CAT_COLOR[cat] }}
          aria-hidden
        />
        <span className="min-w-0">
          <span className="block font-sans font-medium text-[15px] leading-tight text-foreground group-hover:text-primary transition-colors capitalize">
            {name}
          </span>
          <span className="mt-1 flex items-baseline gap-2">
            <span className="font-mono text-primary text-sm tabular-nums">
              {entry.unique_films}
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
              films
            </span>
            <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground/45 ml-auto">
              {CAT_LABEL[cat]}
            </span>
          </span>
        </span>
      </button>

      {/* Related tags revealed on hover */}
      {related.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5 opacity-0 max-h-0 overflow-hidden group-hover:opacity-100 group-hover:max-h-24 transition-all duration-300">
          {related.map((r) => (
            <button
              key={r}
              onClick={(e) => {
                e.stopPropagation();
                onSelectRelated(r);
              }}
              data-testid={`tag-related-${r}`}
              className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground border border-border/70 rounded-full px-2 py-0.5 hover:border-primary/50 hover:text-primary transition-colors capitalize"
            >
              {r}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- A letterboxd film card in the detail panel ----------
function LetterboxdCard({ film }: { film: TagFilm }) {
  const href = film.uri || letterboxdSlugUrl(film.title);
  return (
    <div
      className="flex flex-col rounded-sm border border-border/60 bg-card/30 p-3.5 hover:border-primary/45 transition-colors"
      data-testid={`tag-film-${film.title}-${film.year}`}
    >
      <p className="font-serif text-[15px] leading-tight text-foreground line-clamp-2">
        {film.title}
      </p>
      <p className="font-mono text-[10px] text-muted-foreground/70 mt-1 tabular-nums">
        {film.year}
        {film.director ? ` · ${film.director}` : ""}
      </p>
      <div className="mt-2">
        <Stars rating={film.rating} />
      </div>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-2.5 inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground hover:text-primary transition-colors"
      >
        view on letterboxd <ExternalLink className="h-2.5 w-2.5" />
      </a>
    </div>
  );
}

export default function Tags() {
  const { data, loading } = useAppData();
  const { shard, loading: shardLoading } = useShard("tags");
  const [category, setCategory] = useState<"all" | TagCategory>("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortMode>("films");
  const [selected, setSelected] = useState<string[]>([]);

  const tagsObj = shard?.tags ?? {};
  const meta = data?.diary_meta;

  // Precompute a Set of "title|year" per tag for fast intersection.
  const tagFilmSets = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const [name, entry] of Object.entries(tagsObj)) {
      m.set(name, new Set(entry.films.map(filmKey)));
    }
    return m;
  }, [tagsObj]);

  const displayed = useMemo(() => {
    let entries = Object.entries(tagsObj) as [string, TagEntry][];
    if (category !== "all") {
      entries = entries.filter(([, e]) => (e.category || "other") === category);
    }
    const q = search.trim().toLowerCase();
    if (q) {
      entries = entries.filter(([name]) => name.toLowerCase().includes(q));
    }
    entries.sort((a, b) => {
      if (sort === "az") return a[0].localeCompare(b[0]);
      return b[1].unique_films - a[1].unique_films || a[0].localeCompare(b[0]);
    });
    return entries;
  }, [tagsObj, category, search, sort]);

  function toggleTag(name: string) {
    setSelected((prev) =>
      prev.includes(name) ? prev.filter((t) => t !== name) : [...prev, name],
    );
  }

  // Selecting a related tag: make it the sole selection so the panel swaps.
  function selectRelated(name: string) {
    if (!tagsObj[name]) return;
    setSelected([name]);
  }

  // Build the detail panel film list (intersection across selected tags).
  const detail = useMemo(() => {
    if (selected.length === 0) return null;
    const valid = selected.filter((t) => tagsObj[t]);
    if (valid.length === 0) return null;

    if (valid.length === 1) {
      const e = tagsObj[valid[0]];
      const films = [...e.films].sort(
        (a, b) => b.rating - a.rating || a.title.localeCompare(b.title),
      );
      return { tags: valid, films, single: true as const, entry: e };
    }

    // Intersection: a film must appear in every selected tag's set.
    const sets = valid.map((t) => tagFilmSets.get(t)!).filter(Boolean);
    const base = tagsObj[valid[0]].films;
    const seen = new Set<string>();
    const films = base.filter((f) => {
      const k = filmKey(f);
      if (seen.has(k)) return false;
      if (!sets.every((s) => s.has(k))) return false;
      seen.add(k);
      return true;
    });
    films.sort((a, b) => b.rating - a.rating || a.title.localeCompare(b.title));
    return { tags: valid, films, single: false as const, entry: null };
  }, [selected, tagsObj, tagFilmSets]);

  if (loading || !data || shardLoading) return <LoadingScreen />;

  const subtitle = meta
    ? `${meta.total_tags} hand-curated tags across ${meta.total_entries.toLocaleString()} diary entries`
    : `${Object.keys(tagsObj).length} hand-curated tags`;

  return (
    <PageShell eyebrow="Diary index" title="Tags" intro={subtitle}>
      {/* Controls */}
      <div className="mb-8 space-y-4">
        {/* Category filter row */}
        <div className="flex flex-wrap gap-2" data-testid="tag-category-row">
          {CATEGORY_FILTERS.map((c) => {
            const active = category === c.key;
            return (
              <button
                key={c.key}
                onClick={() => setCategory(c.key)}
                data-testid={`tag-category-${c.key}`}
                className={`font-mono text-[10.5px] uppercase tracking-[0.16em] px-3.5 py-1.5 rounded-full border transition-all duration-200 ${
                  active
                    ? "bg-primary text-primary-foreground border-primary font-medium"
                    : "border-border/70 text-foreground/70 hover:text-foreground hover:border-primary/40"
                }`}
              >
                {c.label}
              </button>
            );
          })}
        </div>

        {/* Search + sort */}
        <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/60" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="filter tags…"
              data-testid="tag-search-input"
              className="w-full bg-card/40 border border-border rounded-sm pl-9 pr-3 py-2.5 font-sans text-sm text-foreground placeholder:font-mono placeholder:text-muted-foreground/50 placeholder:text-[12px] focus:outline-none focus:border-primary/50 transition-colors"
            />
          </div>
          <div className="flex gap-1 shrink-0">
            <button
              onClick={() => setSort("films")}
              data-testid="tag-sort-films"
              className={`inline-flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.14em] px-3 py-2 rounded-sm border transition-colors ${
                sort === "films"
                  ? "border-primary/50 text-primary bg-primary/5"
                  : "border-border/70 text-muted-foreground hover:text-foreground"
              }`}
            >
              <Film className="h-3 w-3" /> Most films
            </button>
            <button
              onClick={() => setSort("az")}
              data-testid="tag-sort-az"
              className={`inline-flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.14em] px-3 py-2 rounded-sm border transition-colors ${
                sort === "az"
                  ? "border-primary/50 text-primary bg-primary/5"
                  : "border-border/70 text-muted-foreground hover:text-foreground"
              }`}
            >
              <ArrowDownAZ className="h-3 w-3" /> A→Z
            </button>
          </div>
        </div>

        {/* Selection summary */}
        {selected.length > 0 && (
          <div className="flex items-center gap-3 rounded-sm border border-primary/30 bg-primary/[0.07] px-3.5 py-2">
            <span className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-primary">
              {selected.length === 1
                ? `Tag: ${selected[0]}`
                : `${selected.length} tags selected`}
            </span>
            <button
              onClick={() => setSelected([])}
              data-testid="tag-clear"
              className="ml-auto inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground hover:text-primary transition-colors"
            >
              <X className="h-3 w-3" /> Clear
            </button>
          </div>
        )}
      </div>

      {/* Tag cloud */}
      {displayed.length === 0 ? (
        <p className="font-mono text-sm text-muted-foreground py-12 text-center">
          No tags match “{search}”.
        </p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
          {displayed.map(([name, entry]) => (
            <TagCard
              key={name}
              name={name}
              entry={entry}
              selected={selected.includes(name)}
              onToggle={() => toggleTag(name)}
              onSelectRelated={selectRelated}
            />
          ))}
        </div>
      )}

      {/* Detail panel */}
      <AnimatePresence>
        {detail && (
          <motion.section
            key={detail.tags.join("|")}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
            className="mt-10 overflow-hidden"
            data-testid="tag-detail-panel"
          >
            <div className="border-t border-border pt-8">
              {detail.single && detail.entry ? (
                <>
                  <h2 className="font-serif text-3xl sm:text-4xl tracking-tight text-foreground capitalize">
                    {detail.tags[0]}
                  </h2>
                  <p className="font-mono text-sm text-muted-foreground mt-2">
                    <span className="text-primary">{detail.entry.unique_films}</span> films
                    {" · "}
                    {detail.entry.count} diary entries
                  </p>
                  {detail.entry.related_tags?.length > 0 && (
                    <div className="mt-4 flex flex-wrap gap-2">
                      <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground/60 self-center">
                        Related
                      </span>
                      {detail.entry.related_tags.map((r) => (
                        <button
                          key={r}
                          onClick={() => selectRelated(r)}
                          data-testid={`tag-detail-related-${r}`}
                          disabled={!tagsObj[r]}
                          className="font-mono text-[10px] uppercase tracking-[0.12em] border border-border/70 rounded-full px-2.5 py-1 text-foreground/75 hover:border-primary/50 hover:text-primary disabled:opacity-40 disabled:hover:text-foreground/75 transition-colors capitalize"
                        >
                          {r}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <>
                  <h2 className="font-serif text-3xl sm:text-4xl tracking-tight text-foreground">
                    Films matching all {detail.tags.length} tags
                  </h2>
                  <p className="font-mono text-sm text-muted-foreground mt-2 capitalize">
                    {detail.tags.join(" + ")}
                    {" · "}
                    <span className="text-primary">{detail.films.length}</span> films
                  </p>
                </>
              )}

              {detail.films.length === 0 ? (
                <p className="font-mono text-sm text-muted-foreground mt-8">
                  No films share all selected tags. Try removing one.
                </p>
              ) : (
                <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
                  {detail.films.slice(0, 60).map((f) => (
                    <LetterboxdCard key={filmKey(f)} film={f} />
                  ))}
                </div>
              )}
              {detail.films.length > 60 && (
                <p className="font-mono text-[11px] text-muted-foreground/60 mt-4">
                  Showing first 60 of {detail.films.length}.
                </p>
              )}
            </div>
          </motion.section>
        )}
      </AnimatePresence>
    </PageShell>
  );
}
