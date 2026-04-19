// [WEB-COVERAGE-MERGE] Merge vitest + Playwright coverage, then enforce
// coverage-thresholds.json. Either source alone underreports — vitest covers
// pure-logic modules (highlight, debounce, …), Playwright covers UI modules
// exercised in a real browser (splitter, viewport, zoom-controls, converter,
// playground, editor-zoom). The merged total is what the threshold gates on.
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";

interface Pct {
  total: number;
  covered: number;
  pct: number;
}
interface FileSummary {
  statements: Pct;
  branches: Pct;
  functions: Pct;
  lines: Pct;
}
type Summary = Record<string, FileSummary>;
interface Thresholds {
  readonly statements: number;
  readonly branches: number;
  readonly functions: number;
  readonly lines: number;
}

const CWD = process.cwd();
const VITEST_SUMMARY = resolve(CWD, "coverage/vitest/coverage-summary.json");
const PW_SUMMARY = resolve(CWD, "coverage/playwright/coverage-summary.json");
const MERGED_OUT = resolve(CWD, "coverage/merged/coverage-summary.json");
// ratchet-coverage.mjs expects packages/web/coverage/coverage-summary.json.
const RATCHET_OUT = resolve(CWD, "coverage/coverage-summary.json");

const loadSummary = (path: string): Summary => {
  if (!existsSync(path)) {
    return {};
  }
  const raw = JSON.parse(readFileSync(path, "utf8")) as Summary;
  return raw;
};

const mergePct = (a: Pct | undefined, b: Pct | undefined): Pct => {
  const total = (a?.total ?? 0) + (b?.total ?? 0);
  const covered = (a?.covered ?? 0) + (b?.covered ?? 0);
  return { total, covered, pct: total === 0 ? 100 : (covered / total) * 100 };
};

const mergeFile = (a: FileSummary | undefined, b: FileSummary | undefined): FileSummary => ({
  statements: mergePct(a?.statements, b?.statements),
  branches: mergePct(a?.branches, b?.branches),
  functions: mergePct(a?.functions, b?.functions),
  lines: mergePct(a?.lines, b?.lines),
});

// Playwright (monocart) emits absolute paths for its keys; vitest (v8) also
// uses absolute paths. Normalise to repo-relative so matching files from both
// sources fold into a single entry.
const normaliseKey = (key: string): string => {
  if (key === "total") {
    return "total";
  }
  const abs = resolve(key);
  const rel = abs.replace(CWD + "/", "").replace(CWD, "");
  // Only include files under src/ — excludes node_modules, test helpers, etc.
  return rel.startsWith("src/") ? rel : "";
};

const mergeSummaries = (vitest: Summary, pw: Summary): Summary => {
  const out: Summary = {};
  const keys = new Set<string>();
  for (const k of Object.keys(vitest)) {
    const nk = normaliseKey(k);
    if (nk !== "" && nk !== "total") {
      keys.add(nk);
    }
  }
  for (const k of Object.keys(pw)) {
    const nk = normaliseKey(k);
    if (nk !== "" && nk !== "total") {
      keys.add(nk);
    }
  }
  const findIn = (s: Summary, relKey: string): FileSummary | undefined => {
    for (const k of Object.keys(s)) {
      if (normaliseKey(k) === relKey) {
        return s[k];
      }
    }
    return undefined;
  };
  for (const rel of keys) {
    out[rel] = mergeFile(findIn(vitest, rel), findIn(pw, rel));
  }
  // Compute total.
  const sum = (field: keyof FileSummary): Pct => {
    let total = 0;
    let covered = 0;
    for (const rel of keys) {
      const entry = out[rel];
      if (entry === undefined) {
        continue;
      }
      total += entry[field].total;
      covered += entry[field].covered;
    }
    return { total, covered, pct: total === 0 ? 100 : (covered / total) * 100 };
  };
  out["total"] = {
    statements: sum("statements"),
    branches: sum("branches"),
    functions: sum("functions"),
    lines: sum("lines"),
  };
  return out;
};

const loadThresholds = (): Thresholds => {
  const raw = JSON.parse(readFileSync(resolve(CWD, "../../coverage-thresholds.json"), "utf8")) as {
    projects: Record<string, Thresholds>;
  };
  const t = raw.projects["packages/web"];
  if (t === undefined) {
    throw new Error("[MERGE-COV] packages/web missing in coverage-thresholds.json");
  }
  return t;
};

const main = (): void => {
  const vitest = loadSummary(VITEST_SUMMARY);
  const pw = loadSummary(PW_SUMMARY);
  const hasVitest = Object.keys(vitest).length > 0;
  const hasPw = Object.keys(pw).length > 0;
  if (!hasVitest && !hasPw) {
    console.error("[MERGE-COV] No coverage summaries found. Did the tests run?");
    process.exit(2);
  }
  console.log(`[MERGE-COV] vitest entries=${String(Object.keys(vitest).length)} playwright entries=${String(Object.keys(pw).length)}`);
  const merged = mergeSummaries(vitest, pw);
  mkdirSync(dirname(MERGED_OUT), { recursive: true });
  writeFileSync(MERGED_OUT, JSON.stringify(merged, null, 2));
  // Mirror to legacy path so ratchet-coverage.mjs finds it.
  mkdirSync(dirname(RATCHET_OUT), { recursive: true });
  writeFileSync(RATCHET_OUT, JSON.stringify(merged, null, 2));

  const t = loadThresholds();
  const totalEntry = merged["total"];
  if (totalEntry === undefined) {
    throw new Error("[MERGE-COV] merged summary missing total");
  }
  const totals = totalEntry;
  const checks: Array<[keyof Thresholds, number, number]> = [
    ["statements", totals.statements.pct, t.statements],
    ["branches", totals.branches.pct, t.branches],
    ["functions", totals.functions.pct, t.functions],
    ["lines", totals.lines.pct, t.lines],
  ];
  let failed = false;
  console.log("[MERGE-COV] Merged coverage vs threshold:");
  for (const [name, actual, threshold] of checks) {
    const pass = actual >= threshold;
    const mark = pass ? "OK" : "FAIL";
    console.log(`  ${mark}  ${name}: ${actual.toFixed(2)}% (threshold ${String(threshold)}%)`);
    if (!pass) {
      failed = true;
    }
  }
  if (failed) {
    console.error("[MERGE-COV] coverage below threshold — failing");
    process.exit(1);
  }
};

main();
