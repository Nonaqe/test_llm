import { defineConfig } from "vite";

// Два бандла: widget.js — IIFE для сниппета <script src> (docs/08 §3, без
// type="module": классический тег работает всюду), widget.esm.js — для
// импорта в SPA-бандлеры. Бюджет ≤ 60 КБ gzip — scripts/check-widget-size.mjs (NFR-5)
export default defineConfig({
  build: {
    lib: {
      entry: "src/sdk.ts",
      name: "ChatWidget",
      formats: ["iife", "es"],
      fileName: (format) => (format === "es" ? "widget.esm.js" : "widget.js"),
    },
    outDir: "dist",
    target: "es2020",
    minify: "esbuild",
  },
});
