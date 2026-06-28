import { Check, FileText } from "lucide-react";
import { useAppData, type ScreenplayEntry } from "@/lib/data";
import { Poster } from "@/components/film-ui";
import { LoadingScreen, PageShell } from "@/components/layout";

export default function Screenplays() {
  const { data, loading } = useAppData();
  if (loading || !data) return <LoadingScreen />;

  const sp = data.screenplays;
  if (!sp) {
    return (
      <PageShell title="Screenplay Study">
        <p className="font-serif italic text-muted-foreground">No screenplay data available.</p>
      </PageShell>
    );
  }

  const wga = sp.entries.filter((e) => e.source === "wga_101");
  const modern = sp.entries.filter((e) => e.source === "modern_essential");
  const pct = sp.pct != null ? sp.pct : sp.total ? (sp.seen / sp.total) * 100 : 0;

  return (
    <PageShell
      eyebrow={`${sp.seen} of ${sp.total} seen · ${pct.toFixed(0)}% watched`}
      title="Screenplay Study"
      intro="The scripts worth reading alongside the films. Watch, then read the page to see how it was built."
    >
      <div className="mb-10 max-w-md">
        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
          <div className="h-full bg-primary" style={{ width: `${pct}%` }} data-testid="screenplay-progress" />
        </div>
      </div>

      <Section title="WGA 101 Greatest Screenplays" entries={wga} />
      <Section title="Modern Essentials" entries={modern} />
    </PageShell>
  );
}

function Section({ title, entries }: { title: string; entries: ScreenplayEntry[] }) {
  if (entries.length === 0) return null;
  const seen = entries.filter((e) => e.seen).length;
  return (
    <section className="mb-14" data-testid={`screenplay-section-${title.replace(/\s/g, "-").toLowerCase()}`}>
      <div className="flex items-baseline gap-4 mb-6">
        <h2 className="font-serif text-2xl sm:text-3xl tracking-tight text-foreground">{title}</h2>
        <span className="font-mono text-xs text-muted-foreground shrink-0">
          {seen}/{entries.length} seen
        </span>
        <span className="h-px flex-1 bg-border self-center" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {entries.map((e) => (
          <ScriptCard key={`${e.tmdb_id}-${e.title}`} entry={e} />
        ))}
      </div>
    </section>
  );
}

function ScriptCard({ entry }: { entry: ScreenplayEntry }) {
  return (
    <article
      className="flex gap-4 rounded-md border border-border/60 bg-card/30 p-4"
      data-testid={`script-card-${entry.tmdb_id}`}
    >
      <Poster
        path={entry.poster}
        alt={entry.title}
        className="w-16 shrink-0 aspect-[2/3] rounded-sm border border-border/60"
      />
      <div className="min-w-0 flex-1 flex flex-col">
        <div className="flex items-start gap-2">
          <h3 className="font-serif text-lg leading-tight text-foreground min-w-0">
            {entry.title}
          </h3>
          {entry.seen && (
            <span className="ml-auto shrink-0 inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.14em] text-primary border border-primary/40 bg-primary/10 rounded-sm px-1.5 py-0.5">
              <Check className="h-2.5 w-2.5" /> Seen
            </span>
          )}
        </div>
        <p className="font-mono text-[10px] text-muted-foreground/70 mt-1">
          {entry.year}
          {entry.directors?.length ? ` · ${entry.directors.join(", ")}` : ""}
        </p>
        <a
          href={entry.script_url}
          target="_blank"
          rel="noopener noreferrer"
          data-testid={`link-script-${entry.tmdb_id}`}
          className="mt-auto pt-3 inline-flex items-center gap-1.5 self-start font-mono text-[10.5px] uppercase tracking-[0.14em] text-foreground/85 border border-border rounded-sm px-2.5 py-1.5 hover:border-primary/50 hover:text-primary transition-colors"
        >
          <FileText className="h-3 w-3" /> Read script
        </a>
      </div>
    </article>
  );
}
