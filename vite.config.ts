import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// The TypeScript compiler (used to parse JS/TS in the browser) is a ~3.6 MB lazy-loaded chunk,
// above Workbox's default 2 MB precache limit. Raise the limit so the app also works offline.
const PRECACHE_LIMIT_BYTES = 6 * 1024 * 1024;

/**
 * Content-Security-Policy for the built app. Loaded code is data, but if a dependency were ever
 * compromised, the browser still lets the page talk only to GitHub (loading repositories) and
 * Anthropic (AI, when the reader asks). WebAssembly needs 'wasm-unsafe-eval' for Tree-sitter; React
 * and React Flow set inline styles. Only the build gets it: the dev server needs its own websocket.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:", // Vite inlines small font subsets as data: URLs
  "connect-src 'self' https://api.github.com https://raw.githubusercontent.com https://api.anthropic.com",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join("; ");

const contentSecurityPolicy: Plugin = {
  name: "visualcode-content-security-policy",
  apply: "build",
  transformIndexHtml: () => [{ tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: CONTENT_SECURITY_POLICY }, injectTo: "head-prepend" }],
};

export default defineConfig({
  base: "./",
  plugins: [
    contentSecurityPolicy,
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
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        maximumFileSizeToCacheInBytes: PRECACHE_LIMIT_BYTES,
        // Tree-sitter grammars (~0.2–4.7 MB each, ~21 MB in all) are not precached: each is cached the
        // first time a project in that language is opened, then works offline.
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.endsWith(".wasm"),
            handler: "CacheFirst",
            options: { cacheName: "tree-sitter-grammars", expiration: { maxEntries: 20 } },
          },
        ],
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
