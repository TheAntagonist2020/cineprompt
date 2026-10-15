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
import { plexSearchUrl, type WatchType } from "@shared/watchLinks";

const CLIENT_KEY = "cineprompt.plex.client";
const TOKEN_KEY = "cineprompt.plex.token";

export interface PlexFilmRef {
  title: string;
  year?: string | number | null;
  imdbId?: string | null;
  type?: WatchType;
}

interface PlexContextValue {
  connected: boolean;
  connecting: boolean;
  error: string | null;
  connect: () => void;
  disconnect: () => void;
  resolve: (film: PlexFilmRef) => Promise<{ href: string; matched: boolean }>;
}

const PlexContext = createContext<PlexContextValue | null>(null);

function readKey(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeKey(key: string, value: string | null) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    /* private mode */
  }
}

function clientId(): string {
  const existing = readKey(CLIENT_KEY);
  if (existing) return existing;
  const id = crypto.randomUUID();
  writeKey(CLIENT_KEY, id);
  return id;
}

function filmKey(film: PlexFilmRef): string {
  return `${film.imdbId || ""}|${film.title}|${film.year || ""}|${film.type || "movie"}`;
}

export function PlexProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tokenRef = useRef<string | null>(null);
  const cache = useRef(new Map<string, { href: string; matched: boolean }>());
  const inflight = useRef(new Map<string, Promise<{ href: string; matched: boolean }>>());
  const pollTimer = useRef<number | null>(null);
  const popup = useRef<Window | null>(null);

  useEffect(() => {
    const stored = readKey(TOKEN_KEY);
    tokenRef.current = stored;
    setToken(stored);
    return () => {
      if (pollTimer.current) window.clearInterval(pollTimer.current);
    };
  }, []);

  const disconnect = useCallback(() => {
    tokenRef.current = null;
    setToken(null);
    writeKey(TOKEN_KEY, null);
    cache.current.clear();
    setError(null);
  }, []);

  const resolve = useCallback(async (film: PlexFilmRef) => {
    const fallback = { href: plexSearchUrl(film.title), matched: false };
    const current = tokenRef.current;
    if (!current) return fallback;
    const key = filmKey(film);
    const hit = cache.current.get(key);
    if (hit) return hit;
    const pending = inflight.current.get(key);
    if (pending) return pending;
    const job = fetch("/api/plex/lookup", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${current}`,
      },
      body: JSON.stringify({
        items: [
          {
            title: film.title,
            year: film.year ?? null,
            imdbId: film.imdbId ?? null,
            type: film.type ?? "movie",
          },
        ],
      }),
    })
      .then(async (res) => {
        if (res.status === 401) return fallback;
        if (!res.ok) return fallback;
        const body = (await res.json()) as { results?: { href?: string; matched?: boolean }[] };
        const row = body.results?.[0];
        const resolved = {
          href: row?.href || fallback.href,
          matched: !!row?.matched,
        };
        cache.current.set(key, resolved);
        return resolved;
      })
      .catch(() => fallback)
      .finally(() => {
        inflight.current.delete(key);
      });
    inflight.current.set(key, job);
    return job;
  }, []);

  const connect = useCallback(() => {
    if (connecting) return;
    setConnecting(true);
    setError(null);
    const id = clientId();
    fetch("/api/plex/pin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: id }),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error("Plex sign-in is unavailable from this server.");
        return res.json() as Promise<{ id: number; authUrl: string }>;
      })
      .then((pin) => {
        popup.current = window.open(pin.authUrl, "cineprompt-plex", "width=520,height=720");
        const started = Date.now();
        if (pollTimer.current) window.clearInterval(pollTimer.current);
        pollTimer.current = window.setInterval(() => {
          if (Date.now() - started > 3 * 60 * 1000) {
            if (pollTimer.current) window.clearInterval(pollTimer.current);
            setConnecting(false);
            setError("Plex sign-in timed out. Search links still open your account.");
            return;
          }
          fetch("/api/plex/poll", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ clientId: id, id: pin.id }),
          })
            .then((r) => (r.ok ? r.json() : null))
            .then((body: { claimed?: boolean; authToken?: string | null } | null) => {
              if (!body?.claimed || !body.authToken) return;
              if (pollTimer.current) window.clearInterval(pollTimer.current);
              tokenRef.current = body.authToken;
              setToken(body.authToken);
              writeKey(TOKEN_KEY, body.authToken);
              cache.current.clear();
              setConnecting(false);
              popup.current?.close();
            })
            .catch(() => {
              /* keep polling */
            });
        }, 2000);
      })
      .catch((err: Error) => {
        setConnecting(false);
        setError(err.message || "Could not start Plex sign-in.");
      });
  }, [connecting]);

  const value = useMemo<PlexContextValue>(
    () => ({
      connected: !!token,
      connecting,
      error,
      connect,
      disconnect,
      resolve,
    }),
    [token, connecting, error, connect, disconnect, resolve],
  );

  return <PlexContext.Provider value={value}>{children}</PlexContext.Provider>;
}

export function usePlex(): PlexContextValue {
  const ctx = useContext(PlexContext);
  if (!ctx) {
    return {
      connected: false,
      connecting: false,
      error: null,
      connect: () => {},
      disconnect: () => {},
      resolve: async (film) => ({ href: plexSearchUrl(film.title), matched: false }),
    };
  }
  return ctx;
}
