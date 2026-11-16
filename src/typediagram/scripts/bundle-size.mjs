#!/usr/bin/env node
// [CI-BUNDLE-SIZE] Fail if framework-owned code (excluding heavyweight runtime
// engines supplied as package dependencies) exceeds the budget.
// Budget was 50 KB with 6 converters. Dart + Protobuf converters added
// ~8-10 KB each of parser/emitter logic, so the budget was raised to 75 KB.
// Tuple variants, explicit discriminants, and untagged unions pushed the
// minified core slightly higher, and declaration-level target gating added
// parser + emitter filtering overhead, which took the budget to 80 KB.
// Semantic scalars (DateTime/Uuid/Decimal) across all 9 converters plus
// codegen unknown-type validation [MODEL-CODEGEN-UNKNOWN] measure ~81 KB,
// so that budget was 84 KB. The Typeshed AST adapter, function declarations,
// and emitters add ~8 KB; @lezer/python remains an external runtime engine.
import { build } from "esbuild";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const entry = resolve(here, "..", "src", "index.ts");
const BUDGET_KB = 93;

const result = await build({
  entryPoints: [entry],
  bundle: true,
  format: "esm",
  platform: "node",
  external: ["elkjs", "elkjs/*", "@lezer/python", "@lezer/python/*"],
  write: false,
  minify: true,
  metafile: true,
});

const bytes = result.outputFiles.reduce((sum, f) => sum + f.contents.length, 0);
const kb = bytes / 1024;
const rounded = Math.round(kb * 100) / 100;

console.log(`bundle size (excl. elkjs/@lezer): ${rounded} KB`);

kb > BUDGET_KB
  ? (console.error(`OVER BUDGET: ${rounded} KB > ${BUDGET_KB} KB`), process.exit(1))
  : console.log(`within ${BUDGET_KB} KB budget`);
