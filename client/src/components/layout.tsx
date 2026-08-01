import { Link, useLocation } from "wouter";
import { ReactNode, Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import {
  Clapperboard,
  ExternalLink,
  RefreshCw,
  CalendarDays,
  ListVideo,
  Tv,
  Compass,
  Users,
  Activity,
  Award,
  BookOpen,
  CalendarRange,
  Aperture,
  Tag,
  Menu,
  Bookmark,
  Library,
  Search,
  Dices,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useAppData, prefetchShard, type ShardName } from "@/lib/data";
import { useFilmState } from "@/lib/filmState";

// Kept out of the main bundle — the palette and its index only load when the
// user actually reaches for search.
const CommandPalette = lazy(() => import("@/components/command-palette"));

// ---------- Sync Now: trigger the CI rebuild+deploy from inside the app ----------
type SyncPhase = "idle" | "starting" | "running" | "done" | "error";

function SyncControl() {
  const fs = useFilmState();
  const [phase, setPhase] = useState<SyncPhase>("idle");
  const [message, setMessage] = useState("");
  const [runUrl, setRunUrl] = useState<string | null>(null);
  const startedAt = useRef(0);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, []);

  // No backend (Express dev / static preview) -> no sync control.
  if (!fs.available) return null;

  function poll() {
    fetch("/api/sync")
      .then((r) => r.json())
      .then((run: { status?: string; conclusion?: string | null; created_at?: string; html_url?: string; error?: string }) => {
        if (run.error) throw new Error(run.error);
        if (run.html_url) setRunUrl(run.html_url);
        const runStarted = run.created_at ? Date.parse(run.created_at) : 0;
        // The dispatched run takes a few seconds to appear; until a run newer
        // than our click shows up, we're still "starting".
        if (runStarted < startedAt.current - 60_000 || run.status === "none") {
          setPhase("starting");
          timer.current = window.setTimeout(poll, 10_000);
          return;
        }
        if (run.status === "completed") {
          if (run.conclusion === "success") {
            setPhase("done");
            setMessage("Rebuilt — reload for fresh picks");
          } else {
            setPhase("error");
            setMessage(`Run finished: ${run.conclusion ?? "unknown"}`);
          }
          return;
        }
        setPhase("running");
        setMessage("Rebuilding picks…");
        timer.current = window.setTimeout(poll, 30_000);
      })
      .catch((e: Error) => {
        setPhase("error");
        setMessage(e.message || "Sync status unavailable");
      });
  }

  function start() {
    if (phase === "starting" || phase === "running") return;
    setPhase("starting");
    setMessage("Starting sync…");
    setRunUrl(null);
    startedAt.current = Date.now();
    fetch("/api/sync", { method: "POST" })
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.error || `Sync failed (${r.status})`);
        }
        timer.current = window.setTimeout(poll, 8_000);
      })
      .catch((e: Error) => {
        setPhase("error");
        setMessage(e.message);
      });
  }

  const busy = phase === "starting" || phase === "running";
  return (
    <div data-testid="sync-control">
      <button
        onClick={start}
        disabled={busy}
        data-testid="button-sync-now"
        className="inline-flex items-center gap-2 border border-border bg-card/60 rounded-sm px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-foreground/85 hover:border-primary/50 hover:text-primary transition-colors disabled:opacity-70 disabled:hover:border-border disabled:hover:text-foreground/85"
      >
        <RefreshCw className={`h-3 w-3 ${busy ? "animate-spin" : ""}`} />
        {busy ? "Syncing…" : phase === "done" ? "Sync again" : "Sync now"}
      </button>
      {message && (
        <p
          className={`mt-1.5 font-mono text-[9.5px] leading-snug ${
            phase === "error" ? "text-destructive" : "text-muted-foreground/80"
          }`}
          data-testid="sync-status"
        >
          {message}
          {runUrl && (
            <>
              {" "}
              <a
                href={runUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-0.5 text-primary/80 hover:text-primary"
              >
                run <ExternalLink className="h-2 w-2" />
              </a>
            </>
          )}
        </p>
      )}
    </div>
  );
}

interface NavItem {
  href: string;
  label: string;
  icon: typeof Clapperboard;
  match: (p: string) => boolean;
  // Route-scoped data shard to warm on hover/focus, so the page has its data
  // by the time the click lands.
  shard?: ShardName;
}

const NAV: NavItem[] = [
  { href: "/", label: "Today", icon: Clapperboard, match: (p) => p === "/" },
  { href: "/week", label: "Week", icon: CalendarDays, match: (p) => p === "/week" || p.startsWith("/week/") },
  { href: "/queue", label: "Queue", icon: ListVideo, match: (p) => p.startsWith("/queue") },
  { href: "/deepcuts", label: "Deep Cuts", icon: Dices, match: (p) => p.startsWith("/deepcuts") },
  { href: "/shortlist", label: "Shortlist", icon: Bookmark, match: (p) => p.startsWith("/shortlist") },
  { href: "/collections", label: "Collections", icon: Library, match: (p) => p.startsWith("/collections"), shard: "collections" },
  { href: "/background", label: "Background", icon: Tv, match: (p) => p.startsWith("/background") },
  { href: "/blindspots", label: "Blind Spots", icon: Compass, match: (p) => p.startsWith("/blindspots") },
  { href: "/directors", label: "Directors", icon: Users, match: (p) => p.startsWith("/directors") },
  { href: "/canon", label: "Canon", icon: Award, match: (p) => p.startsWith("/canon"), shard: "canon" },
  { href: "/weeks", label: "Themes", icon: CalendarRange, match: (p) => p.startsWith("/weeks") },
  { href: "/screenplays", label: "Screenplays", icon: BookOpen, match: (p) => p.startsWith("/screenplays") },
  { href: "/craft", label: "Craft", icon: Aperture, match: (p) => p.startsWith("/craft"), shard: "craft" },
  { href: "/tags", label: "Tags", icon: Tag, match: (p) => p.startsWith("/tags"), shard: "tags" },
  { href: "/tracking", label: "Tracking", icon: Activity, match: (p) => p.startsWith("/tracking") },
];

// Mobile bottom bar shows these 4; the rest live in the "More" sheet.
const MOBILE_PRIMARY = ["/", "/week", "/queue", "/background"];

function Logo() {
  return (
    <svg
      width="26"
      height="26"
      viewBox="0 0 32 32"
      fill="none"
      aria-label="Cineprompt logo"
      className="shrink-0"
    >
      <circle cx="16" cy="16" r="14.5" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="16" cy="16" r="3.4" fill="currentColor" />
      <circle cx="16" cy="6.6" r="2.1" fill="currentColor" />
      <circle cx="16" cy="25.4" r="2.1" fill="currentColor" />
      <circle cx="6.6" cy="16" r="2.1" fill="currentColor" />
      <circle cx="25.4" cy="16" r="2.1" fill="currentColor" />
      <circle cx="9.4" cy="9.4" r="1.7" fill="currentColor" />
      <circle cx="22.6" cy="22.6" r="1.7" fill="currentColor" />
      <circle cx="22.6" cy="9.4" r="1.7" fill="currentColor" />
      <circle cx="9.4" cy="22.6" r="1.7" fill="currentColor" />
    </svg>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const [loc] = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const { data } = useAppData();
  // "Updated" reflects when the data was last generated (YYYY-MM-DD).
  const updated = data?.generated_at ? data.generated_at.slice(0, 10) : "";

  // Reset scroll on route change (hash routing doesn't do this automatically).
  useEffect(() => {
    window.scrollTo(0, 0);
    setMoreOpen(false);
  }, [loc]);

  const openSearch = useCallback(() => setSearchOpen(true), []);

  // ⌘K / Ctrl-K anywhere, and "/" when not already typing.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = document.activeElement;
      const typing =
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        (el instanceof HTMLElement && el.isContentEditable);
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setSearchOpen((v) => !v);
      } else if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setSearchOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const mobilePrimary = NAV.filter((n) => MOBILE_PRIMARY.includes(n.href));
  const mobileMore = NAV.filter((n) => !MOBILE_PRIMARY.includes(n.href));
  const moreActive = mobileMore.some((n) => n.match(loc));

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Sidebar (desktop) */}
      <aside className="hidden md:flex fixed inset-y-0 left-0 w-60 flex-col border-r border-sidebar-border bg-sidebar z-30">
        <Link href="/" data-testid="link-logo">
          <div className="px-6 pt-7 pb-6 cursor-pointer">
            <div className="flex items-center gap-2.5 text-primary">
              <Logo />
              <span className="font-serif text-xl tracking-tight text-foreground">
                Cineprompt
              </span>
            </div>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground mt-2 ml-0.5">
              for Dalton @ Lunara Film
            </p>
          </div>
        </Link>

        <div className="px-3 pb-1">
          <button
            onClick={openSearch}
            data-testid="button-search"
            className="flex w-full items-center gap-2.5 rounded-sm border border-sidebar-border bg-background/40 px-3 py-2 text-left text-sidebar-foreground/60 transition-colors hover:border-primary/40 hover:text-foreground"
          >
            <Search className="h-3.5 w-3.5" />
            <span className="font-sans text-[13px]">Search…</span>
            <kbd className="ml-auto rounded-sm border border-sidebar-border px-1 py-0.5 font-mono text-[9px]">
              ⌘K
            </kbd>
          </button>
        </div>

        {/* min-h-0 + overflow lets the nav scroll on short viewports instead of
            pushing the footer (sync control) out of the fixed sidebar */}
        <nav className="flex-1 min-h-0 overflow-y-auto px-3 mt-2 space-y-0.5">
          {NAV.map((item) => {
            const active = item.match(loc);
            const Icon = item.icon;
            const warm = item.shard ? () => prefetchShard(item.shard!) : undefined;
            return (
              <Link key={item.href} href={item.href} data-testid={`nav-${item.label.toLowerCase().replace(/\s/g, "-")}`}>
                <div
                  onMouseEnter={warm}
                  onFocus={warm}
                  className={`group flex items-center gap-3 px-3 py-2.5 rounded-sm cursor-pointer transition-colors ${
                    active
                      ? "bg-sidebar-accent text-primary"
                      : "text-sidebar-foreground/70 hover:text-foreground hover-elevate"
                  }`}
                >
                  <Icon className={`h-4 w-4 ${active ? "text-primary" : ""}`} />
                  <span className="font-sans text-sm tracking-wide">{item.label}</span>
                  {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />}
                </div>
              </Link>
            );
          })}
        </nav>

        <div className="px-6 py-5 border-t border-sidebar-border space-y-3">
          <p className="font-mono text-[10px] leading-relaxed text-muted-foreground/70">
            Trakt + Letterboxd + TMDB
            {updated && (
              <>
                <br />
                Updated {updated}
              </>
            )}
          </p>
          <SyncControl />
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="md:hidden sticky top-0 z-30 flex items-center justify-between px-5 h-14 border-b border-border bg-background/90 backdrop-blur">
        <Link href="/" data-testid="link-logo-mobile">
          <div className="flex items-center gap-2 text-primary cursor-pointer">
            <Logo />
            <span className="font-serif text-lg text-foreground">Cineprompt</span>
          </div>
        </Link>
        <button
          onClick={openSearch}
          aria-label="Search the library"
          data-testid="button-search-mobile"
          className="inline-flex items-center gap-1.5 rounded-sm border border-border px-2.5 py-1.5 font-mono text-[9px] uppercase tracking-[0.15em] text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
        >
          <Search className="h-3.5 w-3.5" />
          Search
        </button>
      </header>

      {/* Main */}
      <main className="md:pl-60 pb-24 md:pb-0 min-h-screen">{children}</main>

      {/* Mobile bottom tab bar: 4 primary + More */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 grid grid-cols-5 border-t border-border bg-background/95 backdrop-blur">
        {mobilePrimary.map((item) => {
          const active = item.match(loc);
          const Icon = item.icon;
          return (
            <Link key={item.href} href={item.href} data-testid={`tab-${item.label.toLowerCase().replace(/\s/g, "-")}`}>
              <div
                className={`flex flex-col items-center justify-center gap-1 py-2.5 ${
                  active ? "text-primary" : "text-muted-foreground"
                }`}
              >
                <Icon className="h-[18px] w-[18px]" />
                <span className="font-mono text-[8px] uppercase tracking-wide leading-none">
                  {item.label.split(" ")[0]}
                </span>
              </div>
            </Link>
          );
        })}

        {/* More tab → drawer */}
        <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
          <SheetTrigger asChild>
            <button
              data-testid="tab-more"
              className={`flex flex-col items-center justify-center gap-1 py-2.5 w-full ${
                moreActive ? "text-primary" : "text-muted-foreground"
              }`}
            >
              <Menu className="h-[18px] w-[18px]" />
              <span className="font-mono text-[8px] uppercase tracking-wide leading-none">More</span>
            </button>
          </SheetTrigger>
          <SheetContent side="bottom" className="bg-sidebar border-t border-sidebar-border">
            <SheetHeader className="text-left">
              <SheetTitle className="font-serif text-2xl text-foreground">More</SheetTitle>
            </SheetHeader>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {mobileMore.map((item) => {
                const active = item.match(loc);
                const Icon = item.icon;
                return (
                  <Link key={item.href} href={item.href} data-testid={`more-${item.label.toLowerCase().replace(/\s/g, "-")}`}>
                    <div
                      className={`flex items-center gap-3 px-4 py-3 rounded-sm cursor-pointer transition-colors ${
                        active
                          ? "bg-sidebar-accent text-primary"
                          : "text-sidebar-foreground/80 hover-elevate"
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                      <span className="font-sans text-sm tracking-wide">{item.label}</span>
                    </div>
                  </Link>
                );
              })}
            </div>
            <div className="mt-2 pb-4 pt-3 border-t border-sidebar-border">
              <SyncControl />
            </div>
          </SheetContent>
        </Sheet>
      </nav>

      {searchOpen && (
        <Suspense fallback={null}>
          <CommandPalette onClose={() => setSearchOpen(false)} />
        </Suspense>
      )}
    </div>
  );
}

export function PageShell({
  eyebrow,
  title,
  children,
  intro,
}: {
  eyebrow?: string;
  title: string;
  intro?: string;
  children: ReactNode;
}) {
  return (
    <div className="px-5 sm:px-8 lg:px-14 py-8 sm:py-12 max-w-[1180px] mx-auto">
      <header className="mb-8 sm:mb-12">
        {eyebrow && (
          <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-primary mb-3">
            {eyebrow}
          </p>
        )}
        <h1 className="font-serif text-4xl sm:text-5xl tracking-tight text-foreground">
          {title}
        </h1>
        {intro && (
          <p className="text-muted-foreground mt-3 max-w-xl leading-relaxed">{intro}</p>
        )}
      </header>
      {children}
    </div>
  );
}

export function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4 text-primary">
        <div className="h-8 w-8 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
          Loading reels…
        </p>
      </div>
    </div>
  );
}
