import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { todayISO } from "@/lib/data";

// ---------- Types ----------
export type FilmStatus = "shortlist" | "watched" | "dismissed" | null;

/** What we remember about a film so a shortlisted title outlives the pools. */
export interface FilmSnapshot {
  title: string;
  year?: string | number | null;
  poster?: string | null;
  imdb_id?: string | null;
  directors?: string[] | null;
  runtime?: number | null;
  reasons?: string[] | null;
}

export interface FilmState {
  status?: FilmStatus;
  snooze_until?: string | null; // 'YYYY-MM-DD'; "not tonight" hides until then
  notes?: string | null;
  rating?: number | null;
  updated_at?: number; // ms since epoch, local clock
  film?: FilmSnapshot | null;
}

export type CloudStatus = "checking" | "synced" | "offline";

export interface FilmStateContextValue {
  ready: boolean; // local state loaded (immediate)
  /** The /api endpoints answered at load — what the Sync-now control keys off.
   *  Independent of `cloud`, which tracks whether the latest write landed. */
  available: boolean;
  cloud: CloudStatus;
  get: (tmdbId: number) => FilmState | undefined;
  isHidden: (tmdbId: number) => boolean; // dismissed / watched / snoozed
  isShortlisted: (tmdbId: number) => boolean;
  isWatched: (tmdbId: number) => boolean;
  shortlistIds: () => number[];
  watchedIds: () => number[];
  /** Shortlisted films with whatever snapshot we hold, newest first. */
  shortlistFilms: () => Array<{ tmdb_id: number; film: FilmSnapshot | null; updated_at: number }>;
  snooze: (tmdbId: number, film?: FilmSnapshot) => void; // "not tonight"
  dismiss: (tmdbId: number, film?: FilmSnapshot) => void; // never show again
  toggleShortlist: (tmdbId: number, film?: FilmSnapshot) => void;
  markWatched: (tmdbId: number, film?: FilmSnapshot) => void;
  clear: (tmdbId: number) => void; // undo all state for a film
}

const noop = () => {};
const FilmStateContext = createContext<FilmStateContextValue>({
  ready: false,
  available: false,
  cloud: "checking",
  get: () => undefined,
  isHidden: () => false,
  isShortlisted: () => false,
  isWatched: () => false,
  shortlistIds: () => [],
  watchedIds: () => [],
  shortlistFilms: () => [],
  snooze: noop,
  dismiss: noop,
  toggleShortlist: noop,
  markWatched: noop,
  clear: noop,
});

// ---------- Local store ----------
// The browser is the first copy and the cloud is the mirror, not the other way
// round. Before this, one failed request to /api/state hid every state button
// and dropped every tap on the floor; now a tap always lands here, and syncs
// to D1 when the API is reachable (newest write wins, either direction).
const STORAGE_KEY = "cineprompt.filmState.v1";

function readLocal(): Map<number, FilmState> {
  const m = new Map<number, FilmState>();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return m;
    const obj = JSON.parse(raw) as Record<string, FilmState>;
    for (const [k, v] of Object.entries(obj)) {
      const id = Number(k);
      if (Number.isFinite(id) && v && typeof v === "object") m.set(id, v);
    }
  } catch {
    /* private mode / blocked storage: run from memory */
  }
  return m;
}

function writeLocal(m: Map<number, FilmState>): void {
  try {
    const obj: Record<string, FilmState> = {};
    for (const [id, s] of m) obj[String(id)] = s;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
  } catch {
    /* best effort */
  }
}

function isEmpty(s: FilmState): boolean {
  return !s.status && !s.snooze_until && s.notes == null && s.rating == null;
}

function snapshotOf(film: FilmSnapshot | undefined | null): FilmSnapshot | null {
  if (!film || !film.title) return null;
  return {
    title: film.title,
    year: film.year ?? null,
    poster: film.poster ?? null,
    imdb_id: film.imdb_id ?? null,
    directors: film.directors ?? null,
    runtime: film.runtime ?? null,
    reasons: film.reasons ? film.reasons.slice(0, 4) : null,
  };
}

function tomorrowISO(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Revisions are milliseconds end to end. A small value can only be seconds
// (a row from before this precision existed); lift it rather than misorder it.
function asMillis(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n < 1e11 ? n * 1000 : n;
}

/** A D1 row as the API returns it, in local shape. */
function remoteToState(f: any): FilmState {
  return {
    status: f.status ?? null,
    snooze_until: f.snooze_until ?? null,
    notes: f.notes ?? null,
    rating: f.rating ?? null,
    updated_at: asMillis(f.updated_at),
    film: f.title
      ? {
          title: f.title,
          year: f.year ?? null,
          poster: f.poster ?? null,
          imdb_id: f.imdb_id ?? null,
          directors: f.directors ?? null,
          runtime: f.runtime ?? null,
          reasons: f.reasons ?? null,
        }
      : null,
  };
}

type PushResult = { ok: true; stale?: FilmState } | { ok: false };

// The write carries its own timestamp; the server refuses anything older than
// what it holds and hands back the newer row, so an offline phone reconnecting
// cannot clobber a choice made on the TV in the meantime.
async function pushToCloud(id: number, s: FilmState): Promise<PushResult> {
  const body: any = {
    tmdb_id: id,
    status: s.status ?? null,
    snooze_until: s.snooze_until ?? null,
    notes: s.notes ?? null,
    rating: s.rating ?? null,
    updated_at: s.updated_at ?? Date.now(),
  };
  if (s.film) body.film = s.film;
  try {
    const r = await fetch("/api/state", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (r.status === 409) {
      const d = await r.json().catch(() => null);
      // No row back means the server holds a newer *cleared* revision.
      return { ok: true, stale: d?.film ? remoteToState(d.film) : { status: null, updated_at: 0 } };
    }
    return { ok: r.ok };
  } catch {
    return { ok: false };
  }
}

export function FilmStateProvider({ children }: { children: ReactNode }) {
  const [map, setMap] = useState<Map<number, FilmState>>(() => readLocal());
  const [cloud, setCloud] = useState<CloudStatus>("checking");
  const [available, setAvailable] = useState(false);
  const mapRef = useRef(map);
  mapRef.current = map;
  // Each push takes a ticket; only the newest push may set the global status,
  // so an older request finishing late cannot report "synced" over a newer
  // one that failed.
  const pushSeq = useRef(0);

  // Every local change goes through here so the ref, React state and
  // localStorage never disagree (a mutation between render and commit would
  // otherwise read a stale map).
  const commit = useCallback((next: Map<number, FilmState>) => {
    mapRef.current = next;
    setMap(next);
    writeLocal(next);
  }, []);

  // The server said it holds something newer: take it. A cleared revision
  // (nothing left in it) means drop the film here too, snapshot included.
  const adopt = useCallback(
    (id: number, remote: FilmState) => {
      const next = new Map(mapRef.current);
      const mine = next.get(id);
      if (isEmpty(remote)) next.delete(id);
      else next.set(id, { ...remote, film: remote.film ?? mine?.film ?? null });
      commit(next);
    },
    [commit],
  );

  // Reconcile with the cloud once on mount: newest write wins per film, and
  // anything newer locally is pushed up (this is how a tap made while the API
  // was down still reaches D1 on the next visit).
  useEffect(() => {
    let alive = true;
    fetch("/api/state")
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(async (d: { films?: any[] }) => {
        if (!alive) return;
        setAvailable(true);
        const local = new Map(mapRef.current);
        const merged = new Map(local);
        const toPush: number[] = [];
        const cloudIds = new Set<number>();
        for (const f of d.films ?? []) {
          const id = Number(f.tmdb_id);
          if (!Number.isFinite(id)) continue;
          cloudIds.add(id);
          const remote = remoteToState(f);
          const mine = local.get(id);
          if (!mine || (mine.updated_at ?? 0) <= (remote.updated_at ?? 0)) {
            merged.set(id, { ...remote, film: remote.film ?? mine?.film ?? null });
          } else {
            toPush.push(id);
          }
        }
        for (const id of local.keys()) if (!cloudIds.has(id)) toPush.push(id);
        commit(merged);
        // "Synced" only once every local-only choice has actually landed; a
        // failed push leaves the status honest and is retried next visit.
        const ticket = ++pushSeq.current;
        let allOk = true;
        for (const id of toPush) {
          const s = merged.get(id);
          if (!s || isEmpty(s)) continue;
          const res = await pushToCloud(id, s);
          if (!res.ok) allOk = false;
          else if (res.stale) adopt(id, res.stale);
        }
        if (alive && ticket === pushSeq.current) setCloud(allOk ? "synced" : "offline");
      })
      .catch(() => {
        if (alive) {
          setAvailable(false);
          setCloud("offline");
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  // Local write first, always; then mirror to the cloud, best effort. A write
  // that leaves no state (an undo, un-shortlisting) drops the film here,
  // snapshot included, and becomes a tombstone revision in D1.
  const patch = useCallback(
    (tmdbId: number, p: FilmState, film?: FilmSnapshot) => {
      const snap = snapshotOf(film);
      const cur = mapRef.current.get(tmdbId) ?? {};
      // Never write a revision older than one we already hold for this film.
      const rev = Math.max(Date.now(), (cur.updated_at ?? 0) + 1);
      const merged: FilmState = {
        ...cur,
        ...p,
        updated_at: rev,
        film: snap ?? cur.film ?? null,
      };
      if (isEmpty(merged)) merged.film = null;
      const next = new Map(mapRef.current);
      if (isEmpty(merged)) next.delete(tmdbId);
      else next.set(tmdbId, merged);
      commit(next);
      const ticket = ++pushSeq.current;
      void pushToCloud(tmdbId, merged).then((res) => {
        if (ticket === pushSeq.current) setCloud(res.ok ? "synced" : "offline");
        if (res.ok && res.stale) adopt(tmdbId, res.stale);
      });
    },
    [commit, adopt],
  );

  const value = useMemo<FilmStateContextValue>(() => {
    const today = todayISO();
    const get = (id: number) => map.get(id);
    return {
      ready: true,
      available,
      cloud,
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
        [...map.entries()]
          .filter(([, s]) => s.status === "shortlist")
          .sort((a, b) => (b[1].updated_at ?? 0) - (a[1].updated_at ?? 0))
          .map(([id]) => id),
      watchedIds: () =>
        [...map.entries()].filter(([, s]) => s.status === "watched").map(([id]) => id),
      shortlistFilms: () =>
        [...map.entries()]
          .filter(([, s]) => s.status === "shortlist")
          .sort((a, b) => (b[1].updated_at ?? 0) - (a[1].updated_at ?? 0))
          .map(([tmdb_id, s]) => ({ tmdb_id, film: s.film ?? null, updated_at: s.updated_at ?? 0 })),
      snooze: (id, film) => patch(id, { snooze_until: tomorrowISO() }, film),
      dismiss: (id, film) => patch(id, { status: "dismissed", snooze_until: null }, film),
      toggleShortlist: (id, film) =>
        patch(id, { status: map.get(id)?.status === "shortlist" ? null : "shortlist" }, film),
      markWatched: (id, film) => patch(id, { status: "watched", snooze_until: null }, film),
      clear: (id) => patch(id, { status: null, snooze_until: null, notes: null, rating: null }),
    };
  }, [map, cloud, available, patch]);

  return <FilmStateContext.Provider value={value}>{children}</FilmStateContext.Provider>;
}

export function useFilmState(): FilmStateContextValue {
  return useContext(FilmStateContext);
}
