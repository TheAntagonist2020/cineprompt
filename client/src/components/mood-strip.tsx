import { X } from "lucide-react";
import { useAppData } from "@/lib/data";
import { useMood, groupedMoods, moodMetaByIds } from "@/lib/mood";

// Horizontal mood selector with grouped, toggleable chips + active blurb bar.
export function MoodStrip() {
  const { data } = useAppData();
  const { activeMoods, toggleMood, clearMoods } = useMood();
  if (!data || !data.moods_meta?.length) return null;

  const groups = groupedMoods(data);
  const active = moodMetaByIds(data, activeMoods);
  const labels = active.map((m) => m.label).join(" · ");

  return (
    <div className="mb-7 sm:mb-9" data-testid="mood-strip">
      <div className="-mx-5 sm:-mx-8 lg:-mx-14 px-5 sm:px-8 lg:px-14">
        <div className="flex items-center gap-2 overflow-x-auto hide-scrollbar snap-x snap-mandatory pb-1 [scroll-padding-left:1.25rem]">
          {/* ALL chip — clears all moods */}
          <button
            onClick={clearMoods}
            data-testid="mood-chip-all"
            className={`snap-start shrink-0 font-mono text-[10.5px] uppercase tracking-[0.16em] px-3.5 py-1.5 rounded-full border transition-all duration-200 ${
              activeMoods.length === 0
                ? "border-primary/50 text-primary ring-1 ring-primary/40 bg-primary/5"
                : "border-border/70 text-foreground/70 hover:text-foreground hover:border-border"
            }`}
          >
            All
          </button>

          {groups.map(({ group, moods }) => (
            <div key={group} className="flex items-center gap-2 shrink-0">
              <span className="font-mono text-[9px] uppercase tracking-[0.26em] text-muted-foreground/45 pl-2 shrink-0 select-none">
                {group}
              </span>
              {moods.map((m) => {
                const sel = activeMoods.includes(m.id);
                return (
                  <button
                    key={m.id}
                    onClick={() => toggleMood(m.id)}
                    data-testid={`mood-chip-${m.id}`}
                    aria-pressed={sel}
                    className={`snap-start shrink-0 font-mono text-[10.5px] uppercase tracking-[0.14em] px-3.5 py-1.5 rounded-full border transition-all duration-200 ${
                      sel
                        ? "bg-primary text-primary-foreground border-primary font-medium"
                        : "border-border/70 text-foreground/70 hover:text-foreground hover:border-primary/40"
                    }`}
                  >
                    {m.label}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Active moods blurb bar */}
      {active.length > 0 && (
        <div
          className="mt-3 flex items-center gap-3 rounded-sm border border-primary/30 bg-primary/[0.07] px-3.5 py-2 animate-in fade-in duration-200"
          data-testid="mood-blurb-bar"
        >
          <span className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-primary shrink-0">
            {active.length === 1 ? "Mood" : `${active.length} moods`}: {labels}
          </span>
          {active.length === 1 && (
            <>
              <span className="h-3 w-px bg-primary/30 shrink-0" />
              <span className="font-sans text-[12.5px] text-foreground/70 truncate">
                {active[0].blurb}
              </span>
            </>
          )}
          {active.length > 1 && (
            <span className="font-sans text-[12.5px] text-foreground/55 truncate">
              Showing films that fit every selected mood.
            </span>
          )}
          <button
            onClick={clearMoods}
            data-testid="mood-clear"
            className="ml-auto shrink-0 inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground hover:text-primary transition-colors"
          >
            <X className="h-3 w-3" /> Clear all
          </button>
        </div>
      )}
    </div>
  );
}
