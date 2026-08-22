import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Menu, Plus, Search, Sparkle, X } from "lucide-react";
import { LocationSearch, type Resolved } from "./LocationSearch";
import { cn, exploreHref, lastExploreHref } from "../lib/utils";

/**
 * "Explore" carries the last place with it. A bare /explore renders a map-less
 * page that cannot scroll, which reads as a frozen tab rather than an empty
 * one — see lastExploreHref.
 */
function navItems() {
  return [
    { to: lastExploreHref(), match: "/explore", label: "Explore" },
    { to: "/submit", match: "/submit", label: "Submit a story" },
    { to: "/sponsor", match: "/sponsor", label: "Sponsorship" },
    { to: "/donate", match: "/donate", label: "Donate" },
  ];
}

export function Header({
  className,
  active,
}: {
  className?: string;
  /** Which nav item to mark as the current page. */
  active?: "explore" | "submit" | "support";
}) {
  const navigate = useNavigate();
  // Sponsorship and Donate are two routes behind one page, so the caller
  // cannot say which of them is current. The path can.
  const { pathname } = useLocation();
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!searchRef.current?.contains(e.target as Node)) setSearchOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  function go(place: Resolved) {
    setSearchOpen(false);
    setMenuOpen(false);
    navigate(exploreHref(place));
  }

  return (
    <header className={cn("bg-forest text-forest-foreground", className)}>
      <div className="mx-auto flex h-[68px] max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link to="/" className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
            <Sparkle className="h-4 w-4" />
          </span>
          <span className="display whitespace-nowrap text-xl sm:text-[21px]">
            Good News AI Map
          </span>
        </Link>

        <div className="flex items-center gap-1 sm:gap-4">
          <nav className="hidden items-center gap-5 sm:flex">
            {navItems().map((item) => {
              const isActive =
                (active === "explore" && item.match === "/explore") ||
                (active === "submit" && item.match === "/submit") ||
                (active === "support" && item.match === pathname);
              return (
                <Link
                  key={item.match}
                  to={item.to}
                  className={cn(
                    "text-sm transition",
                    isActive
                      ? "font-semibold text-forest-foreground"
                      : "font-medium text-forest-muted hover:text-forest-foreground",
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div ref={searchRef} className="relative">
            <button
              type="button"
              onClick={() => setSearchOpen((v) => !v)}
              aria-label="Search a place"
              aria-expanded={searchOpen}
              className="grid h-10 w-10 place-items-center rounded-full border border-forest-foreground/15 text-forest-muted transition hover:border-forest-foreground/35 hover:text-forest-foreground"
            >
              <Search className="h-4 w-4" />
            </button>

            {searchOpen && (
              <div className="absolute right-0 z-40 mt-2 w-[min(20rem,calc(100vw-2rem))] rounded-lg border border-border bg-card p-3 text-foreground shadow-raised">
                {/* Same component, same geocoding path as every other search. */}
                <LocationSearch onResolved={go} size="md" action="Go" autoFocus />
              </div>
            )}
          </div>

          <Link
            to="/submit"
            className="inline-flex h-10 items-center gap-2 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground transition hover:brightness-95 sm:px-5"
          >
            <Plus className="h-4 w-4" />
            <span className="hidden xs:inline">Share good news</span>
            <span className="xs:hidden">Share</span>
          </Link>

          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            className="grid h-10 w-10 place-items-center rounded-full text-forest-muted transition hover:text-forest-foreground sm:hidden"
          >
            {menuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {menuOpen && (
        <nav className="border-t border-forest-foreground/10 px-4 py-2 sm:hidden">
          {navItems().map((item) => (
            <Link
              key={item.match}
              to={item.to}
              onClick={() => setMenuOpen(false)}
              className="block rounded-md px-2 py-3 text-sm font-medium text-forest-muted transition hover:text-forest-foreground"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}

export function Footer() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-6 py-8 text-center sm:flex-row sm:text-left">
        <div className="flex items-center gap-2.5">
          <span className="grid h-7 w-7 place-items-center rounded-full bg-forest text-forest-accent">
            <Sparkle className="h-3.5 w-3.5" />
          </span>
          <span className="text-sm font-semibold">Good News AI Map</span>
        </div>
        <div className="flex flex-col gap-1 text-xs leading-5 text-muted-foreground sm:text-right">
          <p>
            Every story links to its original source. Summaries are AI-generated
            from those sources.
          </p>
          <p>Map data © OpenStreetMap contributors.</p>
        </div>
      </div>
    </footer>
  );
}
