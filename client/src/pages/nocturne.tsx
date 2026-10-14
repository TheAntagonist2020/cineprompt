import { useEffect, useMemo, useState } from "react";
import { Moon, Play, Subtitles, SunMedium } from "lucide-react";
import { Poster } from "@/components/film-ui";
import { LoadingScreen } from "@/components/layout";
import { formatRuntime, useAppData } from "@/lib/data";
import {
  buildMarathon,
  collectPool,
  craftStudy,
  formalistLens,
  lockFilm,
  octoberPool,
  plexSearch,
  readImmersion,
  stremioNative,
  stremioWeb,
  writeImmersion,
  type CraftStudy,
  type Energy,
  type MarathonPlan,
  type NocturneFilm,
  type OctoberWindow,
} from "@/lib/nocturne";

type Panel = "now" | "marathon" | "notebook";

async function readSSE(res: Response): Promise<Array<{ event: string; data: { text?: string; message?: string } }>> {
  if (!res.body) return [];
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events: Array<{ event: string; data: { text?: string; message?: string } }> = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() || "";
    for (const chunk of chunks) {
      let event = "message";
      let data = "";
      for (const line of chunk.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      if (!data) continue;
      try {
        events.push({ event, data: JSON.parse(data) });
      } catch {
        /* ignore a partial frame */
      }
    }
  }
  return events;
}

function Launchers({ film }: { film: NocturneFilm }) {
  const links = [
    film.imdbId
      ? { href: stremioNative(film.imdbId), label: "Stremio", testid: "nocturne-stremio" }
      : null,
    film.imdbId
      ? { href: stremioWeb(film.imdbId), label: "Stremio Web", testid: "nocturne-stremio-web" }
      : null,
    { href: plexSearch(film.title), label: "Plex", testid: "nocturne-plex" },
  ].filter(Boolean) as Array<{ href: string; label: string; testid: string }>;

  return (
    <div className="flex flex-wrap gap-2">
      {links.map((link) => (
        <a
          key={link.testid}
          href={link.href}
          target={link.href.startsWith("http") ? "_blank" : undefined}
          rel="noopener noreferrer"
          data-testid={link.testid}
          className="inline-flex items-center gap-2 rounded-sm bg-primary px-4 py-2 font-sans text-sm font-semibold text-primary-foreground hover:bg-primary/90"
        >
          <Play className="h-3.5 w-3.5 fill-current" />
          {link.label}
        </a>
      ))}
    </div>
  );
}

function FilmFacts({ film }: { film: NocturneFilm }) {
  const bits = [
    film.year,
    film.directors.slice(0, 2).join(", "),
    film.runtime ? formatRuntime(film.runtime) : null,
    film.imdbId,
  ].filter(Boolean);
  return <p className="font-mono text-xs text-muted-foreground">{bits.join(" · ")}</p>;
}

export default function Nocturne() {
  const { data, loading } = useAppData();
  const [panel, setPanel] = useState<Panel>("now");
  const [subtitlesOff, setSubtitlesOff] = useState(readImmersion);
  const [windowMode, setWindowMode] = useState<OctoberWindow>("night");
  const [dread, setDread] = useState(7);
  const [energy, setEnergy] = useState<Energy>("medium");
  const [salt, setSalt] = useState(0);
  const [prompt, setPrompt] = useState("Sun-up to 2AM October horror marathon with pacing modulations");
  const [plan, setPlan] = useState<MarathonPlan | null>(null);
  const [building, setBuilding] = useState(false);
  const [unveiled, setUnveiled] = useState<Record<number, boolean>>({});
  const [notes, setNotes] = useState("");
  const [study, setStudy] = useState<CraftStudy | null>(null);
  const [expanding, setExpanding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");

  useEffect(() => {
    const onImmersion = (event: Event) => {
      const on = Boolean((event as CustomEvent<{ on?: boolean }>).detail?.on);
      setSubtitlesOff(on);
    };
    window.addEventListener("nocturne-immersion", onImmersion);
    return () => window.removeEventListener("nocturne-immersion", onImmersion);
  }, []);

  const pool = useMemo(() => collectPool(data), [data]);
  const candidates = useMemo(() => octoberPool(pool, subtitlesOff), [pool, subtitlesOff]);
  const film = useMemo(
    () => lockFilm(candidates, dread, energy, windowMode, salt),
    [candidates, dread, energy, windowMode, salt],
  );

  if (loading || !data) return <LoadingScreen />;

  function toggleImmersion() {
    const next = !subtitlesOff;
    setSubtitlesOff(next);
    writeImmersion(next);
    setSalt(0);
  }

  async function build() {
    setBuilding(true);
    setUnveiled({});
    const local: MarathonPlan = { slots: buildMarathon(pool, prompt, subtitlesOff), source: "fallback" };
    try {
      const res = await fetch("/api/nocturne", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "marathon",
          prompt,
          subtitlesOffOnly: subtitlesOff,
          pool: candidates.slice(0, 40).map(slim),
        }),
      });
      const body = await res.json().catch(() => null);
      if (res.ok && body?.slots?.length) {
        setPlan({ slots: hydrateSlots(body.slots, pool, local.slots), source: body.source === "claude" ? "claude" : "fallback" });
      } else {
        setPlan(local);
      }
    } catch {
      setPlan(local);
    } finally {
      setBuilding(false);
    }
  }

  async function expand() {
    if (!film) return;
    setExpanding(true);
    const local = craftStudy(film, notes);
    try {
      const res = await fetch("/api/nocturne", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "critic",
          prompt: notes,
          notes,
          film: slim(film),
          subtitlesOffOnly: subtitlesOff,
        }),
      });
      const body = await res.json().catch(() => null);
      if (res.ok && body?.camera && body?.sound && body?.pacing && body?.letterboxd) {
        setStudy({
          camera: body.camera,
          sound: body.sound,
          pacing: body.pacing,
          letterboxd: body.letterboxd,
          source: body.source === "claude" ? "claude" : "fallback",
        });
      } else {
        setStudy(local);
      }
    } catch {
      setStudy(local);
    } finally {
      setExpanding(false);
    }
  }

  async function saveToLog() {
    if (!film) return;
    setSaving(true);
    setSaveMessage("");
    const current = study ?? craftStudy(film, notes);
    if (!study) setStudy(current);
    const today = new Date().toISOString().slice(0, 10);
    const entry = {
      title: film.title,
      year: film.year,
      tmdb_id: film.tmdbId,
      notes,
      tags: ["nocturne"],
      watched_on: today,
      rewatch: film.fiveStar,
      status: "draft" as const,
    };
    let review = current.letterboxd;
    try {
      const draft = await fetch("/api/log/draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entry: { ...entry, notes: notes || current.letterboxd }, length: "paragraph" }),
      });
      const draftType = draft.headers.get("content-type") || "";
      if (draft.ok && draft.body && draftType.includes("text/event-stream")) {
        let text = "";
        for (const frame of await readSSE(draft)) {
          if (frame.event === "delta" && frame.data.text) text += frame.data.text;
        }
        if (text.trim()) review = text.trim();
      }
      const saved = await fetch("/api/log", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...entry, review }),
      });
      const savedType = saved.headers.get("content-type") || "";
      const savedBody = savedType.includes("application/json") ? await saved.json().catch(() => null) : null;
      if (!saved.ok || !savedBody?.entry?.id) {
        throw new Error("Cineprompt /log is not available from this dev server. The Letterboxd draft is still on this page.");
      }
      setSaveMessage("Saved to Cineprompt /log.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not reach /log. The Letterboxd draft is still on this page.";
      setSaveMessage(message);
    } finally {
      setSaving(false);
    }
  }

  const lens = film ? formalistLens(film, windowMode, dread) : "";

  return (
    <div className="px-5 sm:px-8 lg:px-14 py-8 sm:py-10 max-w-[980px] mx-auto" data-testid="nocturne-page">
      <header className="mb-6">
        <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-primary mb-3">October concierge</p>
        <h1 className="font-serif text-4xl sm:text-5xl tracking-tight">Nocturne</h1>
        <p className="text-muted-foreground mt-3 max-w-xl leading-relaxed">
          One film, locked. No poster grid. Put something on, build a modulated day, or write the craft note while it is still warm.
        </p>
      </header>

      <div className="flex flex-wrap gap-2 mb-6">
        {(
          [
            ["now", "Put something on"],
            ["marathon", "Marathon"],
            ["notebook", "Craft notebook"],
          ] as Array<[Panel, string]>
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setPanel(id)}
            data-testid={`nocturne-panel-${id}`}
            className={`rounded-sm border px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] ${
              panel === id ? "border-primary/50 bg-primary/15 text-primary" : "border-border text-muted-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {panel === "now" && (
        <section className="space-y-5">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={toggleImmersion}
              data-testid="nocturne-subtitles"
              className={`inline-flex items-center gap-2 rounded-sm border px-3 py-2 font-mono text-[11px] uppercase tracking-[0.14em] ${
                subtitlesOff ? "border-primary/50 bg-primary/15 text-primary" : "border-border text-muted-foreground"
              }`}
            >
              <Subtitles className="h-3.5 w-3.5" />
              {subtitlesOff ? "Subtitles off" : "Subtitles on"}
            </button>
            <button
              onClick={() => setWindowMode("day")}
              data-testid="nocturne-window-day"
              className={`inline-flex items-center gap-2 rounded-sm border px-3 py-2 font-mono text-[11px] uppercase tracking-[0.14em] ${
                windowMode === "day" ? "border-primary/50 bg-primary/15 text-primary" : "border-border text-muted-foreground"
              }`}
            >
              <SunMedium className="h-3.5 w-3.5" />
              Before Sundown
            </button>
            <button
              onClick={() => setWindowMode("night")}
              data-testid="nocturne-window-night"
              className={`inline-flex items-center gap-2 rounded-sm border px-3 py-2 font-mono text-[11px] uppercase tracking-[0.14em] ${
                windowMode === "night" ? "border-primary/50 bg-primary/15 text-primary" : "border-border text-muted-foreground"
              }`}
            >
              <Moon className="h-3.5 w-3.5" />
              Dead of Night
            </button>
          </div>

          <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
            <label className="block">
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                Depravity / dread · {dread}
              </span>
              <input
                type="range"
                min={1}
                max={10}
                value={dread}
                onChange={(event) => setDread(Number(event.target.value))}
                data-testid="nocturne-dread"
                className="mt-2 w-full accent-primary"
              />
            </label>
            <div className="flex gap-2">
              {(["low", "medium", "high"] as Energy[]).map((level) => (
                <button
                  key={level}
                  onClick={() => setEnergy(level)}
                  data-testid={`nocturne-energy-${level}`}
                  className={`rounded-sm border px-3 py-2 font-mono text-[11px] uppercase tracking-[0.14em] ${
                    energy === level ? "border-primary/50 bg-primary/15 text-primary" : "border-border text-muted-foreground"
                  }`}
                >
                  {level}
                </button>
              ))}
            </div>
          </div>

          {film ? (
            <article
              className={`grid gap-6 rounded-md border p-5 sm:p-6 sm:grid-cols-[180px_1fr] ${
                windowMode === "night" ? "border-primary/40 bg-card" : "border-border bg-card/70"
              }`}
              data-testid="nocturne-lock"
            >
              <Poster path={film.poster} alt={film.title} className="aspect-[2/3] w-full rounded-sm" />
              <div className="min-w-0 flex flex-col gap-3">
                <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-primary">
                  {windowMode === "night" ? "Dead of Night · OLED hypnosis" : "Before Sundown · daylight depravity"}
                </p>
                <h2 className="font-serif text-3xl sm:text-4xl leading-tight" data-testid="nocturne-film-title">
                  {film.title}
                </h2>
                <FilmFacts film={film} />
                <p className="font-serif italic text-[15px] leading-snug text-foreground/85" data-testid="nocturne-lens">
                  {lens}
                </p>
                <Launchers film={film} />
                <button
                  onClick={() => setSalt((value) => value + 1)}
                  data-testid="nocturne-relock"
                  className="self-start font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground hover:text-primary"
                >
                  Lock another
                </button>
              </div>
            </article>
          ) : (
            <p className="font-serif italic text-muted-foreground">Nothing in the pool survives this filter.</p>
          )}
        </section>
      )}

      {panel === "marathon" && (
        <section className="space-y-4">
          <label className="block">
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              Day-long request
            </span>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              rows={3}
              data-testid="nocturne-marathon-prompt"
              className="mt-2 w-full rounded-sm border border-border bg-card/40 px-3 py-3 text-sm leading-relaxed focus:outline-none focus:border-primary/60"
            />
          </label>
          <button
            onClick={build}
            disabled={building}
            data-testid="nocturne-marathon-build"
            className="rounded-sm bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            {building ? "Building the arc…" : "Build the arc"}
          </button>
          {plan && (
            <ol className="space-y-3" data-testid="nocturne-arc">
              {plan.slots.map((slot, index) => {
                const hidden = slot.mystery && !unveiled[index];
                return (
                  <li key={`${slot.film.imdbId ?? slot.film.title}-${index}`} className="rounded-md border border-border p-4">
                    <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-primary mb-2">
                      {slot.mystery ? "Mystery 5★ rewatch" : `Slot ${index + 1}`}
                      {plan.source === "fallback" ? " · on-device" : ""}
                    </p>
                    {hidden ? (
                      <button
                        onClick={() => setUnveiled((current) => ({ ...current, [index]: true }))}
                        data-testid={`nocturne-unveil-${index}`}
                        className="rounded-sm border border-primary/40 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-primary"
                      >
                        Unveil surprise rewatch
                      </button>
                    ) : (
                      <div className="space-y-2">
                        <h3 className="font-serif text-2xl">{slot.film.title}</h3>
                        <FilmFacts film={slot.film} />
                        <p className="text-sm leading-relaxed text-foreground/85">{slot.modulation}</p>
                        {slot.mystery && (
                          <p className="font-serif italic text-sm text-primary/90" data-testid={`nocturne-fresh-${index}`}>
                            {slot.freshEyes}
                          </p>
                        )}
                        <Launchers film={slot.film} />
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      )}

      {panel === "notebook" && film && (
        <section className="space-y-4">
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
            Notes on {film.title}
          </p>
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={5}
            placeholder="Blocking, a lens, a cut, a sound. Raw is fine."
            data-testid="nocturne-notes"
            className="w-full rounded-sm border border-border bg-card/40 px-3 py-3 text-sm leading-relaxed focus:outline-none focus:border-primary/60"
          />
          <div className="flex flex-wrap gap-2">
            <button
              onClick={expand}
              disabled={expanding}
              data-testid="nocturne-expand"
              className="rounded-sm border border-border px-4 py-2.5 text-sm disabled:opacity-60"
            >
              {expanding ? "Expanding…" : "Expand craft study"}
            </button>
            <button
              onClick={saveToLog}
              disabled={saving}
              data-testid="nocturne-save-log"
              className="rounded-sm bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save to Cineprompt /log"}
            </button>
          </div>
          {study && (
            <div className="space-y-3" data-testid="nocturne-study">
              {([
                ["Camera & blocking", study.camera],
                ["Sound & score", study.sound],
                ["Pacing", study.pacing],
              ] as Array<[string, string]>).map(([label, text]) => (
                <div key={label}>
                  <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-primary">{label}</p>
                  <p className="mt-1 text-sm leading-relaxed">{text}</p>
                </div>
              ))}
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Letterboxd draft</p>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed" data-testid="nocturne-letterboxd">
                  {study.letterboxd}
                </p>
              </div>
            </div>
          )}
          {saveMessage && (
            <p className="font-mono text-xs text-muted-foreground" data-testid="nocturne-save-status">
              {saveMessage}
            </p>
          )}
        </section>
      )}
    </div>
  );
}

function slim(film: NocturneFilm) {
  return {
    tmdbId: film.tmdbId,
    title: film.title,
    year: film.year,
    runtime: film.runtime,
    directors: film.directors,
    imdbId: film.imdbId,
    language: film.language,
    genres: film.genres,
    rating: film.rating,
    atmospheric: film.atmospheric,
    fiveStar: film.fiveStar,
    poster: film.poster,
  };
}

function hydrateSlots(
  incoming: Array<{ film?: Partial<NocturneFilm>; modulation?: string; mystery?: boolean; freshEyes?: string }>,
  pool: NocturneFilm[],
  fallback: MarathonPlan["slots"],
): MarathonPlan["slots"] {
  return incoming.slice(0, 4).map((slot, index) => {
    const hint = slot.film;
    const match =
      pool.find((film) => hint?.imdbId && film.imdbId === hint.imdbId) ||
      pool.find((film) => hint?.title && film.title === hint.title) ||
      fallback[index]?.film;
    if (!match) return fallback[index];
    const mystery = Boolean(slot.mystery);
    return {
      film: match,
      modulation: slot.modulation || fallback[index]?.modulation || "",
      mystery,
      freshEyes: mystery ? slot.freshEyes || fallback[index]?.freshEyes || "" : "",
    };
  }).filter(Boolean);
}
