import { Link } from "wouter";
import { useAppData, languageName, type LovedDirector } from "@/lib/data";
import { LoadingScreen, PageShell } from "@/components/layout";
import { ArrowRight, Star } from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Cell,
  Tooltip,
  CartesianGrid,
} from "recharts";

const ACCENT = "hsl(38 55% 60%)";
const MUTED_BAR = "hsl(40 12% 38%)";
const GRID = "hsl(240 5% 16%)";

function chartTooltip(suffix = "") {
  return {
    cursor: { fill: "hsl(240 5% 14% / 0.5)" },
    contentStyle: {
      background: "hsl(240 6% 9%)",
      border: "1px solid hsl(240 5% 16%)",
      borderRadius: 4,
      fontSize: 12,
      fontFamily: "JetBrains Mono, monospace",
    },
    labelStyle: { color: "hsl(40 8% 58%)" },
    formatter: (v: number) => [`${v}${suffix}`, ""] as [string, string],
  };
}

function Panel({
  eyebrow,
  caption,
  children,
}: {
  eyebrow: string;
  caption?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border border-border rounded-md bg-card/40 p-6 sm:p-8">
      <div className="flex items-baseline justify-between gap-4 mb-1">
        <h2 className="font-serif text-2xl text-foreground">{eyebrow}</h2>
      </div>
      {caption && <p className="text-sm text-muted-foreground mb-6 max-w-lg">{caption}</p>}
      {!caption && <div className="mb-6" />}
      {children}
    </section>
  );
}

export default function BlindSpots() {
  const { data, loading } = useAppData();
  if (loading || !data) return <LoadingScreen />;
  const bs = data.blindspots;

  // Decade coverage
  const under = new Set(bs.under_watched_decades.map(String));
  const decadeData = Object.entries(bs.by_decade)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([dec, count]) => ({
      decade: `${dec}s`,
      raw: dec,
      count,
      gap: under.has(dec),
    }));

  // Derive language & genre mix from the queue (real TMDB metadata) as a tendency proxy
  const langCounts: Record<string, number> = {};
  const genreCounts: Record<string, number> = {};
  for (const f of data.queue) {
    langCounts[f.original_language] = (langCounts[f.original_language] || 0) + 1;
    for (const g of f.genres) genreCounts[g] = (genreCounts[g] || 0) + 1;
  }
  const langData = Object.entries(langCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([code, count]) => ({ label: languageName(code), count }));
  const genreData = Object.entries(genreCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([g, count]) => ({ label: g, count }));

  // Ratings distribution (1-10)
  const ratingData = Array.from({ length: 10 }, (_, i) => {
    const k = String(i + 1);
    return { rating: k, count: bs.ratings_distribution[k] || 0 };
  });

  const loved: LovedDirector[] = bs.loved_directors;

  return (
    <PageShell
      eyebrow="Where your map goes dark"
      title="Blind Spots"
      intro="A portrait of what you watch — and the territory you've barely entered. Use it to steer the next hundred films."
    >
      <div className="grid gap-6">
        {/* DECADE COVERAGE */}
        <Panel
          eyebrow="Decade Coverage"
          caption="Films logged per decade across your 4,539 watches. Highlighted bars are your gap zones — decades you've under-watched relative to the rest."
        >
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={decadeData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={GRID} strokeDasharray="2 4" />
              <XAxis
                dataKey="decade"
                tick={{ fill: "hsl(40 8% 58%)", fontSize: 11, fontFamily: "JetBrains Mono" }}
                axisLine={{ stroke: GRID }}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: "hsl(40 8% 50%)", fontSize: 11, fontFamily: "JetBrains Mono" }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip {...chartTooltip(" films")} />
              <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                {decadeData.map((d, i) => (
                  <Cell key={i} fill={d.gap ? ACCENT : MUTED_BAR} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div className="flex flex-wrap gap-2 mt-5">
            {decadeData
              .filter((d) => d.gap)
              .map((d) => (
                <span
                  key={d.raw}
                  className="font-mono text-[11px] text-primary border border-primary/40 bg-primary/10 rounded-sm px-2.5 py-1"
                >
                  {d.decade} · {d.count} films
                </span>
              ))}
            <span className="font-mono text-[11px] text-muted-foreground self-center ml-1">
              ← your gap zones
            </span>
          </div>
        </Panel>

        <div className="grid lg:grid-cols-2 gap-6">
          {/* LANGUAGE MIX */}
          <Panel
            eyebrow="Language Lean"
            caption="The languages your current queue is steering you toward — a read on where new ground lies."
          >
            <HBarChart data={langData} />
          </Panel>

          {/* GENRE PROFILE */}
          <Panel
            eyebrow="Genre Profile"
            caption="Genre distribution across the films queued for you right now."
          >
            <HBarChart data={genreData} />
          </Panel>
        </div>

        {/* LOVED DIRECTORS */}
        <Panel
          eyebrow="Loved Directors"
          caption="Directors you've rated 3.8★ and above on average. Each is a candidate for a deep-dive — fill in the films you've missed."
        >
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-1">
            {loved.map((d) => {
              const known = !!data.directors[d.name];
              const inner = (
                <div className="flex items-center gap-3 py-2.5 border-b border-border/60 group">
                  <span className="font-mono text-xs text-primary tabular-nums w-12 shrink-0 flex items-center gap-1">
                    <Star className="h-3 w-3 fill-primary text-primary" />
                    {d.avg_rating.toFixed(1)}
                  </span>
                  <span className="font-serif text-[17px] text-foreground group-hover:text-primary transition-colors truncate">
                    {d.name}
                  </span>
                  <span className="font-mono text-[11px] text-muted-foreground ml-auto shrink-0">
                    {d.seen} seen
                  </span>
                  {known && (
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition-all shrink-0" />
                  )}
                </div>
              );
              return known ? (
                <Link key={d.name} href={`/directors/${encodeURIComponent(d.name)}`} data-testid={`loved-${d.name}`}>
                  <div className="cursor-pointer">{inner}</div>
                </Link>
              ) : (
                <div key={d.name}>{inner}</div>
              );
            })}
          </div>
        </Panel>

        {/* RATINGS DISTRIBUTION */}
        <Panel
          eyebrow="Ratings Distribution"
          caption="How you score the films you log, on a 1–10 scale (1–5 stars × 2). You lean generous — most films land between 6 and 8."
        >
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={ratingData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={GRID} strokeDasharray="2 4" />
              <XAxis
                dataKey="rating"
                tick={{ fill: "hsl(40 8% 58%)", fontSize: 11, fontFamily: "JetBrains Mono" }}
                axisLine={{ stroke: GRID }}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: "hsl(40 8% 50%)", fontSize: 11, fontFamily: "JetBrains Mono" }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip {...chartTooltip(" films")} />
              <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                {ratingData.map((d, i) => (
                  <Cell key={i} fill={Number(d.rating) >= 8 ? ACCENT : MUTED_BAR} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Panel>
      </div>
    </PageShell>
  );
}

function HBarChart({ data }: { data: { label: string; count: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={Math.max(220, data.length * 26)}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }}>
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="label"
          width={92}
          tick={{ fill: "hsl(40 14% 78%)", fontSize: 12, fontFamily: "JetBrains Mono" }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip {...chartTooltip(" films")} />
        <Bar dataKey="count" radius={[0, 2, 2, 0]} fill={ACCENT} barSize={12} />
      </BarChart>
    </ResponsiveContainer>
  );
}
