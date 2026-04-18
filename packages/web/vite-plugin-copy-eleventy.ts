// [WEB-COPY-ELEVENTY] Copies Eleventy-generated HTML (docs/, blog/) into Vite's dist
// and rewrites /src/styles.css to the hashed asset filename Vite produced.
// Also provides a dev-mode watcher that full-reloads the browser whenever
// Eleventy rewrites any HTML under its output dir.
import { readdir, readFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import type { Plugin } from "vite";

const ENTRY_HTML = new Set(["index.html", "converter.html"]);

const walk = async (dir: string): Promise<string[]> => {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (e) => {
      const full = resolve(dir, e.name);
      return e.isDirectory() ? walk(full) : [full];
    })
  );
  return files.flat();
};

const toPosix = (p: string): string => p.split(sep).join("/");

export const copyEleventyPlugin = (eleventyRoot: string): Plugin => ({
  name: "vite-plugin-copy-eleventy",
  apply: "build",
  async generateBundle(_options, bundle) {
    const cssAsset = Object.keys(bundle).find((k) => k.endsWith(".css"));
    const cssHref = cssAsset !== undefined ? `/${cssAsset}` : "/src/styles.css";

    const all = await walk(eleventyRoot);
    for (const abs of all) {
      const rel = toPosix(relative(eleventyRoot, abs));
      if (!rel.endsWith(".html")) {
        continue;
      }
      if (ENTRY_HTML.has(rel)) {
        continue;
      }
      const raw = await readFile(abs, "utf-8");
      const source = raw.replace(/\/src\/styles\.css/g, cssHref);
      this.emitFile({ type: "asset", fileName: rel, source });
    }
  },
});

// [WEB-ELEVENTY-DEV-RELOAD] Dev-only: force a full-page reload whenever Eleventy
// rewrites an HTML file under its output dir. Vite's HMR does not reload the
// browser on static HTML changes by itself, so edits to layouts/markdown in
// eleventy/ would otherwise appear stuck until manual refresh.
export const eleventyDevReloadPlugin = (eleventyRoot: string): Plugin => ({
  name: "vite-plugin-eleventy-dev-reload",
  apply: "serve",
  configureServer(server) {
    server.watcher.add(`${eleventyRoot}/**/*.html`);
    const trigger = (file: string): void => {
      if (!file.startsWith(eleventyRoot)) {
        return;
      }
      if (!file.endsWith(".html")) {
        return;
      }
      server.ws.send({ type: "full-reload", path: "*" });
    };
    server.watcher.on("add", trigger);
    server.watcher.on("change", trigger);
    server.watcher.on("unlink", trigger);
  },
});
