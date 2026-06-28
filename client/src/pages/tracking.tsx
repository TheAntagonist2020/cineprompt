import { useAppData, getPosterIndex, formatNumber } from "@/lib/data";
import { Poster } from "@/components/film-ui";
import { LoadingScreen, PageShell } from "@/components/layout";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Dot,
} from "recharts";

const ACCENT = "hsl(38 55% 60%)";
const GRID = "hsl(240 5% 16%)";

// Compute consecutive-day streak ending at the most recent watch date.
function computeStreak(dates: string[]): number {
  const set = new Set(dates);
  if (set.size === 0) return 0;
  const sorted = Array.from(set).sort().reverse(); // desc
  let streak = 1;
  let cursor = new Date(sorted[0] + "T00:00:00");
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(cursor);
    prev.setDate(prev.getDate() - 1);
    const expected = prev.toISOString().slice(0, 10);
    if (sorted[i] === expected) {
      streak++;
      cursor = prev;
    } else if (sorted[i] === cursor.toISOString().slice(0, 10)) {
      // same day, skip
    } else {
      break;
    }
  }
  return streak;
}

export default function Tracking() {
  const { data, loading } = useAppData();
  if (loading || !data) return <LoadingScreen />;

  const totalWatched = data.stats.total_watched;
  const totalMin = data.stats.total_minutes;
  const hours = Math.round(totalMin / 60);
  const days = Math.round(totalMin / 60 / 24);

  // Pace: last 24 months
  const months = Object.entries(data.by_month)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-24)
    .map(([m, c]) => ({ month: m, count: c }));
  const currentMonth = months.length ? months[months.length - 1].month : "";

  // Streak from recent_watches dates
  const dates = data.recent_watches.map((w) => w.last_watched);
  const streak = computeStreak(dates);

  // Best month
  const best = Object.entries(data.by_month).reduce(
    (acc, [m, c]) => (c > acc.count ? { month: m, count: c } : acc),
    { month: "", count: 0 }
  );

  const posterIdx = getPosterIndex(data);

  return (
    <PageShell
      eyebrow="The ledger"
      title="Tracking"
      intro="The shape of a viewing life — totals, pace, streaks, and the last fifty films through the projector."
    >
      {/* Diary stat strip */}
      {data.diary_meta && (
        <p
          className="font-mono text-[11px] text-muted-foreground/70 tracking-wide mb-6 -mt-2"
          data-testid="diary-stat-strip"
        >
          DIARY · {formatNumber(data.diary_meta.total_entries)} entries ·{" "}
          {formatNumber(data.diary_meta.unique_titles)} unique films ·{" "}
          {formatNumber(data.diary_meta.criterion_channel_count)} Criterion Channel
        </p>
      )}

      {/* Big totals */}
      <div className="grid sm:grid-cols-3 gap-5 mb-12">
        <div className="border border-border rounded-md bg-card/40 p-7 sm:col-span-1">
          <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-muted-foreground mb-3">
            Films watched
          </p>
          <p className="font-serif text-6xl sm:text-7xl text-primary leading-none tabular-nums">
            {formatNumber(totalWatched)}
          </p>
        </div>
        <div className="border border-border rounded-md bg-card/40 p-7 flex flex-col justify-center">
          <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-muted-foreground mb-2">
            Time on screen
          </p>
          <p className="font-serif text-3xl text-foreground leading-tight">
            {formatNumber(hours)} hours
          </p>
          <p className="font-mono text-sm text-muted-foreground mt-1">
            {formatNumber(days)} days of cinema
          </p>
          <p className="font-mono text-[11px] text-muted-foreground/60 mt-1">
            {formatNumber(totalMin)} minutes logged
          </p>
        </div>
        <div className="border border-border rounded-md bg-card/40 p-7 flex flex-col justify-center">
          <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-muted-foreground mb-2">
            Streaks
          </p>
          <p className="font-serif text-3xl text-foreground leading-tight">
            <span className="text-primary">{streak}</span> day{streak === 1 ? "" : "s"}
          </p>
          <p className="font-mono text-sm text-muted-foreground mt-1">current streak</p>
          <p className="font-mono text-[11px] text-muted-foreground/70 mt-3">
            Best month — {best.month} ({best.count} films)
          </p>
        </div>
      </div>

      {/* Pace chart */}
      <section className="border border-border rounded-md bg-card/40 p-6 sm:p-8 mb-12">
        <div className="flex items-baseline justify-between mb-6">
          <h2 className="font-serif text-2xl text-foreground">Pace</h2>
          <span className="font-mono text-[11px] text-muted-foreground">last 24 months</span>
        </div>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={months} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke={GRID} strokeDasharray="2 4" />
            <XAxis
              dataKey="month"
              tick={{ fill: "hsl(40 8% 52%)", fontSize: 10, fontFamily: "JetBrains Mono" }}
              axisLine={{ stroke: GRID }}
              tickLine={false}
              interval={2}
            />
            <YAxis
              tick={{ fill: "hsl(40 8% 50%)", fontSize: 11, fontFamily: "JetBrains Mono" }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              cursor={{ stroke: ACCENT, strokeOpacity: 0.3 }}
              contentStyle={{
                background: "hsl(240 6% 9%)",
                border: "1px solid hsl(240 5% 16%)",
                borderRadius: 4,
                fontSize: 12,
                fontFamily: "JetBrains Mono, monospace",
              }}
              labelStyle={{ color: "hsl(40 8% 58%)" }}
              formatter={(v: number) => [`${v} films`, ""]}
            />
            <Line
              type="monotone"
              dataKey="count"
              stroke={ACCENT}
              strokeWidth={1.75}
              dot={(props: any) => {
                const isCurrent = props.payload.month === currentMonth;
                return (
                  <Dot
                    key={props.payload.month}
                    cx={props.cx}
                    cy={props.cy}
                    r={isCurrent ? 5 : 2.5}
                    fill={isCurrent ? ACCENT : "hsl(240 6% 9%)"}
                    stroke={ACCENT}
                    strokeWidth={1.5}
                  />
                );
              }}
              activeDot={{ r: 5, fill: ACCENT }}
            />
          </LineChart>
        </ResponsiveContainer>
      </section>

      {/* Timeline */}
      <section>
        <div className="flex items-center gap-4 mb-6">
          <h2 className="font-mono text-[12px] uppercase tracking-[0.28em] text-muted-foreground">
            Recent 50 Watches
          </h2>
          <span className="h-px flex-1 bg-border" />
        </div>
        <ol className="divide-y divide-border border-t border-border">
          {data.recent_watches.map((w, i) => {
            const poster = posterIdx.get(w.tmdb) ?? null;
            return (
              <li key={`${w.tmdb}-${i}`} className="py-3.5 flex items-center gap-4" data-testid={`watch-${w.tmdb}`}>
                <span className="font-mono text-[11px] text-muted-foreground w-[88px] shrink-0 tabular-nums">
                  {w.last_watched}
                </span>
                <Poster path={poster} alt={w.title} className="w-9 aspect-[2/3] rounded-sm shrink-0" />
                <a
                  href={`https://letterboxd.com/tmdb/${w.tmdb}/`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-serif text-lg text-foreground hover:text-primary transition-colors min-w-0 truncate"
                >
                  {w.title}
                </a>
                <span className="font-mono text-[11px] text-muted-foreground ml-2 shrink-0">
                  {w.year}
                </span>
                {w.plays > 1 && (
                  <span className="font-mono text-[10px] text-primary/80 border border-primary/30 rounded-sm px-1.5 py-0.5 ml-auto shrink-0">
                    {w.plays}× plays
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </section>
    </PageShell>
  );
}
