// [WEB-E2E-COVERAGE-FIXTURE] Collects Chromium V8 JS coverage on every page
// then appends it to the MCR cache. MCR's report is generated once at the end
// of the run (see globalTeardown in playwright.config.ts).
import { test as base } from "@playwright/test";
import MCR from "monocart-coverage-reports";
import type { CoverageReportOptions } from "monocart-coverage-reports";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WEB_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const ASSETS_DIR = resolve(WEB_DIR, "dist/assets");

// MCR resolves a sourcemap's relative sources ("../../src/x.ts") against the
// cwd, not the map's own dir, then strips "..": under the repo's src/ tree that
// collapses web's src/x.ts to "x.ts". Re-anchor them to dist/assets so every
// source path is web-package-relative ("src/x.ts").
const anchorSource = (filePath: string, info: Record<string, unknown>) =>
  typeof info["url"] === "string" && info["url"].startsWith("../")
    ? relative(WEB_DIR, resolve(ASSETS_DIR, info["url"]))
    : filePath;

export const coverageOptions: CoverageReportOptions = {
  outputDir: "coverage/playwright",
  reports: [["v8"], ["console-summary"], ["json-summary"], ["lcov"], ["json"]],
  cleanCache: false,
  sourceMap: true,
  sourcePath: anchorSource,
  entryFilter: (entry: { url: string }): boolean => entry.url.includes("/assets/"),
  sourceFilter: (sourcePath: string): boolean => sourcePath.startsWith("src/") && !sourcePath.endsWith(".d.ts"),
  // Disable per-add report emission; only globalTeardown writes the report.
  logging: "error",
};

export const test = base.extend({
  page: async ({ page, browserName }, use) => {
    if (browserName !== "chromium") {
      await use(page);
      return;
    }
    await page.coverage.startJSCoverage({ resetOnNavigation: false });
    await use(page);
    const coverage = await page.coverage.stopJSCoverage();
    // Add without generating — cheaper. MCR keeps the raw json in its cache
    // dir so the global teardown can assemble the final report from ALL specs.
    const mcr = MCR(coverageOptions);
    await mcr.add(coverage);
  },
});

export { expect } from "@playwright/test";
