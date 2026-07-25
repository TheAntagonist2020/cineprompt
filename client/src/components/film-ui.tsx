import { useEffect, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { ExternalLink, Star, StarHalf, X, Play, Repeat, Waves, Moon, Bookmark, BookmarkCheck, Check, RotateCcw } from "lucide-react";
import { useFilmState } from "@/lib/filmState";
import {
  actionLinks,
  posterUrl,
  backdropUrl,
  formatRuntime,
  languageName,
  tmdbUrl,
  stripHtml,
  type QueueFilm,
  type BackgroundFilm,
  type ActionLink,
  type PairWith,
  type UserReview,
} from "@/lib/data";

// Material-standard easing for tasteful motion.
const EASE = [0.4, 0.0, 0.2, 1] as const;

// ---------- Poster ----------
export function Poster({
  path,
  alt,
  className = "",
  size = "w500",
}: {
  path: string | null | undefined;
  alt: string;
  className?: string;
  size?: string;
}) {
  const url = posterUrl(path, size);
  const [loaded, setLoaded] = useState(false);
  if (!url) {
    return (
      <div
        className={`flex items-center justify-center bg-muted text-muted-foreground/40 ${className}`}
        aria-label={alt}
      >
        <span className="font-serif text-2xl">{alt.charAt(0)}</span>
      </div>
    );
  }
  return (
    <div className={`relative overflow-hidden bg-muted ${className}`}>
      {!loaded && <div className="absolute inset-0 bg-muted animate-pulse" />}
      <motion.img
        src={url}
        alt={alt}
        loading="lazy"
        decoding="async"
        onLoad={() => setLoaded(true)}
        initial={{ opacity: 0 }}
        animate={{ opacity: loaded ? 1 : 0 }}
        transition={{ duration: 0.4, ease: EASE }}
        className="absolute inset-0 h-full w-full object-cover"
      />
    </div>
  );
}

// ---------- Ken Burns backdrop (slow, subtle) ----------
export function KenBurnsBackdrop({
  path,
  size = "w1280",
  className = "",
}: {
  path: string | null | undefined;
  size?: string;
  className?: string;
}) {
  const url = backdropUrl(path, size);
  if (!url) return <div className={`bg-muted ${className}`} />;
  return (
    <div className={`overflow-hidden ${className}`}>
      <motion.img
        src={url}
        alt=""
        animate={{ scale: [1, 1.05, 1], x: [0, -10, 0] }}
        transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
        className="h-full w-full object-cover"
      />
    </div>
  );
}

// ---------- Reusable: diary (your own) rating, supports half stars ----------
export function DiaryStars({
  rating,
  label = "YOUR RATING",
  className = "",
}: {
  rating: number;
  label?: string;
  className?: string;
}) {
  const r = Math.max(0, Math.min(5, rating));
  const full = Math.floor(r);
  const hasHalf = r - full >= 0.25 && r - full < 0.75;
  const fullCount = r - full >= 0.75 ? full + 1 : full;
  return (
    <div
      className={`flex items-center gap-2 ${className}`}
      data-testid="diary-stars"
    >
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary">
        {label}
      </span>
      <span
        className="flex items-center gap-0.5"
        aria-label={`Your rating: ${r} out of 5 stars`}
      >
        {[0, 1, 2, 3, 4].map((i) => {
          if (i < fullCount) {
            return (
              <Star key={i} className="h-3.5 w-3.5 fill-primary text-primary" />
            );
          }
          if (hasHalf && i === full) {
            return (
              <span key={i} className="relative inline-flex">
                <Star className="h-3.5 w-3.5 text-muted-foreground/35" />
                <StarHalf className="h-3.5 w-3.5 fill-primary text-primary absolute inset-0" />
              </span>
            );
          }
          return (
            <Star key={i} className="h-3.5 w-3.5 text-muted-foreground/35" />
          );
        })}
      </span>
      <span className="font-mono text-[11px] text-foreground/70 tabular-nums">
        {r.toFixed(1).replace(/\.0$/, "")}
      </span>
    </div>
  );
}

// ---------- Reusable: user review callout ----------
export function ReviewCallout({
  review,
  className = "",
}: {
  review: UserReview;
  className?: string;
}) {
  const snippet = stripHtml(review.snippet);
  const full = Math.max(0, Math.min(5, Math.round(review.rating)));
  return (
    <div className={className} data-testid="review-callout">
      <div className="flex items-center gap-3 mb-2">
        <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-primary">
          From your review
        </span>
        {review.rating > 0 && (
          <span className="flex items-center gap-0.5" aria-label={`${review.rating} stars`}>
            {[0, 1, 2, 3, 4].map((i) => (
              <Star
                key={i}
                className={`h-3 w-3 ${i < full ? "fill-primary text-primary" : "text-muted-foreground/40"}`}
              />
            ))}
          </span>
        )}
      </div>
      {snippet && (
        <blockquote className="font-serif italic text-[15px] leading-relaxed text-foreground/85 border-l-2 border-primary/40 pl-3">
          {snippet}
        </blockquote>
      )}
      {review.uri && (
        <a
          href={review.uri}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="link-review-letterboxd"
          className="mt-2 inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground hover:text-primary transition-colors"
        >
          View on Letterboxd <ExternalLink className="h-2.5 w-2.5" />
        </a>
      )}
    </div>
  );
}

// ---------- Reusable: pair-with card ----------
export function PairWithCard({ pair }: { pair: PairWith }) {
  return (
    <div data-testid="pair-with">
      <div className="flex items-center gap-3 mb-3">
        <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-primary">
          Pair with
        </span>
        <span className="h-px flex-1 bg-border" />
      </div>
      <a
        href={tmdbUrl(pair.with_tmdb_id, pair.title)}
        target="_blank"
        rel="noopener noreferrer"
        data-testid={`pair-with-${pair.with_tmdb_id}`}
        className="group flex gap-3.5 items-start rounded-sm border border-border/60 bg-card/40 p-3 hover:border-primary/50 transition-colors"
      >
        <Poster
          path={pair.poster}
          alt={pair.title}
          className="w-10 shrink-0 aspect-[2/3] rounded-sm border border-border/60"
        />
        <div className="min-w-0">
          <p className="font-serif text-[15px] leading-tight text-foreground group-hover:text-primary transition-colors">
            {pair.title}
          </p>
          <p className="font-mono text-[10px] text-muted-foreground/70 mt-0.5">
            {pair.year}
            {pair.directors?.length ? ` · ${pair.directors.join(", ")}` : ""}
          </p>
          <p className="font-serif italic text-[13px] leading-snug text-foreground/70 mt-1.5">
            {pair.reason}
          </p>
        </div>
      </a>
    </div>
  );
}

// ---------- Rating bar ----------
export function RatingBar({
  value,
  count,
  className = "",
}: {
  value: number;
  count?: number;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(100, (value / 10) * 100));
  return (
    <div className={`flex items-center gap-2 ${className}`} data-testid="rating-bar">
      <Star className="h-3.5 w-3.5 fill-primary text-primary shrink-0" />
      <span className="font-mono text-sm text-foreground tabular-nums">
        {value ? value.toFixed(1) : "—"}
      </span>
      <div className="h-[3px] flex-1 min-w-[40px] max-w-[120px] bg-muted overflow-hidden rounded-full">
        <div className="h-full bg-primary/80" style={{ width: `${pct}%` }} />
      </div>
      {count != null && count > 0 && (
        <span className="font-mono text-[11px] text-muted-foreground/70">
          {count.toLocaleString()} votes
        </span>
      )}
    </div>
  );
}

// ---------- Action buttons ----------
export function ActionButtons({
  film,
  size = "default",
}: {
  film: { tmdb_id: number; imdb_id?: string | null; title: string };
  size?: "default" | "sm";
}) {
  const links: ActionLink[] = actionLinks(film);
  const pad = size === "sm" ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm";
  return (
    <div className="flex flex-wrap gap-2" data-testid="action-buttons">
      {links.map((l) => {
        const isStremio = l.label === "Stremio";
        return (
          <a
            key={l.label}
            href={l.href}
            {...(l.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            data-testid={`link-${l.label.toLowerCase()}-${film.tmdb_id}`}
            className={`group inline-flex items-center gap-1.5 border ${pad} font-sans font-medium tracking-wide rounded-sm transition-colors duration-200 ${
              isStremio
                ? "border-primary/60 bg-primary/15 text-primary hover:bg-primary/25"
                : "border-border bg-card/60 text-foreground/85 hover:border-primary/50 hover:text-primary"
            }`}
          >
            {isStremio ? (
              <Play className="h-3 w-3 fill-current" />
            ) : (
              <ExternalLink className="h-3 w-3 opacity-60 group-hover:opacity-100" />
            )}
            {l.label}
          </a>
        );
      })}
    </div>
  );
}

// ---------- Stateful actions (Not tonight / Shortlist / Watched) ----------
export function FilmActions({
  film,
  className = "",
}: {
  film: { tmdb_id: number };
  className?: string;
}) {
  const fs = useFilmState();
  if (!fs.available) return null; // no backend (e.g. Express dev) -> hide
  const id = film.tmdb_id;
  const shortlisted = fs.isShortlisted(id);
  const watched = fs.isWatched(id);
  const cleared = !fs.get(id)?.status && !fs.get(id)?.snooze_until;

  const Btn = ({
    onClick,
    active,
    icon,
    label,
    testid,
  }: {
    onClick: () => void;
    active?: boolean;
    icon: ReactNode;
    label: string;
    testid: string;
  }) => (
    <button
      onClick={onClick}
      data-testid={testid}
      className={`inline-flex items-center gap-1.5 border px-3 py-2 font-sans text-sm font-medium tracking-wide rounded-sm transition-colors duration-200 ${
        active
          ? "border-primary/60 bg-primary/15 text-primary"
          : "border-border bg-card/60 text-foreground/85 hover:border-primary/50 hover:text-primary"
      }`}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <div className={`flex flex-wrap gap-2 ${className}`} data-testid={`film-actions-${id}`}>
      <Btn
        testid={`action-snooze-${id}`}
        onClick={() => fs.snooze(id)}
        icon={<Moon className="h-3.5 w-3.5" />}
        label="Not tonight"
      />
      <Btn
        testid={`action-shortlist-${id}`}
        onClick={() => fs.toggleShortlist(id)}
        active={shortlisted}
        icon={shortlisted ? <BookmarkCheck className="h-3.5 w-3.5" /> : <Bookmark className="h-3.5 w-3.5" />}
        label={shortlisted ? "Shortlisted" : "Shortlist"}
      />
      <Btn
        testid={`action-watched-${id}`}
        onClick={() => fs.markWatched(id)}
        active={watched}
        icon={<Check className="h-3.5 w-3.5" />}
        label={watched ? "Watched" : "Mark watched"}
      />
      {!cleared && (
        <Btn
          testid={`action-clear-${id}`}
          onClick={() => fs.clear(id)}
          icon={<RotateCcw className="h-3.5 w-3.5" />}
          label="Undo"
        />
      )}
    </div>
  );
}

// ---------- Reasons / rationale ----------
export function Rationale({
  reasons,
  label = "Why this",
  className = "",
}: {
  reasons: string[];
  label?: string;
  className?: string;
}) {
  if (!reasons || reasons.length === 0) return null;
  return (
    <div className={className} data-testid="rationale">
      <div className="flex items-center gap-3 mb-3">
        <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-primary">
          {label}
        </span>
        <span className="h-px flex-1 bg-border" />
      </div>
      <ul className="space-y-2">
        {reasons.map((r, i) => (
          <li
            key={i}
            className="font-serif italic text-[15px] leading-relaxed text-foreground/85 flex gap-3"
          >
            <span className="text-primary/70 not-italic font-mono text-xs pt-1.5">
              {String(i + 1).padStart(2, "0")}
            </span>
            <span>{r}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------- Genre tags ----------
export function GenreTags({ genres }: { genres: string[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {genres.map((g) => (
        <span
          key={g}
          className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground border border-border px-2.5 py-1 rounded-sm"
        >
          {g}
        </span>
      ))}
    </div>
  );
}

// ---------- Film detail modal ----------
export function FilmDetailModal({
  film,
  onClose,
}: {
  film: QueueFilm | null;
  onClose: () => void;
}) {
  // Close on Escape and lock body scroll while the modal is open.
  useEffect(() => {
    if (!film) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [film, onClose]);
  if (!film) return null;
  const bd = backdropUrl(film.backdrop, "w1280");
  return (
    <div
      className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-black/80 backdrop-blur-sm overflow-y-auto p-0 sm:p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={film.title}
      data-testid="film-modal"
    >
      <div
        className="relative w-full max-w-3xl bg-card border border-border sm:rounded-md overflow-hidden my-0 sm:my-8"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          data-testid="button-close-modal"
          className="absolute right-3 top-3 z-10 h-9 w-9 flex items-center justify-center rounded-full bg-background/70 backdrop-blur text-foreground hover:bg-background"
        >
          <X className="h-4 w-4" />
        </button>
        {bd && (
          <div className="relative h-44 sm:h-56 w-full">
            <KenBurnsBackdrop path={film.backdrop} size="w1280" className="absolute inset-0" />
            <div className="absolute inset-0 bg-gradient-to-t from-card via-card/40 to-transparent" />
          </div>
        )}
        <div className="p-6 sm:p-8 -mt-12 relative">
          <div className="flex gap-5">
            <Poster
              path={film.poster}
              alt={film.title}
              className="w-24 sm:w-28 aspect-[2/3] rounded-sm film-shadow shrink-0"
            />
            <div className="min-w-0 pt-10">
              <h2 className="font-serif text-2xl sm:text-3xl leading-tight text-foreground">
                {film.title}
              </h2>
              <p className="font-mono text-sm text-muted-foreground mt-1">
                {film.year}
                {film.directors?.length ? ` · ${film.directors.join(", ")}` : ""}
                {film.runtime ? ` · ${formatRuntime(film.runtime)}` : ""}
              </p>
              <div className="mt-3">
                <RatingBar value={film.vote_average} count={film.vote_count} />
              </div>
            </div>
          </div>

          {film.genres?.length > 0 && (
            <div className="mt-5">
              <GenreTags genres={film.genres} />
            </div>
          )}

          {film.tagline && (
            <p className="font-serif italic text-primary/90 mt-5 text-lg">
              “{film.tagline}”
            </p>
          )}
          {film.overview && (
            <p className="text-[15px] leading-relaxed text-foreground/80 mt-4 max-w-prose">
              {film.overview}
            </p>
          )}

          {film.reasons?.length > 0 && <Rationale reasons={film.reasons} className="mt-6" />}

          {film.diary_rating != null && (
            <DiaryStars rating={film.diary_rating} className="mt-6" />
          )}

          {film.user_review && (
            <ReviewCallout review={film.user_review} className="mt-4" />
          )}

          <div className="grid sm:grid-cols-2 gap-x-8 gap-y-4 mt-6">
            {film.cast?.length > 0 && (
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground mb-1.5">
                  Cast
                </p>
                <p className="text-sm text-foreground/80 leading-relaxed">
                  {film.cast.join(" · ")}
                </p>
              </div>
            )}
            {film.writers?.length > 0 && (
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground mb-1.5">
                  Written by
                </p>
                <p className="text-sm text-foreground/80 leading-relaxed">
                  {film.writers.join(" · ")}
                </p>
              </div>
            )}
          </div>

          {film.pair_with && (
            <div className="mt-7">
              <PairWithCard pair={film.pair_with} />
            </div>
          )}

          <div className="mt-7 pt-6 border-t border-border space-y-4">
            <FilmActions film={film} />
            <ActionButtons film={film} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- Focus card (home slate FOCUS section) ----------
export function FocusCard({
  film,
  onOpen,
  rationaleLabel,
}: {
  film: QueueFilm;
  onOpen?: () => void;
  rationaleLabel?: string;
}) {
  return (
    <article
      className="flex flex-col border border-border rounded-md bg-card/40 overflow-hidden film-shadow"
      data-testid={`focus-card-${film.tmdb_id}`}
    >
      <button
        onClick={onOpen}
        className="relative block w-full group"
        aria-label={`Open ${film.title}`}
      >
        <Poster
          path={film.poster}
          alt={film.title}
          className="w-full aspect-[2/3] group-hover:brightness-110 transition-all"
        />
        {film.tagline && (
          <div className="pointer-events-none absolute inset-0 flex items-end bg-gradient-to-t from-black/85 via-black/30 to-transparent p-4 opacity-0 group-hover:opacity-100 transition-opacity duration-[350ms] ease-[cubic-bezier(0.4,0,0.2,1)]">
            <p className="font-serif italic text-sm leading-snug text-white/90 line-clamp-3">
              “{film.tagline}”
            </p>
          </div>
        )}
      </button>
      <div className="flex flex-col flex-1 p-5">
        <button onClick={onOpen} className="text-left">
          <h3 className="font-serif text-xl sm:text-2xl leading-tight text-foreground hover:text-primary transition-colors">
            {film.title}
          </h3>
        </button>
        <p className="font-mono text-xs text-muted-foreground mt-1.5">
          {film.year}
          {film.directors?.length ? ` · ${film.directors.join(", ")}` : ""}
        </p>
        <p className="font-mono text-[11px] text-muted-foreground/70 mt-1">
          {formatRuntime(film.runtime)} · {languageName(film.original_language)}
          {film.genres?.length ? ` · ${film.genres.slice(0, 2).join(", ")}` : ""}
        </p>

        <div className="mt-3">
          <RatingBar value={film.vote_average} count={film.vote_count} />
        </div>

        {film.diary_rating != null && (
          <DiaryStars rating={film.diary_rating} className="mt-3" />
        )}

        {film.reasons?.length > 0 && (
          <Rationale reasons={film.reasons} label={rationaleLabel} className="mt-4" />
        )}

        <div className="mt-auto pt-5">
          <ActionButtons film={film} size="sm" />
        </div>
      </div>
    </article>
  );
}

// ---------- Background badge ----------
export function BackgroundBadge({ kind }: { kind: "rewatch" | "new" }) {
  const isRewatch = kind === "rewatch";
  return (
    <span
      className="inline-flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.16em] border border-border/70 text-muted-foreground rounded-sm px-2 py-1"
      data-testid="background-badge"
    >
      {isRewatch ? <Repeat className="h-2.5 w-2.5" /> : <Waves className="h-2.5 w-2.5" />}
      {isRewatch ? "Rewatch" : "Ambient"}
    </span>
  );
}

// ---------- Background card (muted treatment) ----------
export function BackgroundCard({
  film,
  onOpen,
  compact = false,
}: {
  film: BackgroundFilm;
  onOpen?: () => void;
  compact?: boolean;
}) {
  return (
    <article
      className="flex gap-4 border border-border/50 rounded-md bg-card/20 p-3.5 sm:p-4"
      data-testid={`background-card-${film.tmdb_id}`}
    >
      <button
        onClick={onOpen}
        className="shrink-0 group"
        aria-label={`Open ${film.title}`}
      >
        <Poster
          path={film.poster}
          alt={film.title}
          className={`${compact ? "w-16" : "w-20 sm:w-24"} aspect-[2/3] rounded-sm border border-border/60 group-hover:brightness-110 transition-all`}
        />
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <button onClick={onOpen} className="text-left min-w-0">
            <h3 className="font-serif text-lg sm:text-xl leading-tight text-foreground/90 hover:text-primary transition-colors">
              {film.title}
            </h3>
          </button>
          <span className="ml-auto shrink-0">
            <BackgroundBadge kind={film.kind} />
          </span>
        </div>
        <p className="font-mono text-[11px] text-muted-foreground/70 mt-1">
          {film.year}
          {film.directors?.length ? ` · ${film.directors[0]}` : ""}
          {film.runtime ? ` · ${formatRuntime(film.runtime)}` : ""}
        </p>
        {film.kind === "rewatch" && film.letterboxd_rating != null && (
          <p className="font-mono text-[10px] text-muted-foreground/60 mt-1">
            ★ {film.letterboxd_rating.toFixed(1)} · {film.plays || 1} play{(film.plays || 1) > 1 ? "s" : ""}
            {film.last_watched ? ` · seen ${film.last_watched}` : ""}
          </p>
        )}
        {film.diary_rating != null && (
          <DiaryStars rating={film.diary_rating} className="mt-2" />
        )}
        {film.reasons?.length > 0 && (
          <p className="font-serif italic text-[13px] leading-relaxed text-foreground/70 mt-2 line-clamp-2">
            {film.reasons[0]}
          </p>
        )}
        <div className="mt-3">
          <ActionButtons film={film} size="sm" />
        </div>
      </div>
    </article>
  );
}

// ---------- Mini card (week page) ----------
export function MiniCard({
  film,
  onOpen,
  badge,
}: {
  film: QueueFilm | BackgroundFilm;
  onOpen?: () => void;
  badge?: "rewatch" | "new";
}) {
  return (
    <button
      onClick={onOpen}
      data-testid={`mini-card-${film.tmdb_id}`}
      className="group flex gap-3 text-left w-full hover-elevate rounded-sm p-1.5 -m-1.5 transition-colors"
    >
      <Poster
        path={film.poster}
        alt={film.title}
        className="w-12 shrink-0 aspect-[2/3] rounded-sm border border-border/60"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <h4 className="font-serif text-[15px] leading-tight text-foreground group-hover:text-primary transition-colors line-clamp-1">
            {film.title}
          </h4>
          {badge && (
            <span className="ml-auto shrink-0 font-mono text-[8px] uppercase tracking-wider text-muted-foreground/60 border border-border/60 rounded-sm px-1 py-0.5">
              {badge === "rewatch" ? "RE" : "AMB"}
            </span>
          )}
        </div>
        <p className="font-mono text-[10px] text-muted-foreground/70 mt-0.5">
          {film.year}
          {film.directors?.length ? ` · ${film.directors[0]}` : ""}
        </p>
        {film.reasons?.length > 0 && (
          <p className="font-serif italic text-[12px] leading-snug text-foreground/65 mt-1 line-clamp-1">
            {film.reasons[0]}
          </p>
        )}
      </div>
    </button>
  );
}

// hook to manage modal state
export function useFilmModal() {
  const [film, setFilm] = useState<QueueFilm | null>(null);
  return {
    film,
    open: (f: QueueFilm) => setFilm(f),
    close: () => setFilm(null),
  };
}
