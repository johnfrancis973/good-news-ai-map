import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    // This project lives on a mapped network drive (X: -> \\ebp2016\Documents).
    // Windows native FS events are not delivered over SMB, which crashes the
    // default watcher, so poll instead. Costs a little CPU; keeps HMR working.
    watch: {
      usePolling: true,
      interval: 400,
    },
  },
});
