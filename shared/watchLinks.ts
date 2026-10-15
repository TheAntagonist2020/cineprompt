/** Direct links into a logged-in Stremio or Plex account. No secrets. */

export type WatchType = "movie" | "series";

const IMDB = /^tt\d{5,}$/;

export function isImdbId(value: string | null | undefined): value is string {
  return !!value && IMDB.test(value);
}

/**
 * Opens that exact title in the Stremio app the account is already signed into.
 * Movies: stremio:///detail/movie/{imdbId}
 * Series: stremio:///detail/series/{imdbId}
 */
export function stremioNativeUrl(imdbId: string, type: WatchType = "movie"): string {
  return `stremio:///detail/${type}/${imdbId}`;
}

/**
 * Same title in Stremio Web (hash router).
 * Movies include the Cinemeta video id, which is the imdb id again.
 * Series open the series detail (season list), not a single episode.
 */
export function stremioWebUrl(imdbId: string, type: WatchType = "movie"): string {
  if (type === "series") return `https://web.stremio.com/#/detail/series/${imdbId}`;
  return `https://web.stremio.com/#/detail/movie/${imdbId}/${imdbId}`;
}

/** Opens Plex Web search inside the account that is already signed in. */
export function plexSearchUrl(title: string): string {
  return `https://app.plex.tv/desktop/#!/search?query=${encodeURIComponent(title)}`;
}

/**
 * Opens a specific library item in Plex Web. The browser session supplies
 * the account; the link itself carries no token.
 */
export function plexItemUrl(machineId: string, ratingKey: string): string {
  const key = encodeURIComponent(`/library/metadata/${ratingKey}`);
  return `https://app.plex.tv/desktop/#!/server/${machineId}/details?key=${key}`;
}
