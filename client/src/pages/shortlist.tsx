import { buildFilmIndex, filmFromSnapshot, useAppData, type QueueFilm } from "@/lib/data";
import { useFilmState } from "@/lib/filmState";
import { LoadingScreen, PageShell } from "@/components/layout";
import { Poster, FilmDetailModal, useFilmModal } from "@/components/film-ui";
import { Bookmark } from "lucide-react";

export default function Shortlist() {
  const { data, loading } = useAppData();
  const fs = useFilmState();
  const modal = useFilmModal();
  if (loading || !data) return <LoadingScreen />;

  // Full objects where a pool still carries the film; otherwise the snapshot
  // the state store kept, so the list never silently shrinks after a rebuild.
  const idx = buildFilmIndex(data);
  const films = fs
    .shortlistFilms()
    .map(({ tmdb_id, film }) => idx.get(tmdb_id) ?? (film ? filmFromSnapshot(tmdb_id, film) : null))
    .filter((f): f is QueueFilm => !!f);

  return (
    <PageShell
      eyebrow={films.length ? `${films.length} saved for later` : "Saved for later"}
      title="Shortlist"
      intro="Films you've set aside. The first one is what Today calls Tonight. Tap any to open it, play it, or mark it watched."
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
              <Poster
                path={f.poster}
                alt={f.title}
                className="w-full aspect-[2/3] rounded-sm film-shadow transition-transform group-hover:-translate-y-1"
              />
              <p className="font-serif text-sm leading-snug mt-2 text-foreground/85 group-hover:text-primary transition-colors">
                {f.title}
              </p>
              <p className="font-mono text-[11px] text-muted-foreground">
                {f.year}
                {f.directors?.length ? ` · ${f.directors[0]}` : ""}
              </p>
            </button>
          ))}
        </div>
      )}
      <FilmDetailModal film={modal.film} onClose={modal.close} />
    </PageShell>
  );
}
