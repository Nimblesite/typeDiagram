#!/usr/bin/env node
// [SWR-VERSION-BUILD-STAMPING] First-class version stamper. Rewrites every version
// carrier from a tag (or bare version) using structured JSON parsing — never sed.
// Release stamps the runner working tree only; nothing is committed or pushed.
// Usage:
//   node scripts/stamp-version.mjs --tag v1.2.3 [--root DIR] [--dry-run]
//   node scripts/stamp-version.mjs --version 1.2.3 [--root DIR] [--dry-run]
// Carriers: packages/*/package.json (version + typediagram-core dependency refs)
// and shipwright.json (product.version + every component expectedVersion).
// package-lock.json is refreshed afterwards via `npm install --package-lock-only`.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(HERE, "..");

const SEMVER = /^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$/;

const PACKAGE_FILES = [
  "packages/typediagram/package.json",
  "packages/cli/package.json",
  "packages/vscode/package.json",
  "packages/web/package.json",
];

const parseCliArgs = (argv) => {
  const opts = { version: null, root: DEFAULT_ROOT, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--tag") {
      opts.version = String(argv[(i += 1)] ?? "").replace(/^v/, "");
    } else if (a === "--version") {
      opts.version = String(argv[(i += 1)] ?? "");
    } else if (a === "--root") {
      opts.root = resolve(String(argv[(i += 1)] ?? ""));
    } else if (a === "--dry-run") {
      opts.dryRun = true;
    } else {
      throw new Error(`unknown argument: ${a}`);
    }
  }
  return opts;
};

const stampPackage = (root, rel, version, dryRun) => {
  const path = resolve(root, rel);
  const pkg = JSON.parse(readFileSync(path, "utf8"));
  pkg.version = version;
  const hasCoreDep = pkg.dependencies !== undefined && pkg.dependencies["typediagram-core"] !== undefined;
  if (hasCoreDep) {
    pkg.dependencies["typediagram-core"] = version;
  }
  console.log(`[stamp] ${rel}: version=${version}${hasCoreDep ? " (+typediagram-core dep)" : ""}`);
  if (!dryRun) {
    writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`);
  }
};

const stampManifest = (root, version, dryRun) => {
  const path = resolve(root, "shipwright.json");
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  manifest.product.version = version;
  for (const component of manifest.components) {
    component.expectedVersion = version;
  }
  console.log(`[stamp] shipwright.json: product.version + ${manifest.components.length} expectedVersion(s)`);
  if (!dryRun) {
    writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
  }
};

const opts = parseCliArgs(process.argv.slice(2));
if (opts.version === null || !SEMVER.test(opts.version)) {
  console.error(`[stamp] FAIL: --tag/--version must be semver MAJOR.MINOR.PATCH[-PRERELEASE], got "${opts.version}"`);
  process.exit(1);
}
console.log(`[stamp] ${opts.dryRun ? "DRY RUN — " : ""}stamping ${opts.version} into ${opts.root}`);
for (const rel of PACKAGE_FILES) {
  stampPackage(opts.root, rel, opts.version, opts.dryRun);
}
stampManifest(opts.root, opts.version, opts.dryRun);
console.log("[stamp] done");
