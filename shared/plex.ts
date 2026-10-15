/**
 * Plex PIN connect + library lookup. The caller holds the token (the browser,
 * in localStorage). Nothing here writes a token to disk.
 */
import { plexItemUrl, plexSearchUrl, type WatchType } from "./watchLinks";

const PRODUCT = "Cineprompt";

export interface PlexQuery {
  title: string;
  year?: string | number | null;
  imdbId?: string | null;
  type?: WatchType;
}

export interface PlexHit {
  href: string;
  matched: boolean;
}

interface PlexConnection {
  uri?: string;
  local?: boolean;
  relay?: boolean;
  protocol?: string;
}

interface PlexResource {
  name?: string;
  provides?: string;
  clientIdentifier?: string;
  accessToken?: string;
  connections?: PlexConnection[];
}

interface PlexMeta {
  ratingKey?: string | number;
  title?: string;
  originalTitle?: string;
  year?: number;
  type?: string;
  guid?: string;
  Guid?: { id?: string }[];
}

function headers(clientId: string, token?: string): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "application/json",
    "X-Plex-Product": PRODUCT,
    "X-Plex-Version": "1.0.0",
    "X-Plex-Client-Identifier": clientId,
    "X-Plex-Platform": "Web",
    "X-Plex-Device": "Browser",
  };
  if (token) h["X-Plex-Token"] = token;
  return h;
}

export function authUrl(clientId: string, code: string): string {
  const params = new URLSearchParams({
    clientID: clientId,
    code,
    "context[device][product]": PRODUCT,
  });
  return `https://app.plex.tv/auth#?${params.toString()}`;
}

export async function createPin(clientId: string): Promise<{ id: number; code: string; authUrl: string }> {
  const res = await fetch("https://plex.tv/api/v2/pins?strong=true", {
    method: "POST",
    headers: headers(clientId),
  });
  if (!res.ok) throw new Error(`plex pin ${res.status}`);
  const body = (await res.json()) as { id?: number; code?: string };
  if (!body.id || !body.code) throw new Error("plex pin missing id");
  return { id: body.id, code: body.code, authUrl: authUrl(clientId, body.code) };
}

export async function pollPin(clientId: string, id: number): Promise<string | null> {
  const res = await fetch(`https://plex.tv/api/v2/pins/${id}`, {
    headers: headers(clientId),
  });
  if (!res.ok) throw new Error(`plex pin poll ${res.status}`);
  const body = (await res.json()) as { authToken?: string | null };
  return body.authToken || null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validClientId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

function guids(item: PlexMeta): string[] {
  const out: string[] = [];
  if (item.guid) out.push(item.guid);
  for (const g of item.Guid ?? []) if (g?.id) out.push(g.id);
  return out.map((g) => g.toLowerCase());
}

function metaList(payload: unknown): PlexMeta[] {
  const root = payload as {
    MediaContainer?: { Hub?: { Metadata?: PlexMeta[]; Directory?: PlexMeta[] }[]; Metadata?: PlexMeta[] };
  };
  const out: PlexMeta[] = [];
  const container = root?.MediaContainer;
  if (!container) return out;
  for (const hub of container.Hub ?? []) {
    out.push(...(hub.Metadata ?? []), ...(hub.Directory ?? []));
  }
  out.push(...(container.Metadata ?? []));
  return out;
}

function sameTitle(item: PlexMeta, title: string): boolean {
  const want = title.trim().toLowerCase();
  const names = [item.title, item.originalTitle].filter(Boolean).map((n) => n!.trim().toLowerCase());
  return names.includes(want);
}

function typeOk(item: PlexMeta, type: WatchType): boolean {
  if (!item.type) return true;
  if (type === "series") return item.type === "show";
  return item.type === "movie";
}

export function matchMeta(items: PlexMeta[], query: PlexQuery): PlexMeta | null {
  const type = query.type ?? "movie";
  const imdb = (query.imdbId || "").toLowerCase();
  const year = query.year ? String(query.year) : "";
  if (imdb) {
    const byId = items.find((item) => typeOk(item, type) && guids(item).some((g) => g.includes(imdb)));
    if (byId?.ratingKey) return byId;
  }
  return (
    items.find((item) => {
      if (!item.ratingKey || !typeOk(item, type) || !sameTitle(item, query.title)) return false;
      if (year && item.year && String(item.year) !== year) return false;
      return true;
    }) ?? null
  );
}

interface ServerTarget {
  machineId: string;
  token: string;
  uris: string[];
}

const resourceCache = new Map<string, { at: number; servers: ServerTarget[] }>();

function tokenKey(token: string): string {
  let h = 2166136261;
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

async function serversFor(token: string): Promise<ServerTarget[]> {
  const key = tokenKey(token);
  const cached = resourceCache.get(key);
  if (cached && Date.now() - cached.at < 5 * 60 * 1000) return cached.servers;

  const res = await fetch("https://plex.tv/api/v2/resources?includeHttps=1&includeRelays=0", {
    headers: headers("cineprompt", token),
  });
  if (!res.ok) throw new Error(`plex resources ${res.status}`);
  const resources = (await res.json()) as PlexResource[];
  const servers: ServerTarget[] = [];
  for (const resource of resources) {
    if (!resource.provides?.split(",").includes("server")) continue;
    if (!resource.clientIdentifier) continue;
    const connections = [...(resource.connections ?? [])].sort((a, b) => {
      const score = (c: PlexConnection) => (c.local ? 1 : 0) + (c.relay ? 2 : 0);
      return score(a) - score(b);
    });
    const uris = connections.map((c) => c.uri).filter((u): u is string => !!u);
    if (!uris.length) continue;
    servers.push({
      machineId: resource.clientIdentifier,
      token: resource.accessToken || token,
      uris,
    });
  }
  resourceCache.set(key, { at: Date.now(), servers });
  return servers;
}

async function searchServer(server: ServerTarget, title: string): Promise<PlexMeta[]> {
  for (const uri of server.uris.slice(0, 2)) {
    try {
      const url = `${uri.replace(/\/$/, "")}/hubs/search?query=${encodeURIComponent(title)}&limit=8`;
      const res = await fetch(url, {
        headers: {
          Accept: "application/json",
          "X-Plex-Token": server.token,
          "X-Plex-Product": PRODUCT,
        },
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) continue;
      return metaList(await res.json());
    } catch {
      /* next connection */
    }
  }
  return [];
}

export async function lookupTitle(token: string, query: PlexQuery): Promise<PlexHit> {
  const fallback = plexSearchUrl(query.title);
  if (!query.title?.trim()) return { href: fallback, matched: false };
  try {
    const servers = await serversFor(token);
    for (const server of servers) {
      const items = await searchServer(server, query.title);
      const hit = matchMeta(items, query);
      if (hit?.ratingKey) {
        return {
          href: plexItemUrl(server.machineId, String(hit.ratingKey)),
          matched: true,
        };
      }
    }
  } catch {
    return { href: fallback, matched: false };
  }
  return { href: fallback, matched: false };
}

export interface HandlerResult {
  status: number;
  body: Record<string, unknown>;
}

export async function handleCreatePin(body: { clientId?: unknown }): Promise<HandlerResult> {
  if (!validClientId(body?.clientId)) {
    return { status: 400, body: { error: "clientId required" } };
  }
  try {
    const pin = await createPin(body.clientId);
    return { status: 200, body: { id: pin.id, code: pin.code, authUrl: pin.authUrl } };
  } catch {
    return { status: 502, body: { error: "Plex did not issue a PIN" } };
  }
}

export async function handlePollPin(body: { clientId?: unknown; id?: unknown }): Promise<HandlerResult> {
  const id = Number(body?.id);
  if (!validClientId(body?.clientId) || !Number.isFinite(id)) {
    return { status: 400, body: { error: "clientId and id required" } };
  }
  try {
    const authToken = await pollPin(body.clientId, id);
    return { status: 200, body: { claimed: !!authToken, authToken } };
  } catch {
    return { status: 502, body: { error: "Plex PIN check failed" } };
  }
}

export async function handleLookup(
  token: string,
  body: { items?: PlexQuery[] },
): Promise<HandlerResult> {
  if (!token) return { status: 401, body: { error: "not connected" } };
  const items = Array.isArray(body?.items) ? body.items.slice(0, 12) : [];
  const results = [];
  for (const item of items) {
    if (!item?.title) continue;
    const hit = await lookupTitle(token, item);
    results.push({
      title: item.title,
      year: item.year ?? null,
      imdbId: item.imdbId ?? null,
      href: hit.href,
      matched: hit.matched,
    });
  }
  return { status: 200, body: { results } };
}
