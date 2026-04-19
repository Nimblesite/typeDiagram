// [WEB-E2E-HARNESS-FIXTURE] Playwright test fixture that navigates to the
// harness page and returns helpers for driving it. Each test gets a fresh
// #e2e-mount/#e2e-extra pair plus cleared localStorage.
import type { Page } from "@playwright/test";

export const openHarness = async (page: Page): Promise<void> => {
  // Harness is an ES module; window.__E2E is assigned at end of module body,
  // which finishes after `load` fires. Poll up to 10s — 5s has been tight
  // on slow CI boxes when many specs hit the preview server concurrently.
  await page.goto("/e2e-harness.html");
  await page.waitForFunction(() => "__E2E" in window, undefined, { timeout: 10_000 });
  await page.evaluate(() => window.__E2E.reset());
};

export const resetHarness = async (page: Page): Promise<void> => {
  await page.evaluate(() => window.__E2E.reset());
};

export const wait = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));
