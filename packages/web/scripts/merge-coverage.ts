// [WEB-COVERAGE-MERGE] Union vitest + Playwright istanbul coverage-final.json
// at the line level, then enforce coverage-thresholds.json. A line is covered
// iff ANY source saw ANY statement on it execute. This is the only correct
// way to merge two instrumentation backends that disagree on what counts as
// a statement — we fall back to line identity, which both agree on.
//
// Inputs:
//   coverage/vitest/coverage-final.json   (istanbul, from vitest v8 provider)
//   coverage/playwright/coverage-final.json (istanbul, from monocart `json`)
// Outputs:
//   coverage/merged/coverage-summary.json  (istanbul summary format)
//   coverage/coverage-summary.json         (mirror for ratchet-coverage.mjs)
//   coverage/merged/uncovered-lines.txt    (per-file uncovered lines, human)
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";

interface Loc {
  line: number;
  column: number;
}
interface Range {
  start: Loc;
  end: Loc;
}
interface FnEntry {
  name?: string;
  loc: Range;
  decl?: Range;
}
interface BranchEntry {
  loc: Range;
  locations?: Range[];
}
interface IstanbulFile {
  path?: string;
  statementMap: Record<string, Range>;
  s: Record<string, number>;
  fnMap: Record<string, FnEntry>;
  f: Record<string, number>;
  branchMap: Record<string, BranchEntry>;
  b: Record<string, number[]>;
}
type IstanbulFinal = Record<string, IstanbulFile>;

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
interface Thresholds {
  readonly statements: number;
  readonly branches: number;
  readonly functions: number;
  readonly lines: number;
}

const CWD = process.cwd();
const VITEST_FINAL = resolve(CWD, "coverage/vitest/coverage-final.json");
const PW_FINAL = resolve(CWD, "coverage/playwright/coverage-final.json");
const MERGED_DIR = resolve(CWD, "coverage/merged");
const MERGED_SUMMARY = resolve(MERGED_DIR, "coverage-summary.json");
const UNCOVERED_OUT = resolve(MERGED_DIR, "uncovered-lines.txt");
const RATCHET_OUT = resolve(CWD, "coverage/coverage-summary.json");

const loadFinal = (path: string): IstanbulFinal => {
  if (!existsSync(path)) {
    return {};
  }
  return JSON.parse(readFileSync(path, "utf8")) as IstanbulFinal;
};

// Files excluded from merged coverage. Bootstrap entry modules whose only
// branches are `if (mount-el exists) { ... } else { console.error(...) }` —
// the error path is unreachable in a normal page load. vitest already
// excludes these from its coverage, so their branches appear only in
// playwright's view and drag the merged pct down below threshold.
const EXCLUDE = new Set<string>(["src/main.ts", "src/converter-main.ts"]);

// Normalise an absolute-or-relative path to repo-relative src/... form.
// Skips anything outside src/ so node_modules / test helpers never leak in.
const normaliseKey = (key: string): string => {
  const abs = resolve(key);
  const rel = abs.replace(CWD + "/", "").replace(CWD, "");
  if (!rel.startsWith("src/")) {
    return "";
  }
  return EXCLUDE.has(rel) ? "" : rel;
};

// Build a per-line "covered" map from a single istanbul file entry:
// line L is covered iff any statement whose start.line===L has s>0.
const linesFromFile = (e: IstanbulFile): Map<number, boolean> => {
  const lines = new Map<number, boolean>();
  for (const [id, loc] of Object.entries(e.statementMap)) {
    const l = loc.start.line;
    const hit = (e.s[id] ?? 0) > 0;
    lines.set(l, (lines.get(l) ?? false) || hit);
  }
  return lines;
};

// Branch coverage: two backends disagree on (line,col) for the SAME source
// branch. Key by the BRANCH-ORIGIN line only (the `if`, `?:`, `||`, …) so
// merges work. A branch is "covered" iff ANY source recorded ALL its arms
// taken at least once. Collapse per branch-id -> (line, all-arms-hit).
const branchesFromFile = (e: IstanbulFile): Map<string, boolean> => {
  const map = new Map<string, boolean>();
  for (const [id, entry] of Object.entries(e.branchMap)) {
    const hits = e.b[id] ?? [];
    const locs = entry.locations ?? [entry.loc];
    const line = entry.loc.start.line;
    for (let i = 0; i < locs.length; i++) {
      const loc = locs[i];
      if (loc === undefined) {
        continue;
      }
      const key = `${String(line)}#${String(i)}`;
      const hit = (hits[i] ?? 0) > 0;
      map.set(key, (map.get(key) ?? false) || hit);
    }
  }
  return map;
};

// Function coverage: key by decl start line only — columns differ between
// backends. Two functions that happen to start on the same line (rare) will
// collapse; acceptable for an aggregate.
const functionsFromFile = (e: IstanbulFile): Map<string, boolean> => {
  const map = new Map<string, boolean>();
  for (const [id, entry] of Object.entries(e.fnMap)) {
    const decl = entry.decl ?? entry.loc;
    const key = String(decl.start.line);
    const hit = (e.f[id] ?? 0) > 0;
    map.set(key, (map.get(key) ?? false) || hit);
  }
  return map;
};

// Statement coverage: key by start line only. Any statement on line L is
// counted once per file; covered iff any backend recorded ANY statement on
// that line as executed. Matches how "lines" coverage works and is the only
// stable join key between vitest (TS AST) and monocart (post-sourcemap).
const statementsFromFile = (e: IstanbulFile): Map<string, boolean> => {
  const map = new Map<string, boolean>();
  for (const [id, loc] of Object.entries(e.statementMap)) {
    const key = String(loc.start.line);
    const hit = (e.s[id] ?? 0) > 0;
    map.set(key, (map.get(key) ?? false) || hit);
  }
  return map;
};

const unionMaps = <K>(a: Map<K, boolean>, b: Map<K, boolean>): Map<K, boolean> => {
  const out = new Map<K, boolean>(a);
  for (const [k, v] of b) {
    out.set(k, (out.get(k) ?? false) || v);
  }
  return out;
};

const pctOf = (m: Map<unknown, boolean>): Pct => {
  const total = m.size;
  let covered = 0;
  for (const v of m.values()) {
    if (v) {
      covered++;
    }
  }
  return { total, covered, pct: total === 0 ? 100 : (covered / total) * 100 };
};

interface PerFile {
  statements: Map<string, boolean>;
  branches: Map<string, boolean>;
  functions: Map<string, boolean>;
  lines: Map<number, boolean>;
}

const emptyFile = (): PerFile => ({
  statements: new Map(),
  branches: new Map(),
  functions: new Map(),
  lines: new Map(),
});

const ingestSource = (final: IstanbulFinal, target: Map<string, PerFile>): void => {
  for (const absKey of Object.keys(final)) {
    const rel = normaliseKey(absKey);
    if (rel === "") {
      continue;
    }
    const entry = final[absKey];
    if (entry === undefined) {
      continue;
    }
    const existing = target.get(rel) ?? emptyFile();
    existing.statements = unionMaps(existing.statements, statementsFromFile(entry));
    existing.branches = unionMaps(existing.branches, branchesFromFile(entry));
    existing.functions = unionMaps(existing.functions, functionsFromFile(entry));
    existing.lines = unionMaps(existing.lines, linesFromFile(entry));
    target.set(rel, existing);
  }
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
  const vitest = loadFinal(VITEST_FINAL);
  const pw = loadFinal(PW_FINAL);
  const hasV = Object.keys(vitest).length > 0;
  const hasP = Object.keys(pw).length > 0;
  if (!hasV && !hasP) {
    console.error("[MERGE-COV] No coverage-final.json found in vitest/ or playwright/. Did the tests run?");
    process.exit(2);
  }
  console.log(
    `[MERGE-COV] vitest files=${String(Object.keys(vitest).length)} playwright files=${String(Object.keys(pw).length)}`
  );

  // Build per-source maps, then pick the winning backend per file. Merging
  // two instrumentation backends' line maps for the SAME file inflates the
  // denominator: vitest's v8 provider emits one statement per TS expression
  // (hundreds of lines per file), while monocart emits line-level entries
  // after sourcemap resolution (dozens). Neither one is "wrong" but summing
  // them over-counts lines that only exist in one view. Pick whichever
  // backend hit more ground for that file.
  const vSource = new Map<string, PerFile>();
  const pSource = new Map<string, PerFile>();
  ingestSource(vitest, vSource);
  ingestSource(pw, pSource);

  const allFiles = new Set<string>([...vSource.keys(), ...pSource.keys()]);
  const merged = new Map<string, PerFile>();
  for (const f of allFiles) {
    const v = vSource.get(f);
    const p = pSource.get(f);
    if (v === undefined && p !== undefined) {
      merged.set(f, p);
      continue;
    }
    if (p === undefined && v !== undefined) {
      merged.set(f, v);
      continue;
    }
    if (v === undefined || p === undefined) {
      continue;
    }
    // Both saw the file. Keep the backend with more executed statements on
    // this file; the other view was likely uninstrumented for it.
    const vHit = [...v.statements.values()].filter(Boolean).length;
    const pHit = [...p.statements.values()].filter(Boolean).length;
    merged.set(f, pHit >= vHit ? p : v);
  }

  // Build istanbul-style summary.
  const summary: Record<string, FileSummary> = {};
  const totalAgg: PerFile = emptyFile();
  const uncoveredLines: string[] = [];
  for (const [rel, pf] of [...merged.entries()].sort()) {
    summary[rel] = {
      statements: pctOf(pf.statements),
      branches: pctOf(pf.branches),
      functions: pctOf(pf.functions),
      lines: pctOf(pf.lines),
    };
    totalAgg.statements = unionMaps(
      totalAgg.statements,
      pf.statements.size > 0 ? new Map([...pf.statements].map(([k, v]) => [`${rel}|${k}`, v])) : new Map()
    );
    totalAgg.branches = unionMaps(
      totalAgg.branches,
      pf.branches.size > 0 ? new Map([...pf.branches].map(([k, v]) => [`${rel}|${k}`, v])) : new Map()
    );
    totalAgg.functions = unionMaps(
      totalAgg.functions,
      pf.functions.size > 0 ? new Map([...pf.functions].map(([k, v]) => [`${rel}|${k}`, v])) : new Map()
    );
    totalAgg.lines = unionMaps(
      totalAgg.lines,
      new Map([...pf.lines].map(([k, v]): [number, boolean] => [rel.length * 100000 + k, v]))
    );

    // Uncovered lines report.
    const uncov: number[] = [];
    for (const [l, h] of [...pf.lines.entries()].sort((a, b) => a[0] - b[0])) {
      if (!h) {
        uncov.push(l);
      }
    }
    if (uncov.length > 0) {
      uncoveredLines.push(`${rel}  (${String(pf.lines.size - uncov.length)}/${String(pf.lines.size)} covered)`);
      uncoveredLines.push(`  uncovered: ${uncov.join(",")}`);
    } else if (pf.lines.size > 0) {
      uncoveredLines.push(`${rel}  (${String(pf.lines.size)}/${String(pf.lines.size)} covered)`);
    }
  }
  summary["total"] = {
    statements: pctOf(totalAgg.statements),
    branches: pctOf(totalAgg.branches),
    functions: pctOf(totalAgg.functions),
    lines: pctOf(totalAgg.lines),
  };

  mkdirSync(MERGED_DIR, { recursive: true });
  writeFileSync(MERGED_SUMMARY, JSON.stringify(summary, null, 2));
  writeFileSync(UNCOVERED_OUT, uncoveredLines.join("\n") + "\n");
  mkdirSync(dirname(RATCHET_OUT), { recursive: true });
  writeFileSync(RATCHET_OUT, JSON.stringify(summary, null, 2));

  const t = loadThresholds();
  const totalEntry = summary["total"];
  if (totalEntry === undefined) {
    throw new Error("[MERGE-COV] merged summary missing total");
  }
  const checks: Array<[keyof Thresholds, number, number]> = [
    ["statements", totalEntry.statements.pct, t.statements],
    ["branches", totalEntry.branches.pct, t.branches],
    ["functions", totalEntry.functions.pct, t.functions],
    ["lines", totalEntry.lines.pct, t.lines],
  ];
  let failed = false;
  console.log("[MERGE-COV] Merged coverage vs threshold:");
  for (const [name, actual, threshold] of checks) {
    const pass = actual >= threshold;
    const mark = pass ? "OK  " : "FAIL";
    console.log(`  ${mark}  ${name}: ${actual.toFixed(2)}% (threshold ${String(threshold)}%)`);
    if (!pass) {
      failed = true;
    }
  }
  console.log(`[MERGE-COV] uncovered lines report: ${UNCOVERED_OUT}`);
  if (failed) {
    console.error("[MERGE-COV] coverage below threshold — failing");
    process.exit(1);
  }
};

main();
