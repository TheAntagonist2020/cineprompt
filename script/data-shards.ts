/**
 * data-shards — split the monolithic pipeline artifact into a small core
 * payload plus lazily-fetched, route-scoped shards.
 *
 * Why: `client/public/data.json` is ~6.5 MB (1.77 MB gzipped) and the client
 * downloaded and JSON-parsed all of it before first paint — including data
 * that only one deep route ever reads, and ~1.2 MB that no client code reads
 * at all. Routes were already code-split; the data was not.
 *
 * The Python pipeline in `datagen/` keeps writing `client/public/data.json`
 * exactly as before — this runs downstream of it, so the data pipeline is
 * untouched and its twice-daily CI job cannot be broken by this split.
 *
 * Layout produced under <outDir>:
 *   core.json                 everything first paint needs, + derived indexes
 *   canon.json                /canon
 *   collections.json          /collections  (whole set: the shuffle pool
 *                             draws across every list)
 *   craft.json                /craft
 *   tags.json                 /tags
 *   search.json               command palette, fetched on first open
 *   directors/<slug>.json     one file per director, for /directors/:name
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

// Keys no client code references anywhere. Verified by grep across
// client/src before removal; they exist only because the pipeline emits them.
// They stay in data.json (the pipeline round-trips it) but never ship.
const DEAD_KEYS = [
  "review_quotes", // 1.06 MB — superseded by per-director quotes
  "diary_ratings", // 109 KB
  "watched_tmdb_set", // 27 KB
] as const;

// Top-level keys pulled out of core into their own route-scoped shard.
const ROUTE_SHARDS: Record<string, string[]> = {
  canon: ["canon"],
  collections: ["collections"],
  craft: ["craft_dimensions"],
  tags: ["tags"],
};

// Handled specially: exploded into per-director files + a core index.
const DIRECTOR_KEYS = ["directors", "director_quotes"];

export interface ShardReport {
  file: string;
  bytes: number;
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "director"
  );
}

// Stable, collision-free slug per director name.
function buildSlugMap(names: string[]): Map<string, string> {
  const used = new Set<string>();
  const out = new Map<string, string>();
  for (const name of [...names].sort()) {
    let slug = slugify(name);
    if (used.has(slug)) {
      // Deterministic suffix — never depends on iteration order.
      slug = `${slug}-${createHash("sha1").update(name).digest("hex").slice(0, 6)}`;
    }
    used.add(slug);
    out.set(name, slug);
  }
  return out;
}

const json = (v: unknown) => JSON.stringify(v);

/**
 * Build the client-facing poster lookup that `getPosterIndex` used to derive
 * at runtime by walking every director's filmography. Precomputing it here is
 * what lets the 1.5 MB `directors` blob leave the critical path: the index is
 * ~163 KB and Today/Tracking only ever needed the lookup, not the source.
 */
function buildPosterIndex(data: any): Record<number, string> {
  const m: Record<number, string> = {};
  const add = (f: any) => {
    if (!f || typeof f.tmdb_id !== "number") return;
    if (f.poster && m[f.tmdb_id] === undefined) m[f.tmdb_id] = f.poster;
  };
  for (const f of data.queue ?? []) add(f);
  for (const f of data.focus_pool_extra ?? []) add(f);
  for (const f of data.background_pool ?? []) add(f);
  for (const picks of Object.values<any>(data.mood_picks ?? {})) (picks ?? []).forEach(add);
  for (const s of data.slates ?? []) {
    (s.focus ?? []).forEach(add);
    (s.background ?? []).forEach(add);
  }
  for (const d of Object.values<any>(data.directors ?? {})) (d.films ?? []).forEach(add);
  for (const t of Object.values<any>(data.director_targets ?? {})) (t.next_up ?? []).forEach(add);
  for (const w of data.themed_weeks ?? []) (w.films ?? []).forEach(add);
  for (const e of data.screenplays?.entries ?? []) add(e);
  return m;
}

/**
 * Compact, deduped catalogue of everything searchable, for the command
 * palette. Tuple-encoded rather than object-per-row: the key names would
 * otherwise be ~60% of the payload at this row count.
 * Row: [tmdb_id, title, year, director, poster, seen]
 */
function buildSearchIndex(data: any, slugs: Map<string, string>) {
  const rows = new Map<number, [number, string, string | number, string, string | null, 0 | 1]>();
  const put = (f: any, director?: string, seen?: boolean) => {
    if (!f || typeof f.tmdb_id !== "number" || !f.title) return;
    const existing = rows.get(f.tmdb_id);
    const dir = director ?? (Array.isArray(f.directors) ? f.directors[0] : "") ?? "";
    const isSeen = seen ?? f.seen ?? false;
    if (existing) {
      // Prefer a row that knows a director / poster / seen-state.
      if (!existing[3] && dir) existing[3] = dir;
      if (!existing[4] && f.poster) existing[4] = f.poster;
      if (isSeen) existing[5] = 1;
      return;
    }
    rows.set(f.tmdb_id, [
      f.tmdb_id,
      f.title,
      f.year ?? "",
      dir,
      f.poster ?? null,
      isSeen ? 1 : 0,
    ]);
  };

  for (const f of data.queue ?? []) put(f);
  for (const f of data.focus_pool_extra ?? []) put(f);
  for (const f of data.background_pool ?? []) put(f);
  for (const picks of Object.values<any>(data.mood_picks ?? {})) (picks ?? []).forEach((f: any) => put(f));
  for (const [name, d] of Object.entries<any>(data.directors ?? {})) {
    for (const f of d.films ?? []) put(f, name);
  }
  for (const films of Object.values<any>(data.collections ?? {})) {
    for (const f of films ?? []) put(f);
  }
  for (const films of Object.values<any>(data.canon ?? {})) {
    for (const f of films ?? []) put(f);
  }
  for (const e of data.screenplays?.entries ?? []) put(e);

  const directors = Object.entries<any>(data.directors ?? {}).map(([name, d]) => [
    name,
    slugs.get(name) ?? slugify(name),
    d.seen ?? 0,
    d.total ?? 0,
  ]);

  const collections = (data.collections_meta ?? []).map((m: any) => [m.key, m.name, m.total ?? 0]);

  return { films: [...rows.values()], directors, collections };
}

export async function generateShards(
  srcPath: string,
  outDir: string,
): Promise<{ core: ShardReport; shards: ShardReport[]; sourceBytes: number }> {
  const raw = await readFile(srcPath, "utf-8");
  const data = JSON.parse(raw);

  await rm(outDir, { recursive: true, force: true });
  await mkdir(path.join(outDir, "directors"), { recursive: true });

  const shards: ShardReport[] = [];
  const write = async (rel: string, value: unknown) => {
    const body = json(value);
    await writeFile(path.join(outDir, rel), body);
    shards.push({ file: rel, bytes: Buffer.byteLength(body) });
  };

  // ---- per-director files + core index -------------------------------
  const directors: Record<string, any> = data.directors ?? {};
  const quotes: Record<string, any> = data.director_quotes ?? {};
  const slugs = buildSlugMap(Object.keys(directors));

  const directorsIndex: Record<string, any> = {};
  for (const [name, d] of Object.entries<any>(directors)) {
    const slug = slugs.get(name)!;
    const films: any[] = d.films ?? [];
    // Representative poster, matching what /directors rendered before.
    const poster =
      films.find((f) => f.seen && f.poster)?.poster ?? films.find((f) => f.poster)?.poster ?? null;
    directorsIndex[name] = {
      slug,
      id: d.id,
      seen: d.seen ?? 0,
      total: d.total ?? 0,
      poster,
    };
    await write(`directors/${slug}.json`, {
      name,
      ...d,
      quotes: quotes[name] ?? [],
    });
  }

  // ---- route shards ---------------------------------------------------
  for (const [shard, keys] of Object.entries(ROUTE_SHARDS)) {
    const payload: Record<string, unknown> = {};
    for (const k of keys) if (data[k] !== undefined) payload[k] = data[k];
    await write(`${shard}.json`, payload);
  }

  // ---- search index ---------------------------------------------------
  await write("search.json", buildSearchIndex(data, slugs));

  // ---- core -----------------------------------------------------------
  const carved = new Set<string>([
    ...DEAD_KEYS,
    ...Object.values(ROUTE_SHARDS).flat(),
    ...DIRECTOR_KEYS,
  ]);
  const core: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (!carved.has(k)) core[k] = v;
  }
  core.directors_index = directorsIndex;
  core.poster_index = buildPosterIndex(data);

  const coreBody = json(core);
  await writeFile(path.join(outDir, "core.json"), coreBody);

  return {
    core: { file: "core.json", bytes: Buffer.byteLength(coreBody) },
    shards,
    sourceBytes: Buffer.byteLength(raw),
  };
}

// CLI: `tsx script/data-shards.ts [src] [outDir]`
if (process.argv[1] && /data-shards\.(ts|js|mjs)$/.test(process.argv[1])) {
  const src = process.argv[2] ?? "client/public/data.json";
  const out = process.argv[3] ?? "client/public/data";
  const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;
  generateShards(src, out)
    .then(({ core, shards, sourceBytes }) => {
      const shardBytes = shards.reduce((n, s) => n + s.bytes, 0);
      console.log(`source      ${kb(sourceBytes)}`);
      console.log(`core        ${kb(core.bytes)}  (${((100 * core.bytes) / sourceBytes).toFixed(1)}% of source)`);
      console.log(`shards      ${kb(shardBytes)} across ${shards.length} files`);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
