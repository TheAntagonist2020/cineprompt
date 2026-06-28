import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useAppData } from "@/lib/data";
import { Poster } from "@/components/film-ui";
import { LoadingScreen, PageShell } from "@/components/layout";
import { Search } from "lucide-react";

type SortKey = "alpha" | "seen" | "completion" | "deepdive";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "alpha", label: "A–Z" },
  { key: "seen", label: "Most seen" },
  { key: "completion", label: "Completion %" },
  { key: "deepdive", label: "Deep-dive ready" },
];

export default function Directors() {
  const { data, loading } = useAppData();
  const [sort, setSort] = useState<SortKey>("seen");
  const [q, setQ] = useState("");

  const lovedMap = useMemo(() => {
    const m: Record<string, number> = {};
    if (data) for (const d of data.blindspots.loved_directors) m[d.name] = d.avg_rating;
    return m;
  }, [data]);

  const list = useMemo(() => {
    if (!data) return [];
    let arr = Object.entries(data.directors).map(([name, d]) => {
      // representative poster: first seen film with a poster, else any film with poster
      const seenWithPoster = d.films.find((f) => f.seen && f.poster);
      const anyPoster = d.films.find((f) => f.poster);
      const completion = d.total > 0 ? d.seen / d.total : 0;
      return {
        name,
        total: d.total,
        seen: d.seen,
        completion,
        poster: (seenWithPoster || anyPoster)?.poster ?? null,
        avg: lovedMap[name],
        // deep-dive score: high completion + loved
        deepdive: completion * (lovedMap[name] ? lovedMap[name] / 5 + 0.5 : 0.4),
      };
    });
    if (q.trim()) {
      const needle = q.toLowerCase();
      arr = arr.filter((d) => d.name.toLowerCase().includes(needle));
    }
    arr.sort((a, b) => {
      switch (sort) {
        case "alpha":
          return a.name.localeCompare(b.name);
        case "seen":
          return b.seen - a.seen;
        case "completion":
          return b.completion - a.completion || b.seen - a.seen;
        case "deepdive":
          return b.deepdive - a.deepdive;
      }
    });
    return arr;
  }, [data, sort, q, lovedMap]);

  if (loading || !data) return <LoadingScreen />;

  return (
    <PageShell
      eyebrow={`${Object.keys(data.directors).length} filmographies`}
      title="Director Library"
      intro="Every director you've engaged with, with how deep you've gone. Hunt for the ones worth completing."
    >
      {/* Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 mb-8">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search directors…"
            data-testid="input-director-search"
            className="w-full bg-card/60 border border-border rounded-sm pl-9 pr-3 py-2 font-sans text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/50"
          />
        </div>
        <div className="flex flex-wrap gap-1.5 sm:ml-auto">
          {SORTS.map((s) => (
            <button
              key={s.key}
              onClick={() => setSort(s.key)}
              data-testid={`sort-${s.key}`}
              className={`font-mono text-[11px] px-2.5 py-1.5 rounded-sm transition-colors ${
                sort === s.key
                  ? "bg-primary/15 text-primary border border-primary/40"
                  : "text-muted-foreground hover:text-foreground border border-transparent"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-5">
        {list.map((d) => {
          const pct = Math.round(d.completion * 100);
          return (
            <Link key={d.name} href={`/directors/${encodeURIComponent(d.name)}`} data-testid={`director-${d.name}`}>
              <div className="group cursor-pointer">
                <div className="relative aspect-[2/3] overflow-hidden rounded-sm border border-border film-shadow">
                  <Poster
                    path={d.poster}
                    alt={d.name}
                    className="h-full w-full group-hover:scale-[1.04] transition-transform duration-500"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-transparent" />
                  {d.avg && (
                    <span className="absolute top-2 right-2 font-mono text-[10px] text-primary bg-background/70 backdrop-blur px-1.5 py-0.5 rounded-sm">
                      {d.avg.toFixed(1)}★
                    </span>
                  )}
                  <div className="absolute inset-x-0 bottom-0 p-3">
                    <h3 className="font-serif text-base sm:text-lg leading-tight text-white group-hover:text-primary transition-colors line-clamp-2">
                      {d.name}
                    </h3>
                  </div>
                </div>
                <div className="mt-2.5">
                  <div className="flex items-center justify-between font-mono text-[11px] text-muted-foreground mb-1.5">
                    <span>
                      {d.seen} / {d.total}
                    </span>
                    <span className="text-primary/80">{pct}%</span>
                  </div>
                  <div className="h-[3px] bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
      {list.length === 0 && (
        <p className="py-16 text-center font-serif italic text-muted-foreground">
          No directors match “{q}”.
        </p>
      )}
    </PageShell>
  );
}
