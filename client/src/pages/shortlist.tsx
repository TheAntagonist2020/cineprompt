import { useAppData, posterUrl, type AppData, type QueueFilm } from "@/lib/data";
import { useFilmState } from "@/lib/filmState";
import { LoadingScreen, PageShell } from "@/components/layout";
import { Poster, FilmDetailModal, useFilmModal } from "@/components/film-ui";
import { Bookmark } from "lucide-react";

// Index every film we have full data for, by tmdb id (shortlisting happens from
// the modal, which is always opened with a full film object).
function filmIndex(data: AppData): Map<number, QueueFilm> {
  const m = new Map<number, QueueFilm>();
  const add = (arr?: QueueFilm[]) => {
    for (const f of arr ?? []) if (f?.tmdb_id && !m.has(f.tmdb_id)) m.set(f.tmdb_id, f);
  };
  add(data.queue);
  add(data.focus_pool_extra);
  add(data.background_pool as unknown as QueueFilm[]);
  for (const arr of Object.values(data.mood_picks ?? {})) add(arr);
  if (data.todays_pick) add([data.todays_pick]);
  for (const s of data.slates ?? []) {
    add(s.focus);
    add(s.background as unknown as QueueFilm[]);
  }
  return m;
}

export default function Shortlist() {
  const { data, loading } = useAppData();
  const fs = useFilmState();
  const modal = useFilmModal();
  if (loading || !data) return <LoadingScreen />;

  const idx = filmIndex(data);
  const films = fs
    .shortlistIds()
    .map((id) => idx.get(id))
    .filter((f): f is QueueFilm => !!f);

  return (
    <PageShell
      eyebrow="Saved for later"
      title="Shortlist"
      intro="Films you've set aside. Tap any to open it, jump to Stremio, or mark it watched."
    >
      {films.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center" data-testid="shortlist-empty">
          <Bookmark className="h-8 w-8 text-muted-foreground/50 mb-4" />
          <p className="font-serif text-xl text-foreground/80">Nothing shortlisted yet.</p>
          <p className="font-mono text-sm text-muted-foreground mt-2 max-w-sm">
            Open any film and tap <span className="text-primary">Shortlist</span> to save it here.
          </p>
        </div>
      ) : (
        <div
          className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4"
          data-testid="shortlist-grid"
        >
          {films.map((f) => (
            <button
              key={f.tmdb_id}
              onClick={() => modal.open(f)}
              data-testid={`shortlist-film-${f.tmdb_id}`}
              className="group text-left"
            >
              {posterUrl(f.poster) ? (
                <Poster
                  path={f.poster}
                  alt={f.title}
                  className="w-full aspect-[2/3] rounded-sm film-shadow transition-transform group-hover:-translate-y-1"
                />
              ) : (
                <div className="w-full aspect-[2/3] rounded-sm bg-muted" />
              )}
              <p className="font-serif text-sm leading-snug mt-2 text-foreground/85 group-hover:text-primary transition-colors">
                {f.title}
              </p>
              <p className="font-mono text-[11px] text-muted-foreground">{f.year}</p>
            </button>
          ))}
        </div>
      )}
      <FilmDetailModal film={modal.film} onClose={modal.close} />
    </PageShell>
  );
}
