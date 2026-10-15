import { useEffect, useState } from "react";
import { ExternalLink, Play } from "lucide-react";
import { isImdbId, plexSearchUrl, stremioNativeUrl, stremioWebUrl, type WatchType } from "@shared/watchLinks";
import { usePlex } from "@/lib/plexSession";

export function AccountLinks({
  title,
  year,
  imdbId,
  type = "movie",
  tmdbId,
  size = "sm",
  primaryLabel = "Open in Stremio",
  bare = false,
}: {
  title: string;
  year?: string | number | null;
  imdbId?: string | null;
  type?: WatchType;
  tmdbId?: number;
  size?: "sm" | "default";
  primaryLabel?: string;
  /** Lay the buttons out in the parent flex row. */
  bare?: boolean;
}) {
  const plex = usePlex();
  const [plexHref, setPlexHref] = useState(() => plexSearchUrl(title));
  const [onServer, setOnServer] = useState(false);
  const pad = size === "sm" ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm";
  const id = tmdbId ?? title;

  useEffect(() => {
    let alive = true;
    setPlexHref(plexSearchUrl(title));
    setOnServer(false);
    plex.resolve({ title, year, imdbId, type }).then((hit) => {
      if (!alive) return;
      setPlexHref(hit.href);
      setOnServer(hit.matched);
    });
    return () => {
      alive = false;
    };
  }, [plex, title, year, imdbId, type, plex.connected]);

  const stremio = isImdbId(imdbId) ? stremioNativeUrl(imdbId, type) : null;
  const web = isImdbId(imdbId) ? stremioWebUrl(imdbId, type) : null;

  const item = (
    href: string,
    label: string,
    testid: string,
    primary = false,
  ) => (
    <a
      key={label}
      href={href}
      {...(href.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      data-testid={testid}
      title={label === "Plex" && onServer ? "On your Plex server" : undefined}
      className={`group inline-flex items-center gap-1.5 border ${pad} font-sans font-medium tracking-wide rounded-sm transition-colors duration-200 ${
        primary
          ? "border-primary/60 bg-primary text-primary-foreground hover:bg-primary/90"
          : "border-border bg-card/60 text-foreground/85 hover:border-primary/50 hover:text-primary"
      }`}
    >
      {primary ? <Play className="h-3 w-3 fill-current" /> : <ExternalLink className="h-3 w-3 opacity-60 group-hover:opacity-100" />}
      {label}
    </a>
  );

  return (
    <div className={bare ? "contents" : "flex flex-wrap gap-2"} data-testid={`account-links-${id}`}>
      {stremio && item(stremio, primaryLabel, `link-stremio-${id}`, true)}
      {web && item(web, "Stremio Web", `link-stremio-web-${id}`)}
      {item(plexHref, onServer ? "Plex · on your server" : "Open in Plex", `link-plex-${id}`)}
    </div>
  );
}
