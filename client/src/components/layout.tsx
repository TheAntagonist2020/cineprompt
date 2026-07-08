import { Link, useLocation } from "wouter";
import { ReactNode, useEffect, useState } from "react";
import {
  Clapperboard,
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
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useAppData } from "@/lib/data";

interface NavItem {
  href: string;
  label: string;
  icon: typeof Clapperboard;
  match: (p: string) => boolean;
}

const NAV: NavItem[] = [
  { href: "/", label: "Today", icon: Clapperboard, match: (p) => p === "/" },
  { href: "/week", label: "Week", icon: CalendarDays, match: (p) => p === "/week" || p.startsWith("/week/") },
  { href: "/queue", label: "Queue", icon: ListVideo, match: (p) => p.startsWith("/queue") },
  { href: "/shortlist", label: "Shortlist", icon: Bookmark, match: (p) => p.startsWith("/shortlist") },
  { href: "/collections", label: "Collections", icon: Library, match: (p) => p.startsWith("/collections") },
  { href: "/background", label: "Background", icon: Tv, match: (p) => p.startsWith("/background") },
  { href: "/blindspots", label: "Blind Spots", icon: Compass, match: (p) => p.startsWith("/blindspots") },
  { href: "/directors", label: "Directors", icon: Users, match: (p) => p.startsWith("/directors") },
  { href: "/canon", label: "Canon", icon: Award, match: (p) => p.startsWith("/canon") },
  { href: "/weeks", label: "Themes", icon: CalendarRange, match: (p) => p.startsWith("/weeks") },
  { href: "/screenplays", label: "Screenplays", icon: BookOpen, match: (p) => p.startsWith("/screenplays") },
  { href: "/craft", label: "Craft", icon: Aperture, match: (p) => p.startsWith("/craft") },
  { href: "/tags", label: "Tags", icon: Tag, match: (p) => p.startsWith("/tags") },
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
  const { data } = useAppData();
  // "Updated" reflects when data.json was last generated (YYYY-MM-DD).
  const updated = data?.generated_at ? data.generated_at.slice(0, 10) : "";

  // Reset scroll on route change (hash routing doesn't do this automatically).
  useEffect(() => {
    window.scrollTo(0, 0);
    setMoreOpen(false);
  }, [loc]);

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

        <nav className="flex-1 px-3 mt-2 space-y-0.5">
          {NAV.map((item) => {
            const active = item.match(loc);
            const Icon = item.icon;
            return (
              <Link key={item.href} href={item.href} data-testid={`nav-${item.label.toLowerCase().replace(/\s/g, "-")}`}>
                <div
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

        <div className="px-6 py-5 border-t border-sidebar-border">
          <p className="font-mono text-[10px] leading-relaxed text-muted-foreground/70">
            Trakt + Letterboxd + TMDB
            {updated && (
              <>
                <br />
                Updated {updated}
              </>
            )}
          </p>
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
        <span className="font-mono text-[9px] uppercase tracking-[0.15em] text-muted-foreground">
          Lunara Film
        </span>
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
            <div className="mt-4 grid grid-cols-2 gap-2 pb-4">
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
          </SheetContent>
        </Sheet>
      </nav>
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
