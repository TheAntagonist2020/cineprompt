import { useMemo, useState } from "react";
import { Link } from "wouter";
import { AnimatePresence, motion } from "framer-motion";
import {
  Activity,
  Aperture,
  ArrowUpRight,
  CalendarDays,
  Clapperboard,
  Compass,
  Eye,
  Gauge,
  ListVideo,
  Radar,
  RefreshCw,
  Sparkles,
  Tv,
  Users,
} from "lucide-react";
import {
  useAppData,
  getPosterIndex,
  formatMonthDay,
  formatNumber,
  formatRuntime,
  todayISO,
  type AppData,
  type BackgroundFilm,
  type QueueFilm,
} from "@/lib/data";
import {
  Poster,
  FocusCard,
  BackgroundCard,
  FilmDetailModal,
  KenBurnsBackdrop,
  useFilmModal,
} from "@/components/film-ui";
import { LoadingScreen } from "@/components/layout";
import { MoodStrip } from "@/components/mood-strip";
import { useFilmState } from "@/lib/filmState";
import {
  useMood,
  moodMetaByIds,
  moodPicks,
  moodFocus,
  moodBackground,
  withKind,
} from "@/lib/mood";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  Tooltip,
  XAxis,
} from "recharts";

const EASE = [0.4, 0.0, 0.2, 1] as const;

const sectionVariants = {
  hidden: { opacity: 0, y: 26 },
  show: { opacity: 1, y: 0, transition: { duration: 0.65, ease: EASE } },
};

const staggerVariants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.08, delayChildren: 0.06 } },
};

function Sparkline({ months }: { months: { label: string; count: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={76}>
      <AreaChart data={months} margin={{ top: 4, right: 2, left: 2, bottom: 0 }}>
        <defs>
          <linearGradient id="spark" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(38 55% 60%)" stopOpacity={0.45} />
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
          strokeWidth={1.7}
          fill="url(#spark)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// Tiny seeded shuffle — deterministic per seed.
function pick<T>(arr: T[], seed: number, n: number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j =
      (Math.floor(Math.sin(seed * 9301 + i * 49297) * 233280) >>> 0) % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

const QUICK_NAV: {
  href: string;
  label: string;
  blurb: string;
  icon: typeof Clapperboard;
  metric: (data: AppData) => string;
}[] = [
  {
    href: "/week",
    label: "Week Ahead",
    blurb: "The next run of programmed slates.",
    icon: CalendarDays,
    metric: (data) => `${data.slates?.length ?? 0} days`,
  },
  {
    href: "/queue",
    label: "Queue",
    blurb: "The engine’s strongest unseen candidates.",
    icon: ListVideo,
    metric: (data) => `${formatNumber(data.queue.length)} picks`,
  },
  {
    href: "/blindspots",
    label: "Blind Spots",
    blurb: "Where the viewing map still has shadows.",
    icon: Compass,
    metric: (data) => `${data.blindspots.under_watched_decades?.length ?? 0} decades`,
  },
  {
    href: "/directors",
    label: "Directors",
    blurb: "Completion targets and auteur streaks.",
    icon: Users,
    metric: (data) => `${formatNumber(Object.keys(data.directors).length)} names`,
  },
  {
    href: "/background",
    label: "Background",
    blurb: "Comfort rewatches and ambient texture.",
    icon: Tv,
    metric: (data) => `${formatNumber(data.background_pool.length)} films`,
  },
  {
    href: "/tracking",
    label: "Tracking",
    blurb: "The cockpit view of momentum.",
    icon: Activity,
    metric: (data) => `${formatNumber(data.stats.total_watched)} logged`,
  },
];

function canonProgress(data: AppData): { seen: number; total: number; pct: number } {
  const unique = new Map<string, boolean>();
  for (const list of Object.values(data.canon ?? {})) {
    for (const film of list) {
      unique.set(`${film.title}-${film.year}`, film.seen);
    }
  }
  const total = unique.size;
  const seen = [...unique.values()].filter(Boolean).length;
  return { seen, total, pct: total ? Math.round((seen / total) * 100) : 0 };
}

function slateIntensity(films: QueueFilm[]): number {
  if (!films.length) return 0;
  const avg = films.reduce((sum, film) => sum + (film.score || film.vote_average * 10 || 0), 0) / films.length;
  return Math.max(0, Math.min(100, Math.round(avg)));
}

export default function Today() {
  const { data, loading } = useAppData();
  const modal = useFilmModal();
  const fs = useFilmState();
  const { activeMoods } = useMood();
  const [shuffleSeed, setShuffleSeed] = useState<number>(0);
  const [spinning, setSpinning] = useState(false);
  const [toastVisible, setToastVisible] = useState(false);
  if (loading || !data) return <LoadingScreen />;

  // Pick today's slate: match by date, else slates[0].
  const iso = todayISO();
  const slate =
    data.slates?.find((s) => s.date === iso) ?? data.slates?.[0] ?? null;

  const monthsSorted = Object.entries(data.by_month).sort(([a], [b]) =>
    a.localeCompare(b)
  );
  const last12 = monthsSorted.slice(-12).map(([m, c]) => ({ label: m, count: c }));
  const recent = data.recent_watches.slice(0, 12);
  const posterIdx = getPosterIndex(data);

  const moods = moodMetaByIds(data, activeMoods);
  const moodActive = moods.length > 0;
  const moodLabel = moods.map((m) => m.label).join(" + ");

  // Build the slate: mood-driven when moods are active, else the daily slate.
  let focus: QueueFilm[] = slate ? slate.focus : data.todays_pick ? [data.todays_pick] : [];
  let background: BackgroundFilm[] = slate ? slate.background : [];
  if (moodActive) {
    const picks = moodPicks(data, activeMoods);
    focus = moodFocus(picks, 3) as QueueFilm[];
    background = moodBackground(picks, focus, 2).map(withKind) as BackgroundFilm[];
  } else if (shuffleSeed > 0) {
    // Re-roll: deterministic shuffle of the unioned focus/background pools.
    const baseFocus = slate?.focus ?? (data.todays_pick ? [data.todays_pick] : []);
    const baseBg = slate?.background ?? [];
    const focusPool = [...baseFocus, ...(data.focus_pool_extra ?? [])];
    const bgPool = [...baseBg, ...(data.background_pool ?? [])];
    focus = pick(focusPool, shuffleSeed, 3);
    background = pick(bgPool, shuffleSeed * 7 + 3, 2).map(withKind) as BackgroundFilm[];
  }

  // Drop films you've said "not tonight" / dismissed / watched, and backfill the
  // focus row from the queue so there's always something decisive to put on.
  const usedIds = new Set<number>();
  const keep = (arr: typeof focus) =>
    arr.filter((f) => {
      if (fs.isHidden(f.tmdb_id) || usedIds.has(f.tmdb_id)) return false;
      usedIds.add(f.tmdb_id);
      return true;
    });
  focus = keep(focus);
  if (!moodActive && focus.length < 3) {
    const pool = [...(data.queue ?? []), ...(data.focus_pool_extra ?? [])];
    for (const f of pool) {
      if (focus.length >= 3) break;
      if (!fs.isHidden(f.tmdb_id) && !usedIds.has(f.tmdb_id)) {
        usedIds.add(f.tmdb_id);
        focus.push(f);
      }
    }
  }
  background = background.filter((f) => !fs.isHidden(f.tmdb_id));

  function reroll() {
    setShuffleSeed((s) => s + 1);
    setSpinning(true);
    setToastVisible(true);
    window.setTimeout(() => setSpinning(false), 600);
    window.setTimeout(() => setToastVisible(false), 2000);
  }

  const headerDate = slate ? formatMonthDay(slate.date) : "";
  const weekday = slate ? slate.weekday : "";
  const moodUpper = moodLabel.toUpperCase();
  const moodKey = activeMoods.join("-") || `shuffle-${shuffleSeed}`;
  const heroFilm = focus.find((f) => f.backdrop) ?? focus[0] ?? data.todays_pick;
  const heroReason = heroFilm?.reasons?.[0] ?? "A precision pick from the current viewing engine.";
  const intensity = slateIntensity(focus);
  const canon = canonProgress(data);
  const hoursWatched = Math.round(data.stats.total_minutes / 60);
  const marqueeFilms = [...focus, ...background, ...data.queue.slice(0, 8)].filter(Boolean);

  const commandMetrics = [
    {
      label: "Slate intensity",
      value: intensity ? `${intensity}` : "—",
      caption: "recommendation pressure",
      icon: Gauge,
    },
    {
      label: "This week",
      value: `${data.stats.this_week}`,
      caption: "films logged",
      icon: Activity,
    },
    {
      label: "Canon coverage",
      value: canon.total ? `${canon.pct}%` : "—",
      caption: canon.total ? `${canon.seen}/${canon.total} unique titles` : "canon map pending",
      icon: Aperture,
    },
    {
      label: "Time in frame",
      value: formatNumber(hoursWatched),
      caption: "hours watched",
      icon: Eye,
    },
  ];

  return (
    <>
      <div className="px-5 sm:px-8 lg:px-14 py-6 sm:py-10 max-w-[1320px] mx-auto pb-16">
        <MoodStrip />

        <motion.header
          initial="hidden"
          animate="show"
          variants={staggerVariants}
          className="relative overflow-hidden rounded-xl border border-border/70 bg-card/35 film-shadow mb-12 sm:mb-16"
          data-testid="dynamic-hero"
        >
          <div className="absolute inset-0">
            <KenBurnsBackdrop path={heroFilm?.backdrop} size="original" className="h-full w-full opacity-45" />
            <div className="absolute inset-0 bg-gradient-to-r from-background via-background/88 to-background/35" />
            <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-background/20" />
            <div className="absolute inset-0 cine-scanlines opacity-35" />
          </div>

          <motion.div variants={sectionVariants} className="relative grid lg:grid-cols-[1fr_390px] gap-8 lg:gap-12 p-6 sm:p-9 lg:p-11 min-h-[620px] lg:min-h-[680px] items-end">
            <div className="max-w-3xl">
              <div className="mb-6 flex flex-wrap items-center gap-3">
                <p className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.3em] text-primary">
                  <Radar className="h-3.5 w-3.5" /> {moodActive ? "Mood-calibrated cockpit" : "Daily cinema cockpit"}
                </p>
                <span className="h-px w-10 bg-primary/40" />
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                  {moodActive ? moodUpper : `${weekday} · ${headerDate}`}
                </p>
              </div>

              <h1 className="font-serif text-5xl sm:text-7xl lg:text-8xl leading-[0.88] tracking-tight text-foreground text-balance">
                {moodActive ? (
                  <>
                    Tune the room. <span className="text-primary">Let the slate answer.</span>
                  </>
                ) : (
                  <>
                    Today’s slate, <span className="text-primary">cut like a trailer.</span>
                  </>
                )}
              </h1>

              <p className="mt-6 max-w-2xl text-base sm:text-lg leading-relaxed text-foreground/76">
                {moodActive
                  ? `The engine is now tuned to ${moodLabel}. Three films pull focus; two sit in the background as texture, contrast, or afterimage.`
                  : "A kinetic command deck for deciding what to watch, what to study, and where the next critical blind spot is hiding."}
              </p>

              {heroFilm && (
                <motion.div variants={sectionVariants} className="mt-7 max-w-2xl rounded-lg border border-primary/25 bg-background/45 backdrop-blur p-5 dynamic-sheen">
                  <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-primary mb-2">
                    Current thesis
                  </p>
                  <p className="font-serif text-xl sm:text-2xl leading-tight text-foreground">
                    {heroFilm.title} <span className="text-muted-foreground">({heroFilm.year})</span>
                  </p>
                  <p className="mt-2 font-serif italic text-[15px] leading-relaxed text-foreground/75">
                    {heroReason}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                    {heroFilm.directors?.slice(0, 2).map((director) => (
                      <span key={director} className="rounded-full border border-border bg-card/70 px-3 py-1">
                        {director}
                      </span>
                    ))}
                    {heroFilm.runtime ? (
                      <span className="rounded-full border border-border bg-card/70 px-3 py-1">
                        {formatRuntime(heroFilm.runtime)}
                      </span>
                    ) : null}
                    {heroFilm.genres?.slice(0, 2).map((genre) => (
                      <span key={genre} className="rounded-full border border-border bg-card/70 px-3 py-1">
                        {genre}
                      </span>
                    ))}
                  </div>
                </motion.div>
              )}

              <div className="mt-7 flex flex-wrap items-center gap-3">
                {!moodActive && (
                  <div className="relative flex items-center gap-3 shrink-0">
                    <AnimatePresence>
                      {toastVisible && (
                        <motion.span
                          initial={{ opacity: 0, y: -4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.2 }}
                          className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground"
                          data-testid="refresh-toast"
                        >
                          Re-rolled · shuffle #{shuffleSeed}
                        </motion.span>
                      )}
                    </AnimatePresence>
                    <button
                      onClick={reroll}
                      data-testid="button-refresh-picks"
                      className="group inline-flex items-center gap-2 rounded-full border border-primary/45 bg-primary/12 px-4 py-2 font-mono text-[10.5px] uppercase tracking-[0.14em] text-primary hover:bg-primary/20 transition-colors"
                    >
                      <motion.span
                        animate={{ rotate: spinning ? 360 : 0 }}
                        transition={{ duration: 0.6, ease: "easeInOut" }}
                        className="inline-flex"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                      </motion.span>
                      Refresh picks
                    </button>
                  </div>
                )}
                <Link href="/queue">
                  <div className="group inline-flex items-center gap-2 rounded-full border border-border bg-background/45 px-4 py-2 font-mono text-[10.5px] uppercase tracking-[0.14em] text-foreground/80 hover:border-primary/50 hover:text-primary transition-colors cursor-pointer">
                    Enter queue <ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                  </div>
                </Link>
              </div>
            </div>

            <div className="relative hidden lg:block min-h-[560px]">
              <HeroPosterStack films={focus} onOpen={(film) => modal.open(film)} />
            </div>
          </motion.div>

          <motion.div variants={sectionVariants} className="relative border-t border-border/70 bg-background/50 backdrop-blur px-5 sm:px-8 py-5">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {commandMetrics.map((metric) => (
                <CommandMetric key={metric.label} {...metric} />
              ))}
            </div>
          </motion.div>
        </motion.header>

        <DynamicMarquee films={marqueeFilms} />

        <motion.section
          variants={staggerVariants}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-80px" }}
          className="mb-16"
          key={`focus-${moodKey}`}
        >
          <SlateSectionHeading
            kicker="Focus"
            title={moodActive ? `${moodLabel} focus` : "Sharpen the craft"}
            count={focus.length}
            description="The foreground picks: active viewing, note-taking, and critical pressure."
          />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 sm:gap-6">
            {focus.map((f, i) => (
              <motion.div key={f.tmdb_id} variants={sectionVariants} whileHover={{ y: -8 }} transition={{ duration: 0.25, ease: EASE }}>
                <div className="relative">
                  <span className="pointer-events-none absolute -left-2 -top-2 z-10 rounded-full border border-primary/35 bg-background px-2.5 py-1 font-mono text-[10px] text-primary shadow-lg">
                    0{i + 1}
                  </span>
                  <FocusCard
                    film={f}
                    onOpen={() => modal.open(f)}
                    rationaleLabel={moodActive ? `Why for your ${moodUpper} mood` : undefined}
                  />
                </div>
              </motion.div>
            ))}
          </div>
        </motion.section>

        {background.length > 0 && (
          <motion.section
            variants={staggerVariants}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: "-80px" }}
            className="mb-16"
            key={`bg-${moodKey}`}
          >
            <SlateSectionHeading
              kicker="Background"
              title="Keep on in the background"
              count={background.length}
              description="Ambient counter-programming: familiar texture, low-friction rewatches, or mood complements."
              muted
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-5">
              {background.map((f) => (
                <motion.div key={f.tmdb_id} variants={sectionVariants} whileHover={{ x: 4 }} transition={{ duration: 0.25, ease: EASE }}>
                  <BackgroundCard film={f} onOpen={() => modal.open(f)} />
                </motion.div>
              ))}
            </div>
          </motion.section>
        )}

        <motion.section
          variants={sectionVariants}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-80px" }}
          className="mb-16"
        >
          <div className="grid lg:grid-cols-[0.9fr_1.1fr] gap-5 sm:gap-6">
            <div className="relative overflow-hidden rounded-xl border border-border bg-card/35 p-6 sm:p-8 film-shadow">
              <div className="absolute -right-16 -top-16 h-48 w-48 rounded-full bg-primary/10 blur-3xl" />
              <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-muted-foreground mb-2">
                Momentum
              </p>
              <div className="flex items-end gap-4">
                <p className="font-serif text-7xl sm:text-8xl text-primary leading-none">
                  {data.stats.this_week}
                </p>
                <div className="pb-3">
                  <p className="font-serif text-2xl text-foreground">films logged</p>
                  <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground mt-1">
                    this week
                  </p>
                </div>
              </div>
              <p className="mt-5 text-sm leading-relaxed text-foreground/68">
                The dashboard is not just a watchlist. It is a velocity readout: what is moving, where the gaps are, and what should be pulled into focus next.
              </p>
            </div>
            <div className="rounded-xl border border-border bg-card/35 p-6 sm:p-8 film-shadow">
              <div className="flex items-center justify-between gap-4 mb-3">
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-muted-foreground">
                    Last 12 months
                  </p>
                  <p className="font-serif text-2xl text-foreground mt-1">Viewing pulse</p>
                </div>
                <Sparkles className="h-5 w-5 text-primary" />
              </div>
              <Sparkline months={last12} />
            </div>
          </div>
        </motion.section>

        <motion.section
          variants={staggerVariants}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-80px" }}
          className="mb-16"
        >
          <SectionHeading title="Recent Watches" description="A horizontal trace of the latest viewing history." />
          <div className="flex gap-4 overflow-x-auto hide-scrollbar pb-4 -mx-1 px-1 snap-x">
            {recent.map((w, i) => {
              const dir = posterIdx.get(w.tmdb) ?? null;
              return (
                <motion.a
                  key={`${w.tmdb}-${w.last_watched}`}
                  href={`https://letterboxd.com/tmdb/${w.tmdb}/`}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid={`recent-${w.tmdb}`}
                  variants={sectionVariants}
                  whileHover={{ y: -6, rotate: i % 2 === 0 ? -1.2 : 1.2 }}
                  transition={{ duration: 0.22, ease: EASE }}
                  className="group shrink-0 w-[126px] snap-start"
                >
                  <Poster
                    path={dir}
                    alt={w.title}
                    className="w-[126px] aspect-[2/3] rounded-md border border-border group-hover:border-primary/50 transition-colors film-shadow"
                  />
                  <p className="font-serif text-sm leading-tight mt-2 line-clamp-2 group-hover:text-primary transition-colors">
                    {w.title}
                  </p>
                  <p className="font-mono text-[10px] text-muted-foreground mt-0.5">
                    {w.last_watched}
                  </p>
                </motion.a>
              );
            })}
          </div>
        </motion.section>

        <motion.section
          variants={staggerVariants}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-80px" }}
        >
          <SectionHeading title="Explore" description="Jump into the active systems that make the app feel alive." />
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {QUICK_NAV.map((j) => {
              const Icon = j.icon;
              return (
                <motion.div key={j.href} variants={sectionVariants} whileHover={{ y: -5 }} transition={{ duration: 0.22, ease: EASE }}>
                  <Link href={j.href} data-testid={`quicknav-${j.href.replace("/", "")}`}>
                    <div className="group relative overflow-hidden rounded-xl border border-border bg-card/35 p-5 h-full hover:border-primary/45 cursor-pointer transition-colors film-shadow dynamic-sheen">
                      <div className="absolute -right-10 -top-12 h-28 w-28 rounded-full bg-primary/8 blur-2xl transition-transform duration-500 group-hover:scale-150" />
                      <div className="relative flex items-start gap-4">
                        <div className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-background/60 text-muted-foreground group-hover:text-primary group-hover:border-primary/45 transition-colors">
                          <Icon className="h-5 w-5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-3">
                            <p className="font-serif text-xl leading-tight text-foreground group-hover:text-primary transition-colors">
                              {j.label}
                            </p>
                            <ArrowUpRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-primary" />
                          </div>
                          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-primary/80 mt-1">
                            {j.metric(data)}
                          </p>
                          <p className="text-sm leading-relaxed text-foreground/64 mt-3">
                            {j.blurb}
                          </p>
                        </div>
                      </div>
                    </div>
                  </Link>
                </motion.div>
              );
            })}
          </div>
        </motion.section>
      </div>
      <FilmDetailModal film={modal.film} onClose={modal.close} />
    </>
  );
}

function HeroPosterStack({
  films,
  onOpen,
}: {
  films: QueueFilm[];
  onOpen: (film: QueueFilm) => void;
}) {
  if (!films.length) return null;
  return (
    <div className="absolute inset-0">
      {films.slice(0, 3).map((film, index) => {
        const offset = index * 58;
        const rotate = [-7, 3, 10][index] ?? 0;
        return (
          <motion.button
            key={film.tmdb_id}
            onClick={() => onOpen(film)}
            initial={{ opacity: 0, y: 60, rotate: rotate - 4 }}
            animate={{ opacity: 1, y: 0, rotate }}
            transition={{ delay: 0.2 + index * 0.11, duration: 0.7, ease: EASE }}
            whileHover={{ y: -14, rotate: rotate / 2, scale: 1.03, zIndex: 30 }}
            className="absolute bottom-6 right-0 w-[240px] text-left focus:outline-none focus:ring-2 focus:ring-primary"
            style={{ right: offset, zIndex: 10 - index }}
            aria-label={`Open ${film.title}`}
          >
            <Poster
              path={film.poster}
              alt={film.title}
              className="aspect-[2/3] w-full rounded-xl border border-primary/25 film-shadow"
              size="w500"
            />
            <div className="mt-3 rounded-md border border-border/70 bg-background/75 backdrop-blur p-3">
              <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-primary">
                Focus 0{index + 1}
              </p>
              <p className="font-serif text-lg leading-tight text-foreground line-clamp-1">
                {film.title}
              </p>
            </div>
          </motion.button>
        );
      })}
    </div>
  );
}

function CommandMetric({
  label,
  value,
  caption,
  icon: Icon,
}: {
  label: string;
  value: string;
  caption: string;
  icon: typeof Clapperboard;
}) {
  return (
    <div className="relative overflow-hidden rounded-lg border border-border/70 bg-card/45 p-4 dynamic-sheen">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
            {label}
          </p>
          <p className="font-serif text-3xl text-foreground mt-1 leading-none">
            {value}
          </p>
        </div>
        <Icon className="h-4 w-4 text-primary" />
      </div>
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/75 mt-3">
        {caption}
      </p>
    </div>
  );
}

function DynamicMarquee({ films }: { films: (QueueFilm | BackgroundFilm)[] }) {
  const clean = films.filter(Boolean).slice(0, 12);
  if (!clean.length) return null;
  const loop = [...clean, ...clean];
  return (
    <section className="mb-14 overflow-hidden rounded-full border border-border/70 bg-card/25 py-3" aria-label="Current film signal">
      <div className="cine-marquee flex min-w-max gap-8 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
        {loop.map((film, index) => (
          <span key={`${film.tmdb_id}-${index}`} className="inline-flex items-center gap-3">
            <span className="h-1.5 w-1.5 rounded-full bg-primary/70" />
            <span className="text-foreground/80">{film.title}</span>
            <span>{film.year}</span>
          </span>
        ))}
      </div>
    </section>
  );
}

function SlateSectionHeading({
  kicker,
  title,
  count,
  description,
  muted = false,
}: {
  kicker: string;
  title: string;
  count: number;
  description?: string;
  muted?: boolean;
}) {
  return (
    <div className="mb-6">
      <div className="flex items-baseline gap-4">
        <div>
          <p
            className={`font-mono text-[11px] uppercase tracking-[0.28em] ${
              muted ? "text-muted-foreground" : "text-primary"
            }`}
          >
            {kicker} · {count}
          </p>
          <h2 className="font-serif text-3xl sm:text-4xl tracking-tight text-foreground mt-1">
            {title}
          </h2>
        </div>
        <span className="h-px flex-1 bg-border self-center mt-2" />
      </div>
      {description && (
        <p className="text-sm sm:text-[15px] leading-relaxed text-muted-foreground mt-3 max-w-2xl">
          {description}
        </p>
      )}
    </div>
  );
}

function SectionHeading({ title, description }: { title: string; description?: string }) {
  return (
    <div className="flex items-end gap-4 mb-6">
      <div>
        <h2 className="font-mono text-[12px] uppercase tracking-[0.28em] text-muted-foreground">
          {title}
        </h2>
        {description && <p className="text-sm text-foreground/62 mt-2">{description}</p>}
      </div>
      <span className="h-px flex-1 bg-border mb-1" />
    </div>
  );
}
