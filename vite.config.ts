import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// The TypeScript compiler (used to parse JS/TS in the browser) is a ~3.6 MB lazy-loaded chunk,
// above Workbox's default 2 MB precache limit. Raise the limit so the app also works offline.
const PRECACHE_LIMIT_BYTES = 6 * 1024 * 1024;

export default defineConfig({
  base: "./",
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg"],
      manifest: {
        name: "VisualCode — visual code review",
        short_name: "VisualCode",
        description: "Explore a codebase as a system map and review changes on the map.",
        theme_color: "#0f172a",
        background_color: "#0f172a",
        display: "standalone",
        start_url: "./",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png}"],
        maximumFileSizeToCacheInBytes: PRECACHE_LIMIT_BYTES,
      },
    }),
  ],
  build: {
    chunkSizeWarningLimit: 4096, // the TypeScript compiler chunk is expected to be large
  },
  test: {
    environment: "node",
  },
});
