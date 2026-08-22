import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Menu, Search, Sparkle, X } from "lucide-react";
import { LocationSearch, type Resolved } from "./LocationSearch";
import { cn, exploreHref } from "../lib/utils";

const NAV = [
  { to: "/explore", label: "Explore" },
  { to: "/submit", label: "Submit Story" },
];

export function Header({ className }: { className?: string }) {
  const navigate = useNavigate();
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
    <header
      className={cn(
        "sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur",
        className,
      )}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="grid h-7 w-7 place-items-center rounded-full bg-primary text-primary-foreground">
            <Sparkle className="h-4 w-4" />
          </span>
          <span className="whitespace-nowrap text-[15px]">Good News AI Map</span>
        </Link>

        <div className="flex items-center gap-1 sm:gap-2">
          <nav className="hidden items-center sm:flex">
            {NAV.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div ref={searchRef} className="relative">
            <button
              type="button"
              onClick={() => setSearchOpen((v) => !v)}
              aria-label="Search a place"
              aria-expanded={searchOpen}
              className="grid h-9 w-9 place-items-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              <Search className="h-4 w-4" />
            </button>

            {searchOpen && (
              <div className="absolute right-0 z-40 mt-2 w-[min(20rem,calc(100vw-2rem))] rounded-xl border border-border bg-card p-3 shadow-lg">
                {/* Same component, same geocoding path as every other search. */}
                <LocationSearch onResolved={go} size="md" action="Go" autoFocus />
              </div>
            )}
          </div>

          <Link
            to="/submit"
            className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90 sm:px-4"
          >
            <Sparkle className="h-3.5 w-3.5" />
            <span className="hidden xs:inline">Share Good News</span>
            <span className="xs:hidden">Share</span>
          </Link>

          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            className="grid h-9 w-9 place-items-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground sm:hidden"
          >
            {menuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {menuOpen && (
        <nav className="border-t border-border bg-background px-4 py-2 sm:hidden">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              onClick={() => setMenuOpen(false)}
              className="block rounded-lg px-2 py-2.5 text-sm font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
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
    <footer className="border-t border-border py-10">
      <div className="mx-auto max-w-3xl px-6 text-center text-xs leading-6 text-muted-foreground">
        <p>
          Every story links to its original source. Summaries are AI-generated from
          those sources.
        </p>
        <p className="mt-1">Map data © OpenStreetMap contributors.</p>
      </div>
    </footer>
  );
}
