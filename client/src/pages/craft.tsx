import { useMemo, useState } from "react";
import { Check } from "lucide-react";
import {
  useAppData,
  tmdbUrl,
  letterboxdTmdbUrl,
  type CraftEntry,
  type CraftFilm,
} from "@/lib/data";
import { Poster } from "@/components/film-ui";
import { LoadingScreen, PageShell } from "@/components/layout";

type Tab = "cinematographers" | "composers";

export default function Craft() {
  const { data, loading } = useAppData();
  const [tab, setTab] = useState<Tab>("cinematographers");
  const [open, setOpen] = useState<string | null>(null);
  if (loading || !data) return <LoadingScreen />;

  const dims = data.craft_dimensions;

  const entries = useMemo(() => {
    if (!dims) return [];
    const record = dims[tab] ?? {};
    return Object.entries(record)
      .sort((a, b) => b[1].seen_count - a[1].seen_count)
      .slice(0, 30);
  }, [dims, tab]);

  return (
    <PageShell
      eyebrow="Craft coverage"
      title="The Craft"
      intro="The cinematographers and composers whose work runs through your viewing. Track how deep you've gone with each, and who they tend to collaborate with."
    >
      {/* Tab toggle */}
      <div className="inline-flex items-center gap-1 rounded-sm border border-border bg-card/40 p-1 mb-9">
        {(["cinematographers", "composers"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => {
              setTab(t);
              setOpen(null);
            }}
            data-testid={`craft-tab-${t}`}
            className={`font-mono text-[11px] uppercase tracking-[0.14em] px-4 py-2 rounded-sm transition-colors ${
              tab === t
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t === "cinematographers" ? "Cinematographers" : "Composers"}
          </button>
        ))}
      </div>

      <div className="space-y-3" key={tab}>
        {entries.map(([name, entry]) => (
          <CraftRow
            key={name}
            name={name}
            entry={entry}
            expanded={open === name}
            onToggle={() => setOpen(open === name ? null : name)}
          />
        ))}
      </div>
    </PageShell>
  );
}

function CraftRow({
  name,
  entry,
  expanded,
  onToggle,
}: {
  name: string;
  entry: CraftEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  const pct = entry.pct_seen != null ? entry.pct_seen : entry.total ? (entry.seen_count / entry.total) * 100 : 0;
  const collaborators = (entry.top_directors ?? []).slice(0, 3);
  return (
    <div
      className={`rounded-md border bg-card/30 transition-colors ${
        expanded ? "border-primary/50" : "border-border"
      }`}
      data-testid={`craft-row-${name.replace(/\s/g, "-")}`}
    >
      <button onClick={onToggle} className="w-full text-left p-5" aria-expanded={expanded}>
        <div className="flex items-baseline justify-between gap-4 flex-wrap">
          <h2 className="font-serif text-2xl sm:text-3xl tracking-tight text-foreground">
            {name}
          </h2>
          <span className="font-mono text-sm text-primary tabular-nums shrink-0">
            {entry.seen_count}/{entry.total}
          </span>
        </div>
        <div className="mt-3 h-1.5 bg-muted rounded-full overflow-hidden max-w-md">
          <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
        </div>
        {collaborators.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground/60">
              Often with
            </span>
            {collaborators.map(([dir, n]) => (
              <span
                key={dir}
                className="font-mono text-[10px] text-foreground/70 border border-border/70 rounded-full px-2.5 py-0.5"
              >
                {dir} <span className="text-muted-foreground/50">×{n}</span>
              </span>
            ))}
          </div>
        )}
        <p className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-primary/70 mt-3">
          {expanded ? "Hide films ↑" : "Show films ↓"}
        </p>
      </button>

      {expanded && (
        <div className="px-5 pb-6 animate-in fade-in duration-300">
          {entry.seen.length > 0 && (
            <FilmBlock label="Seen" films={entry.seen} seen />
          )}
          {entry.unseen.length > 0 && (
            <FilmBlock label="Not yet seen" films={entry.unseen} seen={false} />
          )}
        </div>
      )}
    </div>
  );
}

function FilmBlock({
  label,
  films,
  seen,
}: {
  label: string;
  films: CraftFilm[];
  seen: boolean;
}) {
  return (
    <div className="mt-4 first:mt-0">
      <div className="flex items-center gap-3 mb-3">
        <span
          className={`font-mono text-[10px] uppercase tracking-[0.2em] ${
            seen ? "text-primary" : "text-muted-foreground"
          }`}
        >
          {label} · {films.length}
        </span>
        <span className="h-px flex-1 bg-border" />
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-6 gap-3">
        {films.map((f) => {
          const href = seen ? letterboxdTmdbUrl(f.tmdb_id) : tmdbUrl(f.tmdb_id, f.title);
          return (
            <a
              key={f.tmdb_id}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              data-testid={`craft-film-${f.tmdb_id}`}
              className="group"
            >
              <div className="relative">
                <Poster
                  path={f.poster}
                  alt={f.title}
                  className={`w-full aspect-[2/3] rounded-sm border transition-all ${
                    seen
                      ? "border-primary/30 group-hover:border-primary/60"
                      : "border-border/60 opacity-80 group-hover:opacity-100 group-hover:border-primary/40"
                  }`}
                />
                {seen && (
                  <span className="absolute top-1.5 right-1.5 h-4 w-4 rounded-full bg-primary/90 flex items-center justify-center ring-2 ring-background">
                    <Check className="h-2.5 w-2.5 text-primary-foreground" />
                  </span>
                )}
              </div>
              <p className="font-serif text-[12px] leading-tight mt-1.5 line-clamp-2 text-foreground/80 group-hover:text-primary transition-colors">
                {f.title}
              </p>
              <p className="font-mono text-[9px] text-muted-foreground/60">{f.year}</p>
            </a>
          );
        })}
      </div>
    </div>
  );
}
