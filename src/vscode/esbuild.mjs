// [VSCODE-BUILD] Bundle extension (Node) + webview (browser) with esbuild.
import { build } from "esbuild";

const production = process.argv.includes("--production");

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
