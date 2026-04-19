// [WEB-SPLITTER-E2E] Covers splitter behaviour in a real browser — desktop
// (landscape) and mobile (portrait) auto-swap between col-resize and
// row-resize based on the (orientation: portrait), (max-width: 767px) media
// query. Mirrors former test/splitter.test.ts.
import { expect, test } from "./support/coverage-fixture.js";
import { openHarness } from "./support/harness-page.js";

test.beforeEach(async ({ page }) => {
  await openHarness(page);
  await page.evaluate(() => {
    const mount = document.getElementById("e2e-mount");
    if (mount === null) {
      throw new Error("no mount");
    }
    mount.innerHTML = `
      <div id="sp-app" style="display:grid;width:1000px;height:800px">
        <div id="sp-left"></div>
        <div id="sp-handle" class="splitter" style="width:4px;height:4px"></div>
        <div id="sp-right"></div>
      </div>`;
    const app = document.getElementById("sp-app") as HTMLElement;
    const handle = document.getElementById("sp-handle") as HTMLElement;
    window.__E2E.initSplitter(app, handle);
  });
});

const gridColsOf = async (page: import("@playwright/test").Page): Promise<string> =>
  page.$eval("#sp-app", (el) => (el as HTMLElement).style.gridTemplateColumns);

const gridRowsOf = async (page: import("@playwright/test").Page): Promise<string> =>
  page.$eval("#sp-app", (el) => (el as HTMLElement).style.gridTemplateRows);

test.describe("[WEB-SPLITTER]", () => {
  test("applies default 50/50 split in landscape", async ({ page, isMobile }) => {
    test.skip(isMobile, "portrait uses rows, covered separately");
    expect(await gridColsOf(page)).toBe("0.5fr 4px 0.5fr");
  });

  test("uses gridTemplateRows in portrait (mobile)", async ({ page, isMobile }) => {
    test.skip(!isMobile, "portrait-only");
    expect(await gridRowsOf(page)).toBe("0.5fr 4px 0.5fr");
    expect(await gridColsOf(page)).toBe("");
  });

  test("restores persisted ratio from localStorage", async ({ page, isMobile }) => {
    await page.evaluate(() => {
      localStorage.setItem("typediagram-split", "0.3");
      window.__E2E.reset();
      const mount = document.getElementById("e2e-mount") as HTMLElement;
      mount.innerHTML = `<div id="sp-app" style="display:grid;width:1000px;height:800px">
        <div></div><div id="sp-handle" class="splitter"></div><div></div></div>`;
      // reset() clears localStorage — re-set AFTER reset.
      localStorage.setItem("typediagram-split", "0.3");
      window.__E2E.initSplitter(
        document.getElementById("sp-app") as HTMLElement,
        document.getElementById("sp-handle") as HTMLElement
      );
    });
    const rows = await gridRowsOf(page);
    const cols = await gridColsOf(page);
    expect(isMobile ? rows : cols).toBe("0.3fr 4px 0.7fr");
  });

  test("clamps stored ratio below MIN", async ({ page, isMobile }) => {
    await page.evaluate(() => {
      window.__E2E.reset();
      localStorage.setItem("typediagram-split", "0.05");
      const mount = document.getElementById("e2e-mount") as HTMLElement;
      mount.innerHTML = `<div id="sp-app" style="display:grid;width:1000px;height:800px">
        <div></div><div id="sp-handle" class="splitter"></div><div></div></div>`;
      window.__E2E.initSplitter(
        document.getElementById("sp-app") as HTMLElement,
        document.getElementById("sp-handle") as HTMLElement
      );
    });
    const val = isMobile ? await gridRowsOf(page) : await gridColsOf(page);
    expect(val).toBe("0.15fr 4px 0.85fr");
  });

  test("clamps stored ratio above MAX", async ({ page, isMobile }) => {
    await page.evaluate(() => {
      window.__E2E.reset();
      localStorage.setItem("typediagram-split", "0.99");
      const mount = document.getElementById("e2e-mount") as HTMLElement;
      mount.innerHTML = `<div id="sp-app" style="display:grid;width:1000px;height:800px">
        <div></div><div id="sp-handle" class="splitter"></div><div></div></div>`;
      window.__E2E.initSplitter(
        document.getElementById("sp-app") as HTMLElement,
        document.getElementById("sp-handle") as HTMLElement
      );
    });
    const val = isMobile ? await gridRowsOf(page) : await gridColsOf(page);
    // 1 - 0.85 rounds with a tiny float error in some browsers.
    expect(val).toMatch(/^0\.85fr 4px 0\.15\d*fr$/);
  });

  test("drag updates grid and pointerup saves ratio", async ({ page, isMobile }) => {
    const app = page.locator("#sp-app");
    const box = await app.boundingBox();
    if (box === null) {
      throw new Error("no bbox");
    }
    const start = isMobile
      ? { x: box.x + box.width / 2, y: box.y + box.height / 2 }
      : { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const end = isMobile
      ? { x: start.x, y: box.y + box.height * 0.7 }
      : { x: box.x + box.width * 0.7, y: start.y };
    await page.mouse.move(start.x, start.y);
    await page.locator("#sp-handle").dispatchEvent("pointerdown", {
      pointerId: 1,
      clientX: start.x,
      clientY: start.y,
      bubbles: true,
    });
    await page.evaluate(
      ([cx, cy]) => {
        window.dispatchEvent(
          new PointerEvent("pointermove", { clientX: cx, clientY: cy, bubbles: true })
        );
      },
      [end.x, end.y]
    );
    await page.evaluate(() => {
      window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    });
    const stored = await page.evaluate(() => localStorage.getItem("typediagram-split"));
    expect(stored).not.toBeNull();
    expect(parseFloat(stored ?? "0")).toBeGreaterThan(0.6);
    expect(parseFloat(stored ?? "1")).toBeLessThan(0.8);
  });

  test("pointermove without prior pointerdown is a no-op", async ({ page, isMobile }) => {
    const before = isMobile ? await gridRowsOf(page) : await gridColsOf(page);
    await page.evaluate(() => {
      window.dispatchEvent(
        new PointerEvent("pointermove", { clientX: 800, clientY: 700, bubbles: true })
      );
    });
    const after = isMobile ? await gridRowsOf(page) : await gridColsOf(page);
    expect(after).toBe(before);
  });

  test("pointercancel ends the drag and saves ratio", async ({ page }) => {
    await page.locator("#sp-handle").dispatchEvent("pointerdown", {
      pointerId: 1,
      clientX: 500,
      clientY: 400,
      bubbles: true,
    });
    await page.evaluate(() => {
      window.dispatchEvent(
        new PointerEvent("pointermove", { clientX: 600, clientY: 500, bubbles: true })
      );
      window.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true }));
    });
    const stored = await page.evaluate(() => localStorage.getItem("typediagram-split"));
    expect(stored).not.toBeNull();
  });

  test("pointerup without prior drag does nothing (no save)", async ({ page }) => {
    await page.evaluate(() => {
      window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    });
    const stored = await page.evaluate(() => localStorage.getItem("typediagram-split"));
    expect(stored).toBeNull();
  });
});
