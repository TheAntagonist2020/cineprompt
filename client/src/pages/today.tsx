import { lazy, Suspense, useState } from "react";
import { Link } from "wouter";
import { AnimatePresence, motion } from "framer-motion";
import { CalendarDays, ListVideo, Compass, Users, Tv, Activity, RefreshCw } from "lucide-react";
import {
  useAppData,
  getPosterIndex,
  formatMonthDay,
  todayISO,
} from "@/lib/data";
import {
  Poster,
  FocusCard,
  BackgroundCard,
  FilmDetailModal,
  useFilmModal,
} from "@/components/film-ui";
import { LoadingScreen } from "@/components/layout";
import { MoodStrip } from "@/components/mood-strip";
import { useFilmState } from "@/lib/filmState";
import { liveQueue } from "@/lib/liveScore";
import {
  useMood,
  moodMetaByIds,
  moodPicks,
  moodFocus,
  moodBackground,
  withKind,
} from "@/lib/mood";
const Sparkline = lazy(() => import("@/components/sparkline"));

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

const QUICK_NAV = [
  { href: "/week", label: "Week Ahead", icon: CalendarDays },
  { href: "/queue", label: "Queue", icon: ListVideo },
  { href: "/blindspots", label: "Blind Spots", icon: Compass },
  { href: "/directors", label: "Directors", icon: Users },
  { href: "/background", label: "Background", icon: Tv },
  { href: "/tracking", label: "Tracking", icon: Activity },
];

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
  const recent = data.recent_watches.slice(0, 10);
  const posterIdx = getPosterIndex(data);

  const moods = moodMetaByIds(data, activeMoods);
  const moodActive = moods.length > 0;
  const moodLabel = moods.map((m) => m.label).join(" + ");

  // Build the slate: mood-driven when moods are active, else the daily slate.
  let focus = slate ? slate.focus : data.todays_pick ? [data.todays_pick] : [];
  let background = slate ? slate.background : [];
  if (moodActive) {
    const picks = moodPicks(data, activeMoods);
    focus = moodFocus(picks, 3);
    background = moodBackground(picks, focus, 2).map(withKind);
  } else if (shuffleSeed > 0) {
    // Re-roll: deterministic shuffle of the unioned focus/background pools.
    const baseFocus = slate?.focus ?? (data.todays_pick ? [data.todays_pick] : []);
    const baseBg = slate?.background ?? [];
    const focusPool = [...baseFocus, ...(data.focus_pool_extra ?? [])];
    const bgPool = [...baseBg, ...(data.background_pool ?? [])];
    focus = pick(focusPool, shuffleSeed, 3);
    background = pick(bgPool, shuffleSeed * 7 + 3, 2).map(withKind);
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
    // Backfill in live order: hidden films are already dropped and shortlist /
    // just-watched director affinity floats related picks to the front.
    const pool = liveQueue(data, [...(data.queue ?? []), ...(data.focus_pool_extra ?? [])], fs);
    for (const f of pool) {
      if (focus.length >= 3) break;
      if (!usedIds.has(f.tmdb_id)) {
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
  const moodKey = activeMoods.join("-") || "all";

  return (
    <>
      <div className="px-5 sm:px-8 lg:px-14 py-8 sm:py-12 max-w-[1180px] mx-auto pb-16">
        <MoodStrip />

        {/* EDITORIAL HEADER */}
        <header className="mb-9 sm:mb-12 transition-opacity duration-200">
          <div className="flex items-start justify-between gap-4">
            <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-primary mb-3 flex items-center gap-2">
              <CalendarDays className="h-3.5 w-3.5" /> {moodActive ? "Mood Slate" : "Today's Slate"}
            </p>
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
                  className="group inline-flex items-center gap-2 border border-border bg-card/60 rounded-sm px-3 py-1.5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-foreground/85 hover:border-primary/50 hover:text-primary transition-colors"
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
          </div>
          {moodActive ? (
            <h1 className="font-serif text-4xl sm:text-6xl leading-[1.0] tracking-tight text-foreground text-balance">
              TODAY · <span className="text-primary">{moodUpper} PICKS</span>
            </h1>
          ) : (
            <h1 className="font-serif text-4xl sm:text-6xl leading-[1.0] tracking-tight text-foreground text-balance">
              TODAY · {weekday}, {headerDate}
            </h1>
          )}
          <p className="text-muted-foreground mt-4 max-w-xl leading-relaxed text-[15px] sm:text-base">
            {moodActive
              ? `Tuned to your ${moodLabel} mood — 3 picks to focus on, 2 to keep on in the background.`
              : "3 picks to sharpen the craft. 2 to keep on in the background."}
          </p>
        </header>

        {/* FOCUS */}
        <section className="mb-14" key={`focus-${moodKey}`} >
          <div className="animate-in fade-in duration-200">
          <SlateSectionHeading
            kicker="Focus"
            title={moodActive ? `${moodLabel} focus` : "Sharpen the craft"}
            count={focus.length}
          />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 sm:gap-6">
            {focus.map((f) => (
              <FocusCard
                key={f.tmdb_id}
                film={f}
                onOpen={() => modal.open(f)}
                rationaleLabel={moodActive ? `Why for your ${moodUpper} mood` : undefined}
              />
            ))}
          </div>
          </div>
        </section>

        {/* BACKGROUND */}
        {background.length > 0 && (
          <section className="mb-16" key={`bg-${moodKey}`}>
            <div className="animate-in fade-in duration-200">
            <SlateSectionHeading
              kicker="Background"
              title="Keep on in the background"
              count={background.length}
              muted
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-5">
              {background.map((f) => (
                <BackgroundCard
                  key={f.tmdb_id}
                  film={f as any}
                  onOpen={() => modal.open(f)}
                />
              ))}
            </div>
            </div>
          </section>
        )}

        {/* THIS WEEK + sparkline */}
        <section className="mb-16">
          <div className="grid sm:grid-cols-[auto_1fr] gap-6 sm:gap-10 items-center border border-border rounded-md bg-card/40 p-6 sm:p-8">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-muted-foreground mb-2">
                This Week
              </p>
              <p className="font-serif text-6xl text-primary leading-none">
                {data.stats.this_week}
              </p>
              <p className="font-mono text-xs text-muted-foreground mt-2">films logged</p>
            </div>
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground mb-1">
                Last 12 months
              </p>
              <Suspense fallback={<div className="h-16" />}>
                <Sparkline months={last12} />
              </Suspense>
            </div>
          </div>
        </section>

        {/* RECENT WATCHES */}
        <section className="mb-16">
          <SectionHeading title="Recent Watches" />
          <div className="flex gap-4 overflow-x-auto hide-scrollbar pb-2 -mx-1 px-1">
            {recent.map((w) => {
              const dir = posterIdx.get(w.tmdb) ?? null;
              return (
                <a
                  key={`${w.tmdb}-${w.last_watched}`}
                  href={`https://letterboxd.com/tmdb/${w.tmdb}/`}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid={`recent-${w.tmdb}`}
                  className="group shrink-0 w-[112px]"
                >
                  <Poster
                    path={dir}
                    alt={w.title}
                    className="w-[112px] aspect-[2/3] rounded-sm border border-border group-hover:border-primary/50 transition-colors"
                  />
                  <p className="font-serif text-sm leading-tight mt-2 line-clamp-2 group-hover:text-primary transition-colors">
                    {w.title}
                  </p>
                  <p className="font-mono text-[10px] text-muted-foreground mt-0.5">
                    {w.last_watched}
                  </p>
                </a>
              );
            })}
          </div>
        </section>

        {/* QUICK NAV */}
        <section>
          <SectionHeading title="Explore" />
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
            {QUICK_NAV.map((j) => {
              const Icon = j.icon;
              return (
                <Link key={j.href} href={j.href} data-testid={`quicknav-${j.href.replace("/", "")}`}>
                  <div className="group border border-border rounded-md p-4 h-full bg-card/40 hover-elevate cursor-pointer transition-colors flex flex-col gap-3">
                    <Icon className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors" />
                    <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-foreground/85 group-hover:text-primary transition-colors">
                      {j.label}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      </div>
      <FilmDetailModal film={modal.film} onClose={modal.close} />
    </>
  );
}

function SlateSectionHeading({
  kicker,
  title,
  count,
  muted = false,
}: {
  kicker: string;
  title: string;
  count: number;
  muted?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-4 mb-6">
      <div>
        <p
          className={`font-mono text-[11px] uppercase tracking-[0.28em] ${
            muted ? "text-muted-foreground" : "text-primary"
          }`}
        >
          {kicker} · {count}
        </p>
        <h2 className="font-serif text-2xl sm:text-3xl tracking-tight text-foreground mt-1">
          {title}
        </h2>
      </div>
      <span className="h-px flex-1 bg-border self-center mt-2" />
    </div>
  );
}

function SectionHeading({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-4 mb-6">
      <h2 className="font-mono text-[12px] uppercase tracking-[0.28em] text-muted-foreground">
        {title}
      </h2>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}
