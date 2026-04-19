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

  test("renders bar with 5 buttons and routes clicks to each action", async ({ page }) => {
    await expect(page.locator("#e2e-mount .zoom-controls")).toHaveCount(1);
    const btns = page.locator("#e2e-mount .zoom-btn");
    await expect(btns).toHaveCount(5);
    const className = await page.$eval("#e2e-mount .zoom-controls", (el) => el.className);
    expect(className).toBe("zoom-controls");
    await btns.nth(0).click();
    await btns.nth(1).click();
    await btns.nth(2).click();
    await btns.nth(3).click();
    const calls = await page.evaluate(() => window.__E2E_ZC_CALLS);
    expect(calls).toEqual({ zoomIn: 1, zoomOut: 1, reset: 1, fit: 1 });
  });

  test("export button is a no-op when the viewport has no svg", async ({ page }) => {
    // No viewport-wrapper svg exists — exportSvg should early-return without
    // creating a download.
    const tripped = await page.evaluate(() => {
      let anchorClicked = false;
      const orig = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () {
        anchorClicked = true;
      };
      try {
        const btn = document.querySelectorAll<HTMLButtonElement>("#e2e-mount .zoom-btn")[4];
        btn?.click();
      } finally {
        HTMLAnchorElement.prototype.click = orig;
      }
      return anchorClicked;
    });
    expect(tripped).toBe(false);
  });

  test("export button triggers an anchor download when svg is present", async ({ page }) => {
    const result = await page.evaluate(() => {
      const mount = document.getElementById("e2e-mount") as HTMLElement;
      const wrapper = document.createElement("div");
      wrapper.className = "viewport-wrapper";
      const ns = "http://www.w3.org/2000/svg";
      const svg = document.createElementNS(ns, "svg");
      svg.setAttribute("width", "10");
      svg.setAttribute("height", "10");
      wrapper.appendChild(svg);
      mount.appendChild(wrapper);
      let href = "";
      let download = "";
      let anchorClicked = false;
      const origClick = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () {
        href = this.href;
        download = this.download;
        anchorClicked = true;
      };
      try {
        const btn = document.querySelectorAll<HTMLButtonElement>("#e2e-mount .zoom-btn")[4];
        btn?.click();
      } finally {
        HTMLAnchorElement.prototype.click = origClick;
      }
      return { href, download, anchorClicked };
    });
    expect(result.anchorClicked).toBe(true);
    expect(result.download).toBe("diagram.svg");
    expect(result.href).toMatch(/^blob:/);
  });
});
