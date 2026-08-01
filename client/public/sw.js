/**
 * Cineprompt service worker.
 *
 * The app is fully static — a shell plus JSON shards — so it can work offline
 * outright. Strategy per resource class:
 *
 *   navigations   network-first, fall back to the cached shell. You always get
 *                 fresh HTML online, and the app still opens on a plane.
 *   /assets/*     cache-first. Vite content-hashes these, so a cached copy can
 *                 never be stale — a change ships under a new filename.
 *   /data/*       stale-while-revalidate. Repeat visits render from cache
 *                 immediately while the shard refreshes behind them; the CI
 *                 rebuild lands on the next load instead of blocking this one.
 *   TMDB images   cache-first with a bounded cache — posters are immutable.
 *
 * Bump VERSION to retire every cache from an older release.
 */
const VERSION = "v1";
const SHELL = `cineprompt-shell-${VERSION}`;
const ASSETS = `cineprompt-assets-${VERSION}`;
const DATA = `cineprompt-data-${VERSION}`;
const IMAGES = `cineprompt-img-${VERSION}`;
const CURRENT = new Set([SHELL, ASSETS, DATA, IMAGES]);

// Posters are small but there are thousands; keep the image cache bounded.
const IMAGE_LIMIT = 600;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((c) => c.addAll(["./", "./index.html"]))
      .catch(() => {})
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !CURRENT.has(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/** Evict oldest entries once a cache grows past `limit`. */
async function trim(cacheName, limit) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= limit) return;
  await Promise.all(keys.slice(0, keys.length - limit).map((k) => cache.delete(k)));
}

async function cacheFirst(request, cacheName, limit) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res && res.ok) {
    await cache.put(request, res.clone());
    if (limit) trim(cacheName, limit);
  }
  return res;
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  const network = fetch(request)
    .then((res) => {
      if (res && res.ok) cache.put(request, res.clone());
      return res;
    })
    .catch(() => null);
  // Serve the cached copy immediately; the refresh lands for the next load.
  // The revalidation is best-effort, so a failure is intentionally swallowed.
  if (hit) return hit;
  const res = await network;
  if (res) return res;
  throw new Error("offline and uncached");
}

async function networkFirstShell(request) {
  try {
    const res = await fetch(request);
    if (res && res.ok) {
      const cache = await caches.open(SHELL);
      cache.put("./index.html", res.clone());
    }
    return res;
  } catch {
    const cache = await caches.open(SHELL);
    const hit = (await cache.match("./index.html")) || (await cache.match("./"));
    if (hit) return hit;
    throw new Error("offline with no cached shell");
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // TMDB poster/backdrop CDN.
  if (url.hostname === "image.tmdb.org") {
    event.respondWith(cacheFirst(request, IMAGES, IMAGE_LIMIT));
    return;
  }

  // Everything else we handle is same-origin.
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirstShell(request));
    return;
  }
  if (url.pathname.includes("/assets/")) {
    event.respondWith(cacheFirst(request, ASSETS));
    return;
  }
  if (url.pathname.includes("/data/")) {
    event.respondWith(staleWhileRevalidate(request, DATA));
    return;
  }
  // /api/* and anything else: straight to the network.
});
