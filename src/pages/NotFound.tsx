import { Link } from "react-router-dom";
import { Footer, Header } from "../components/Layout";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="grid flex-1 place-items-center px-6 py-24 text-center">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            That page does not exist.
          </p>
          <Link
            to="/"
            className="mt-6 inline-block rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Go home
          </Link>
        </div>
      </main>
      <Footer />
    </div>
  );
}
