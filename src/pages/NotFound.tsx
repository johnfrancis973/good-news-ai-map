import { Link } from "react-router-dom";
import { Compass } from "lucide-react";
import { Footer, Header } from "../components/Layout";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="grid flex-1 place-items-center px-6 py-24 text-center">
        <div className="flex flex-col items-center gap-4">
          <span className="grid h-14 w-14 place-items-center rounded-full bg-accent text-accent-foreground">
            <Compass className="h-6 w-6" strokeWidth={1.6} />
          </span>
          <h1 className="display text-[28px] leading-[1.1]">Page not found</h1>
          <p className="max-w-xs text-[13px] leading-[1.65] text-muted-foreground">
            That page does not exist.
          </p>
          <Link
            to="/"
            className="inline-flex h-11 items-center rounded-full bg-forest px-5 text-sm font-semibold text-forest-foreground transition hover:brightness-110"
          >
            Go home
          </Link>
        </div>
      </main>
      <Footer />
    </div>
  );
}
