#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgPath = resolve(here, "..", "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));

const BANNED = ["jsdom", "dagre", "dagre-d3", "d3", "d3-selection"];

const deps = {
  ...(pkg.dependencies ?? {}),
  ...(pkg.devDependencies ?? {}),
  ...(pkg.peerDependencies ?? {}),
  ...(pkg.optionalDependencies ?? {}),
};

const found = BANNED.filter((b) => Object.prototype.hasOwnProperty.call(deps, b));

if (found.length > 0) {
  console.error(`banned dependencies present in package.json: ${found.join(", ")}`);
  process.exit(1);
}

console.log("banned-deps check ok");
