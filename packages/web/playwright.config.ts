// [WEB-PLAYWRIGHT-CONFIG] E2E tests run in both desktop and mobile viewports
// so layout-sensitive behaviour (splitter orientation, responsive CSS) is
// covered. Each spec in e2e/ is executed once per project. Coverage is
// captured via CDP in a shared test fixture (e2e/support/coverage-fixture.ts)
// and merged with vitest's coverage in scripts/merge-coverage.ts before the
// threshold check.
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testIgnore: ["**/support/**", "**/harness.ts"],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 15_000,
  expect: { timeout: 5_000 },
  reporter: [["list"]],
  globalTeardown: "./e2e/support/global-teardown.ts",
  use: {
    baseURL: "http://localhost:4173",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1400, height: 900 } },
    },
    {
      // Chromium with mobile emulation — same browser as desktop so PointerEvent
      // behaviour is consistent; only viewport + hasTouch + isMobile differ.
      // Viewport width 420 matches the converter responsive breakpoint.
      name: "mobile",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 420, height: 900 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 2,
      },
    },
  ],
  // webServer expects `npm run build` to have been run first. The `pretest`
  // hook on the package already runs eleventy; `test:e2e` runs `npm run build`
  // before Playwright starts (see package.json). Avoid rebuilding here so
  // iterating on specs only costs the preview startup (~300ms).
  webServer: {
    command: "npx vite preview --port 4173 --strictPort",
    url: "http://localhost:4173/",
    reuseExistingServer: !process.env["CI"],
    timeout: 30_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
