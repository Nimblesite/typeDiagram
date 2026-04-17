// [WEB-COPY-ELEVENTY] Copies Eleventy-generated HTML (docs/, blog/) into Vite's dist
// and rewrites /src/styles.css to the hashed asset filename Vite produced.
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
