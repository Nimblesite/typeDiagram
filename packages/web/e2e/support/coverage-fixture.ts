// [WEB-E2E-COVERAGE-FIXTURE] Collects Chromium V8 JS coverage on every page
// then appends it to the MCR cache. MCR's report is generated once at the end
// of the run (see globalTeardown in playwright.config.ts).
import { test as base } from "@playwright/test";
import MCR from "monocart-coverage-reports";
import type { CoverageReportOptions } from "monocart-coverage-reports";

export const coverageOptions: CoverageReportOptions = {
  outputDir: "coverage/playwright",
  reports: [["v8"], ["console-summary"], ["json-summary"], ["lcov"], ["json"]],
  cleanCache: false,
  sourceMap: true,
  entryFilter: (entry: { url: string }): boolean => entry.url.includes("/assets/"),
  sourceFilter: (sourcePath: string): boolean =>
    sourcePath.startsWith("src/") && !sourcePath.endsWith(".d.ts"),
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
