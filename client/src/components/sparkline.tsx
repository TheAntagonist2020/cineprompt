import {
  ResponsiveContainer,
  AreaChart,
  Area,
  Tooltip,
  XAxis,
} from "recharts";

// Lazy-loaded so Recharts stays out of the main bundle; Today renders a
// fixed-height placeholder until this chunk arrives.
export default function Sparkline({
  months,
}: {
  months: { label: string; count: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={64}>
      <AreaChart data={months} margin={{ top: 4, right: 2, left: 2, bottom: 0 }}>
        <defs>
          <linearGradient id="spark" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(38 55% 60%)" stopOpacity={0.4} />
            <stop offset="100%" stopColor="hsl(38 55% 60%)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <Tooltip
          cursor={{ stroke: "hsl(38 55% 60%)", strokeWidth: 1, strokeOpacity: 0.4 }}
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
        <XAxis dataKey="label" hide />
        <Area
          type="monotone"
          dataKey="count"
          stroke="hsl(38 55% 60%)"
          strokeWidth={1.5}
          fill="url(#spark)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
