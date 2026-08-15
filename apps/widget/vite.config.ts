import { defineConfig } from "vite";

// Единый ESM-бандл widget.js; бюджет ≤ 60 КБ gzip — scripts/check-widget-size.mjs (NFR-5)
export default defineConfig({
  build: {
    lib: {
      entry: "src/element.ts",
      name: "ChatWidget",
      formats: ["es"],
      fileName: () => "widget.js",
    },
    outDir: "dist",
    target: "es2020",
    minify: "esbuild",
  },
});
