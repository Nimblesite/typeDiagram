// [VSCODE-BUILD] Bundle extension (Node) + webview (browser) with esbuild.
// Also copies pdfkit's font-metric (.afm) + ICC files into dist/data/ so the PDF
// export feature works at runtime. pdfkit reads these files from disk via fs.readFileSync.
import { build } from "esbuild";
import { cpSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const production = process.argv.includes("--production");

const here = dirname(fileURLToPath(import.meta.url));
const require_ = createRequire(import.meta.url);

function copyPdfkitFontData() {
  // pdfkit's runtime font loader reads ./data/*.afm relative to the bundled JS file.
  // When we bundle src/extension.ts to dist/extension.js, that resolves to dist/data/.
  const pdfkitPkg = require_.resolve("pdfkit/package.json");
  const pdfkitRoot = dirname(pdfkitPkg);
  const srcData = resolve(pdfkitRoot, "js/data");
  if (!existsSync(srcData)) {
    // fallback for older pdfkit layouts
    const alt = resolve(pdfkitRoot, "data");
    if (!existsSync(alt)) {
      console.warn("[vscode-build] pdfkit data directory not found; PDF export fonts will fail");
      return;
    }
    cpSync(alt, resolve(here, "dist/data"), { recursive: true });
    return;
  }
  mkdirSync(resolve(here, "dist/data"), { recursive: true });
  cpSync(srcData, resolve(here, "dist/data"), { recursive: true });
}

copyPdfkitFontData();

const shared = {
  bundle: true,
  sourcemap: !production,
  minify: production,
  target: "es2022",
  logLevel: "info",
};

// Extension host — runs in Node, vscode is provided at runtime
await build({
  ...shared,
  entryPoints: ["src/extension.ts"],
  outfile: "dist/extension.js",
  format: "cjs",
  platform: "node",
  external: ["vscode"],
});

// Webview script — runs in browser sandboxed iframe
await build({
  ...shared,
  entryPoints: ["src/webview/main.ts"],
  outfile: "dist/webview/main.js",
  format: "iife",
  platform: "browser",
});
