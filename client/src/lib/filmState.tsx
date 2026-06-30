import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { todayISO } from "@/lib/data";

// ---------- Types ----------
export type FilmStatus = "shortlist" | "watched" | "dismissed" | null;

export interface FilmState {
  status?: FilmStatus;
  snooze_until?: string | null; // 'YYYY-MM-DD'; "not tonight" hides until then
  notes?: string | null;
  rating?: number | null;
}

interface FilmStateContextValue {
  ready: boolean; // initial load done
  available: boolean; // API reachable (false in Express dev)
  get: (tmdbId: number) => FilmState | undefined;
  isHidden: (tmdbId: number) => boolean; // dismissed / watched / snoozed
  isShortlisted: (tmdbId: number) => boolean;
  isWatched: (tmdbId: number) => boolean;
  shortlistIds: () => number[];
  snooze: (tmdbId: number) => void; // "not tonight"
  dismiss: (tmdbId: number) => void; // never show again
  toggleShortlist: (tmdbId: number) => void;
  markWatched: (tmdbId: number) => void;
  clear: (tmdbId: number) => void; // undo all state for a film
}

const noop = () => {};
const FilmStateContext = createContext<FilmStateContextValue>({
  ready: false,
  available: false,
  get: () => undefined,
  isHidden: () => false,
  isShortlisted: () => false,
  isWatched: () => false,
  shortlistIds: () => [],
  snooze: noop,
  dismiss: noop,
  toggleShortlist: noop,
  markWatched: noop,
  clear: noop,
});

function tomorrowISO(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function FilmStateProvider({ children }: { children: ReactNode }) {
  const [map, setMap] = useState<Map<number, FilmState>>(new Map());
  const [ready, setReady] = useState(false);
  const [available, setAvailable] = useState(false);

  // Load all state once on mount.
  useEffect(() => {
    let alive = true;
    fetch("/api/state")
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: { films?: any[] }) => {
        if (!alive) return;
        const m = new Map<number, FilmState>();
        for (const f of d.films ?? []) {
          m.set(Number(f.tmdb_id), {
            status: f.status ?? null,
            snooze_until: f.snooze_until ?? null,
            notes: f.notes ?? null,
            rating: f.rating ?? null,
          });
        }
        setMap(m);
        setAvailable(true);
      })
      .catch(() => {
        // API not present (e.g. Express dev) — degrade gracefully.
        if (alive) setAvailable(false);
      })
      .finally(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, []);

  // Optimistic local update + best-effort persist.
  const patch = useCallback((tmdbId: number, p: FilmState) => {
    setMap((prev) => {
      const next = new Map(prev);
      next.set(tmdbId, { ...(prev.get(tmdbId) ?? {}), ...p });
      return next;
    });
    fetch("/api/state", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tmdb_id: tmdbId, ...p }),
    }).catch(() => {
      /* keep optimistic state; nothing sensitive to roll back */
    });
  }, []);

  const value = useMemo<FilmStateContextValue>(() => {
    const today = todayISO();
    const get = (id: number) => map.get(id);
    return {
      ready,
      available,
      get,
      isHidden: (id) => {
        const s = map.get(id);
        if (!s) return false;
        if (s.status === "dismissed" || s.status === "watched") return true;
        if (s.snooze_until && s.snooze_until > today) return true;
        return false;
      },
      isShortlisted: (id) => map.get(id)?.status === "shortlist",
      isWatched: (id) => map.get(id)?.status === "watched",
      shortlistIds: () =>
        [...map.entries()].filter(([, s]) => s.status === "shortlist").map(([id]) => id),
      snooze: (id) => patch(id, { snooze_until: tomorrowISO() }),
      dismiss: (id) => patch(id, { status: "dismissed", snooze_until: null }),
      toggleShortlist: (id) =>
        patch(id, {
          status: map.get(id)?.status === "shortlist" ? null : "shortlist",
        }),
      markWatched: (id) => patch(id, { status: "watched", snooze_until: null }),
      clear: (id) => patch(id, { status: null, snooze_until: null }),
    };
  }, [map, ready, available, patch]);

  return <FilmStateContext.Provider value={value}>{children}</FilmStateContext.Provider>;
}

export function useFilmState(): FilmStateContextValue {
  return useContext(FilmStateContext);
}
