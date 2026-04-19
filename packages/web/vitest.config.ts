// [WEB-VITEST-CONFIG] Vitest runs the pure-logic tests (highlight, debounce,
// parser-adjacent helpers, …). UI-interaction tests (splitter, viewport,
// zoom-controls, editor-zoom, converter, playground) live under e2e/ and run
// in Playwright so they cover both desktop and mobile viewports.
// Coverage threshold enforcement is intentionally moved to
// scripts/merge-coverage.ts, which merges this summary with Playwright's.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "happy-dom",
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      reportsDirectory: "coverage/vitest",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.d.ts", "src/main.ts", "src/converter-main.ts"],
    },
  },
});
