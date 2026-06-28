import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { AppData, MoodMeta, MoodFilm, MoodGroup } from "@/lib/data";

// ---------- In-memory multi-select mood state (NO localStorage — resets on refresh) ----------
interface MoodContextValue {
  activeMoods: string[];
  setActiveMoods: (m: string[]) => void;
  toggleMood: (id: string) => void;
  clearMoods: () => void;
}

const MoodContext = createContext<MoodContextValue>({
  activeMoods: [],
  setActiveMoods: () => {},
  toggleMood: () => {},
  clearMoods: () => {},
});

export function MoodProvider({ children }: { children: ReactNode }) {
  const [activeMoods, setActiveMoods] = useState<string[]>([]);

  const toggleMood = useCallback((id: string) => {
    setActiveMoods((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id],
    );
  }, []);

  const clearMoods = useCallback(() => setActiveMoods([]), []);

  const value = useMemo(
    () => ({ activeMoods, setActiveMoods, toggleMood, clearMoods }),
    [activeMoods, toggleMood, clearMoods],
  );
  return <MoodContext.Provider value={value}>{children}</MoodContext.Provider>;
}

export function useMood(): MoodContextValue {
  return useContext(MoodContext);
}

// ---------- Lookups ----------
export function moodMetaByIds(data: AppData, ids: string[]): MoodMeta[] {
  if (!ids?.length) return [];
  const meta = data.moods_meta ?? [];
  return ids
    .map((id) => meta.find((m) => m.id === id))
    .filter((m): m is MoodMeta => !!m);
}

// Group order for rendering the strip.
export const GROUP_ORDER: MoodGroup[] = ["Era", "Genre", "Vibe", "Quick"];

export function groupedMoods(data: AppData): { group: MoodGroup; moods: MoodMeta[] }[] {
  const meta = data.moods_meta ?? [];
  return GROUP_ORDER.map((group) => ({
    group,
    moods: meta.filter((m) => m.group === group),
  })).filter((g) => g.moods.length > 0);
}

// ---------- Picks for selected moods ----------
// 0 moods → []; 1 → that mood's picks; 2+ → INTERSECTION (films in ALL selected
// mood arrays) sorted by appearance count desc. If intersection empty → UNION capped to 60.
export function moodPicks(data: AppData, activeMoods: string[]): MoodFilm[] {
  if (!activeMoods?.length) return [];
  const picksByMood = activeMoods
    .map((id) => data.mood_picks?.[id] ?? [])
    .filter((arr) => arr.length > 0);
  if (picksByMood.length === 0) return [];
  if (picksByMood.length === 1) return picksByMood[0];

  // Count appearances of each tmdb_id and remember the film object.
  const count = new Map<number, number>();
  const film = new Map<number, MoodFilm>();
  for (const arr of picksByMood) {
    for (const f of arr) {
      count.set(f.tmdb_id, (count.get(f.tmdb_id) ?? 0) + 1);
      if (!film.has(f.tmdb_id)) film.set(f.tmdb_id, f);
    }
  }

  const n = picksByMood.length;
  const intersection = [...count.entries()]
    .filter(([, c]) => c === n)
    .map(([id]) => film.get(id)!)
    .filter(Boolean);

  if (intersection.length > 0) return intersection;

  // Fallback: union sorted by appearance count desc, capped to 60.
  const union = [...count.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => film.get(id)!)
    .filter(Boolean);
  return union.slice(0, 60);
}

function isRewatch(f: MoodFilm): boolean {
  return f.kind === "rewatch";
}

// FOCUS for Today: top 3 unseen; if fewer than 3, fill with rewatches.
export function moodFocus(picks: MoodFilm[], n = 3): MoodFilm[] {
  const unseen = picks.filter((f) => !isRewatch(f));
  if (unseen.length >= n) return unseen.slice(0, n);
  const used = new Set(unseen.map((f) => f.tmdb_id));
  const fill = picks.filter((f) => isRewatch(f) && !used.has(f.tmdb_id));
  return [...unseen, ...fill].slice(0, n);
}

// BACKGROUND for Today: top 2 rewatches; if none, use top non-focus picks.
export function moodBackground(
  picks: MoodFilm[],
  focus: MoodFilm[],
  n = 2,
): MoodFilm[] {
  const focusIds = new Set(focus.map((f) => f.tmdb_id));
  const rewatches = picks.filter((f) => isRewatch(f) && !focusIds.has(f.tmdb_id));
  if (rewatches.length > 0) return rewatches.slice(0, n);
  return picks.filter((f) => !focusIds.has(f.tmdb_id)).slice(0, n);
}

// Normalize a pick into a "kind" so cards that expect it render correctly.
export function withKind(f: MoodFilm): MoodFilm & { kind: "rewatch" | "new" } {
  return { ...f, kind: f.kind === "rewatch" ? "rewatch" : "new" };
}
