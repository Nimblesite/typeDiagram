#!/usr/bin/env node
// [CI-BUNDLE-SIZE] Fail if the framework bundle (excluding elkjs) exceeds the
// budget. Uses esbuild to tree-shake and measure the output size.
// Budget was 50 KB with 6 converters. Dart + Protobuf converters added
// ~8-10 KB each of parser/emitter logic, so the budget was raised to 75 KB.
import { build } from "esbuild";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const entry = resolve(here, "..", "src", "index.ts");
const BUDGET_KB = 75.5;

const result = await build({
  entryPoints: [entry],
  bundle: true,
  format: "esm",
  platform: "node",
  external: ["elkjs", "elkjs/*"],
  write: false,
  minify: true,
  metafile: true,
});

const bytes = result.outputFiles.reduce((sum, f) => sum + f.contents.length, 0);
const kb = bytes / 1024;
const rounded = Math.round(kb * 100) / 100;

console.log(`bundle size (excl. elkjs): ${rounded} KB`);

kb > BUDGET_KB
  ? (console.error(`OVER BUDGET: ${rounded} KB > ${BUDGET_KB} KB`), process.exit(1))
  : console.log(`within ${BUDGET_KB} KB budget`);
