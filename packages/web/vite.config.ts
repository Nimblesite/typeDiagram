import { resolve } from "path";
import { defineConfig } from "vite";

// [WEB-CHUNK-FRAMEWORK] framework is imported dynamically in render-pane.ts,
// so Rollup emits it (plus elkjs) as a lazy chunk — the app shell stays tiny.
// [WEB-GHPAGES-BASE] served from apex custom domain typediagram.dev (see public/CNAME).
// [WEB-ELEVENTY-ROOT] Eleventy renders HTML into .eleventy-out/; Vite uses that as its root
// so it processes the generated index.html / converter.html the same way it did the hand-written
// ones. Docs + blog HTML pass through via the copyEleventy plugin.
import { copyEleventyPlugin, eleventyDevReloadPlugin } from "./vite-plugin-copy-eleventy.js";

const ELEVENTY_OUT = resolve(__dirname, ".eleventy-out");

export default defineConfig({
  root: ELEVENTY_OUT,
  base: "/",
  publicDir: resolve(__dirname, "public"),
  build: {
    outDir: resolve(__dirname, "dist"),
    emptyOutDir: true,
    target: "es2022",
    rollupOptions: {
      input: {
        main: resolve(ELEVENTY_OUT, "index.html"),
        converter: resolve(ELEVENTY_OUT, "converter.html"),
      },
    },
  },
  resolve: {
    alias: {
      "/src": resolve(__dirname, "src"),
    },
  },
  plugins: [copyEleventyPlugin(ELEVENTY_OUT), eleventyDevReloadPlugin(ELEVENTY_OUT)],
});
