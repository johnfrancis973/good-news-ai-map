import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import Home from "./pages/Home";
import Explore from "./pages/Explore";
import StoryDetail from "./pages/StoryDetail";
import Submit from "./pages/Submit";
import Support from "./pages/Support";
import NotFound from "./pages/NotFound";
import { WelcomeQuote } from "./components/WelcomeQuote";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      {/* BASE_URL is "/" locally and "/<repo>/" on GitHub Pages. */}
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/explore" element={<Explore />} />
          <Route path="/story/:id" element={<StoryDetail />} />
          <Route path="/submit" element={<Submit />} />
          {/* One screen, two intents. The route decides which one opens. */}
          {/* The keys are load-bearing: without them React Router reuses one
              Support instance across both routes and the intent never changes. */}
          <Route path="/sponsor" element={<Support key="sponsor" intent="sponsor" />} />
          <Route path="/donate" element={<Support key="donate" intent="donate" />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
        {/* Outside Routes: one line per visit, not one per navigation. */}
        <WelcomeQuote />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
