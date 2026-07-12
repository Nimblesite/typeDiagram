// [WEB-VITEST-CONFIG] Vitest runs the pure-logic tests (highlight, debounce,
// parser-adjacent helpers, …). UI-interaction tests (splitter, viewport,
// zoom-controls, editor-zoom, converter, playground) live under e2e/ and run
// in Playwright so they cover both desktop and mobile viewports.
// Coverage threshold enforcement is intentionally moved to
// scripts/merge-coverage.ts, which merges this summary with Playwright's —
// so no `project` (thresholds) key is passed here.
import { createVitestConfig } from "../../scripts/vitest-config-base";

export default createVitestConfig({
  configDir: __dirname,
  environment: "happy-dom",
  extraReporters: ["json"],
  reportsDirectory: "coverage/vitest",
  exclude: ["src/main.ts", "src/converter-main.ts"],
});
