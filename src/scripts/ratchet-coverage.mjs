#!/usr/bin/env node
// Ratchets coverage-thresholds.json UP based on measured coverage.
// For each package and metric: new_threshold = max(existing, floor(measured - 1)).
// Never lowers. Reads each package's coverage/coverage-summary.json produced by vitest.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const THRESHOLDS_FILE = resolve(REPO_ROOT, "coverage-thresholds.json");

const METRICS = {
  statements: "statements",
  branches: "branches",
  functions: "functions",
  lines: "lines",
};

const thresholds = JSON.parse(readFileSync(THRESHOLDS_FILE, "utf8"));
const packages = Object.keys(thresholds.projects);

let anyChanged = false;

for (const pkg of packages) {
  const summaryPath = resolve(REPO_ROOT, pkg, "coverage", "coverage-summary.json");
  if (!existsSync(summaryPath)) {
    console.log(`[ratchet] skip ${pkg}: no coverage-summary.json`);
    continue;
  }
  const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
  const totals = summary.total;
  if (!totals) {
    console.log(`[ratchet] skip ${pkg}: summary.total missing`);
    continue;
  }

  const current = thresholds.projects[pkg];
  const updates = {};

  for (const [thresholdKey, summaryKey] of Object.entries(METRICS)) {
    const measured = totals[summaryKey]?.pct;
    if (typeof measured !== "number") continue;
    const candidate = measured - 1;
    const existing = current[thresholdKey] ?? 0;
    if (candidate > existing) {
      updates[thresholdKey] = candidate;
    }
  }

  if (Object.keys(updates).length > 0) {
    for (const [k, v] of Object.entries(updates)) {
      console.log(`[ratchet] ${pkg}: ${k} ${current[k]} → ${v}`);
      current[k] = v;
    }
    anyChanged = true;
  } else {
    console.log(`[ratchet] ${pkg}: no bump (measured within 1% of threshold)`);
  }
}

if (anyChanged) {
  writeFileSync(THRESHOLDS_FILE, JSON.stringify(thresholds, null, 2) + "\n");
  console.log("[ratchet] coverage-thresholds.json updated");
} else {
  console.log("[ratchet] no changes");
}
