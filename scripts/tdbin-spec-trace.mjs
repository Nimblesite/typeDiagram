// Trace every normative [TDBIN-*] spec ID to implementing code and tests.
// The specs mandate that grep '[TDBIN-' links spec -> code -> tests; this
// script enforces it. Exit 1 when any normative ID lacks either reference.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const specFiles = ["docs/specs/tdbin-wire-format.md", "docs/specs/tdbin-rust-api.md", "docs/specs/tdbin-columnar.md"];
// Future/removed IDs name roadmap documents, not shipped behavior.
const roadmap = /^TDBIN-(FUTURE|RS-LOG)/;

const ids = new Set(specFiles.flatMap((file) => readFileSync(file, "utf8").match(/\[TDBIN-[A-Z0-9-]+\]/g) ?? []));

const grepPaths = (id, paths) => {
  try {
    return execFileSync("grep", ["-rl", "--fixed-strings", id, ...paths], { encoding: "utf8" })
      .trim()
      .split("\n")
      .filter(Boolean);
  } catch {
    return [];
  }
};

const codePaths = ["crates/tdbin/src", "packages/typediagram/src"];
const testPaths = ["crates/tdbin/tests", "crates/tdbin/benches", "packages/typediagram/test"];

const bareIds = [...ids].map((id) => id.slice(1, -1));
const isHeading = (bare) => bareIds.some((other) => other.startsWith(`${bare}-`));
const missing = [];
for (const id of [...ids].sort()) {
  const bare = id.slice(1, -1);
  const exempt = roadmap.test(bare) || isHeading(bare);
  const testsOnly = /^TDBIN-(TEST|BENCH)-/.test(bare);
  const inCode = testsOnly || grepPaths(id, codePaths).length > 0;
  const inTests = grepPaths(id, testPaths).length > 0;
  if (!exempt && (!inCode || !inTests)) {
    missing.push({ id, code: inCode, tests: inTests });
  }
}

if (missing.length > 0) {
  console.log("IDs missing code or test references:");
  for (const row of missing) {
    console.log(`  ${row.id}  code=${row.code ? "yes" : "NO"}  tests=${row.tests ? "yes" : "NO"}`);
  }
  process.exit(1);
}
console.log(`traceability OK: ${ids.size} spec IDs all reference code and tests`);
