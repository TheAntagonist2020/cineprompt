import {
  useAppData,
  formatMonthDay,
  todayISO,
  type Slate,
} from "@/lib/data";
import {
  MiniCard,
  FilmDetailModal,
  useFilmModal,
} from "@/components/film-ui";
import { LoadingScreen, PageShell } from "@/components/layout";
import { MoodStrip } from "@/components/mood-strip";
import { useMood, moodMetaByIds, moodPicks, withKind } from "@/lib/mood";

export default function Week() {
  const { data, loading } = useAppData();
  const modal = useFilmModal();
  const { activeMoods } = useMood();
  if (loading || !data) return <LoadingScreen />;

  const iso = todayISO();
  const baseSlates = data.slates ?? [];
  const moods = moodMetaByIds(data, activeMoods);
  const moodActive = moods.length > 0;
  const moodLabel = moods.map((m) => m.label).join(" + ");
  const moodKey = activeMoods.join("-") || "all";

  // When moods are active, rebuild each day's slate from mood_picks,
  // slicing 5 picks per day (3 focus, 2 background) without repetition.
  let slates: Slate[] = baseSlates;
  if (moodActive) {
    const picks = moodPicks(data, activeMoods);
    slates = baseSlates.map((s, dayIdx) => {
      const chunk = picks.slice(dayIdx * 5, dayIdx * 5 + 5);
      const focus = chunk.slice(0, 3) as any;
      const background = chunk.slice(3, 5).map(withKind) as any;
      return { ...s, focus, background };
    });
  }

  return (
    <>
      <PageShell
        eyebrow={moodActive ? `7 days · ${moodLabel.toUpperCase()}` : "7 days · 35 films"}
        title="The Week"
        intro="A full week of viewing planned out — three focus picks and two background films a day. Tap any title for details and where to watch."
      >
        <MoodStrip />
        <div className="space-y-px border-t border-border animate-in fade-in duration-200" key={moodKey}>
          {slates.map((slate) => (
            <DayRow
              key={slate.date}
              slate={slate}
              isToday={!moodActive && slate.date === iso}
              onOpen={(f) => modal.open(f as any)}
            />
          ))}
        </div>
      </PageShell>
      <FilmDetailModal film={modal.film} onClose={modal.close} />
    </>
  );
}

function DayRow({
  slate,
  isToday,
  onOpen,
}: {
  slate: Slate;
  isToday: boolean;
  onOpen: (f: unknown) => void;
}) {
  return (
    <section
      className={`py-7 border-b border-border ${isToday ? "bg-primary/[0.04] -mx-5 sm:-mx-8 lg:-mx-14 px-5 sm:px-8 lg:px-14" : ""}`}
      data-testid={`day-${slate.date}`}
    >
      {/* Day header */}
      <div className="flex items-baseline gap-3 mb-5">
        <h2
          className={`font-serif text-2xl sm:text-3xl tracking-tight ${
            isToday ? "text-primary" : "text-foreground"
          }`}
        >
          {slate.weekday.toUpperCase()} · {formatMonthDay(slate.date)}
        </h2>
        {isToday && (
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-primary border border-primary/40 rounded-sm px-2 py-0.5">
            Today
          </span>
        )}
      </div>

      {/* Two columns */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-x-10 gap-y-6">
        {/* FOCUS */}
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-primary/90 mb-3">
            Focus
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3 gap-3">
            {slate.focus.map((f) => (
              <MiniCard key={f.tmdb_id} film={f} onOpen={() => onOpen(f)} />
            ))}
          </div>
        </div>

        {/* BACKGROUND */}
        <div className="lg:border-l lg:border-border lg:pl-10">
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground mb-3">
            Background
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-3">
            {slate.background.map((f) => (
              <MiniCard
                key={f.tmdb_id}
                film={f}
                badge={f.kind}
                onOpen={() => onOpen(f)}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
