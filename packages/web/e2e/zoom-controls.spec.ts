// [WEB-ZOOM-CONTROLS-E2E] Floating zoom toolbar — covered in a real browser
// so click routing + CSS/layout match production. Runs once per Playwright
// project (desktop + mobile) so we catch any touch-vs-mouse regressions.
import { expect, test } from "./support/coverage-fixture.js";
import { openHarness } from "./support/harness-page.js";

test.describe("[WEB-ZOOM-CONTROLS]", () => {
  test.beforeEach(async ({ page }) => {
    await openHarness(page);
    await page.evaluate(() => {
      const mount = document.getElementById("e2e-mount") as HTMLElement;
      mount.innerHTML = "";
      window.__E2E_ZC_CALLS = { zoomIn: 0, zoomOut: 0, reset: 0, fit: 0 };
      window.__E2E.createZoomControls(mount, {
        zoomIn: () => {
          window.__E2E_ZC_CALLS.zoomIn++;
        },
        zoomOut: () => {
          window.__E2E_ZC_CALLS.zoomOut++;
        },
        reset: () => {
          window.__E2E_ZC_CALLS.reset++;
        },
        fit: () => {
          window.__E2E_ZC_CALLS.fit++;
        },
      });
    });
  });

  test("appends a .zoom-controls element", async ({ page }) => {
    await expect(page.locator("#e2e-mount .zoom-controls")).toHaveCount(1);
  });

  test("renders five zoom buttons", async ({ page }) => {
    await expect(page.locator("#e2e-mount .zoom-btn")).toHaveCount(5);
  });

  test("+ button calls zoomIn once", async ({ page }) => {
    await page.locator("#e2e-mount .zoom-btn").nth(0).click();
    const calls = await page.evaluate(() => window.__E2E_ZC_CALLS);
    expect(calls.zoomIn).toBe(1);
    expect(calls.zoomOut).toBe(0);
  });

  test("− button calls zoomOut once", async ({ page }) => {
    await page.locator("#e2e-mount .zoom-btn").nth(1).click();
    const calls = await page.evaluate(() => window.__E2E_ZC_CALLS);
    expect(calls.zoomOut).toBe(1);
  });

  test("1:1 button calls reset once", async ({ page }) => {
    await page.locator("#e2e-mount .zoom-btn").nth(2).click();
    const calls = await page.evaluate(() => window.__E2E_ZC_CALLS);
    expect(calls.reset).toBe(1);
  });

  test("fit button calls fit once", async ({ page }) => {
    await page.locator("#e2e-mount .zoom-btn").nth(3).click();
    const calls = await page.evaluate(() => window.__E2E_ZC_CALLS);
    expect(calls.fit).toBe(1);
  });

  test("returns the bar element with .zoom-controls class", async ({ page }) => {
    const className = await page.evaluate(() => {
      const bar = document.querySelector("#e2e-mount .zoom-controls");
      return bar?.className ?? "";
    });
    expect(className).toBe("zoom-controls");
  });
});
