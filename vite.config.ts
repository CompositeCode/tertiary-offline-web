import { defineConfig } from "vite";

// Vite config tuned for Tauri v2. The frontend also runs standalone in a plain
// browser via `npm run dev` (browser mode degrades gracefully — see src/tauri.ts).
export default defineConfig({
  // Tauri expects a fixed port and no auto-open.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  // Produce relative asset URLs so the built app works when loaded from the
  // Tauri webview (custom protocol) as well as a normal web server.
  base: "./",
  build: {
    target: "es2020",
    outDir: "dist",
    emptyOutDir: true,
  },
});
