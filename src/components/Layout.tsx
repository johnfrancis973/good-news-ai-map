import { Link } from "react-router-dom";
import { Sparkle } from "lucide-react";
import { cn } from "../lib/utils";

export function Header({ className }: { className?: string }) {
  return (
    <header
      className={cn(
        "sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur",
        className,
      )}
    >
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
        <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Sparkle className="h-4 w-4" />
          </span>
          <span className="text-[15px]">Good News AI Map</span>
        </Link>
        <Link
          to="/explore"
          className="rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
        >
          Explore
        </Link>
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="border-t border-border py-8 text-center text-xs text-muted-foreground">
      <p>
        Every story links to its original source. Summaries are AI-generated from
        those sources.
      </p>
      <p className="mt-1">Map data © OpenStreetMap contributors.</p>
    </footer>
  );
}
