// [WEB-VIEWPORT-E2E] Pan + zoom behaviour for the diagram preview pane. Real
// PointerEvent / WheelEvent semantics are browser-dependent so a jsdom
// simulation is insufficient — this runs against the actual event pipeline in
// Chromium, both landscape (desktop) and portrait-mobile viewports.
import { expect, test } from "./support/coverage-fixture.js";
import { openHarness } from "./support/harness-page.js";
import type { Page } from "@playwright/test";

const buildContainer = async (page: Page, opts: { width?: number; height?: number } = {}): Promise<void> => {
  const width = opts.width ?? 800;
  const height = opts.height ?? 600;
  await page.evaluate(
    ([w, h]) => {
      const root = document.getElementById("e2e-mount") as HTMLElement;
      root.innerHTML = `<div id="vp" style="width:${String(w)}px;height:${String(h)}px;position:relative"></div>`;
      const container = document.getElementById("vp") as HTMLElement;
      // Keep a reference so mount-without-viewport tests can access it.
      window.__E2E_VP = window.__E2E.createViewport(container);
    },
    [width, height]
  );
};

const transform = (page: Page): Promise<string> =>
  page.$eval("#vp .viewport-wrapper", (el) => (el as HTMLElement).style.transform);

const fireWheel = async (page: Page, deltaY: number, cx: number, cy: number): Promise<void> => {
  await page.evaluate(
    ([d, x, y]) => {
      const el = document.getElementById("vp") as HTMLElement;
      el.dispatchEvent(
        new WheelEvent("wheel", { deltaY: d, clientX: x, clientY: y, bubbles: true, cancelable: true })
      );
    },
    [deltaY, cx, cy] as const
  );
};

const fireDrag = async (
  page: Page,
  start: [number, number],
  end: [number, number]
): Promise<void> => {
  await page.evaluate(
    ([sx, sy, ex, ey]) => {
      const el = document.getElementById("vp") as HTMLElement;
      el.dispatchEvent(
        new PointerEvent("pointerdown", { pointerId: 1, clientX: sx, clientY: sy, bubbles: true })
      );
      el.dispatchEvent(
        new PointerEvent("pointermove", { clientX: ex, clientY: ey, bubbles: true })
      );
      el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    },
    [start[0], start[1], end[0], end[1]] as const
  );
};

test.describe("[WEB-VIEWPORT]", () => {
  test.beforeEach(async ({ page }) => {
    await openHarness(page);
    await buildContainer(page);
  });

  test("creates a .viewport-wrapper child", async ({ page }) => {
    await expect(page.locator("#vp .viewport-wrapper")).toHaveCount(1);
  });

  test("sets grab cursor on container", async ({ page }) => {
    const cursor = await page.$eval("#vp", (el) => (el as HTMLElement).style.cursor);
    expect(cursor).toBe("grab");
  });

  test("setViewportContent puts HTML into the wrapper", async ({ page }) => {
    await page.evaluate(() => {
      window.__E2E.setViewportContent(document.getElementById("vp") as HTMLElement, "<svg>test</svg>");
    });
    const html = await page.$eval("#vp .viewport-wrapper", (el) => el.innerHTML);
    expect(html).toBe("<svg>test</svg>");
  });

  test("wheel zoom changes transform to non-identity", async ({ page }) => {
    await fireWheel(page, -100, 400, 300);
    const t = await transform(page);
    expect(t).toContain("scale(");
    expect(t).not.toBe("scale(1)");
  });

  test("pointer drag pans the viewport", async ({ page }) => {
    await fireDrag(page, [100, 100], [200, 150]);
    const t = await transform(page);
    expect(t).toContain("translate(100px, 50px)");
    const cursor = await page.$eval("#vp", (el) => (el as HTMLElement).style.cursor);
    expect(cursor).toBe("grab");
  });

  test("drag started on an anchor is ignored", async ({ page }) => {
    await page.evaluate(() => {
      const el = document.getElementById("vp") as HTMLElement;
      const link = document.createElement("a");
      el.appendChild(link);
      link.dispatchEvent(
        new PointerEvent("pointerdown", { pointerId: 1, clientX: 100, clientY: 100, bubbles: true })
      );
      link.dispatchEvent(new PointerEvent("pointermove", { clientX: 200, clientY: 200, bubbles: true }));
    });
    expect(await transform(page)).toBe("");
  });

  test("drag started on a button is ignored", async ({ page }) => {
    await page.evaluate(() => {
      const el = document.getElementById("vp") as HTMLElement;
      const btn = document.createElement("button");
      el.appendChild(btn);
      btn.dispatchEvent(
        new PointerEvent("pointerdown", { pointerId: 1, clientX: 100, clientY: 100, bubbles: true })
      );
      btn.dispatchEvent(new PointerEvent("pointermove", { clientX: 200, clientY: 200, bubbles: true }));
    });
    expect(await transform(page)).toBe("");
  });

  test("pointermove without prior pointerdown is a no-op", async ({ page }) => {
    await page.evaluate(() => {
      (document.getElementById("vp") as HTMLElement).dispatchEvent(
        new PointerEvent("pointermove", { clientX: 200, clientY: 200, bubbles: true })
      );
    });
    expect(await transform(page)).toBe("");
  });

  test("pointercancel stops the drag without leaving grab-active", async ({ page }) => {
    await page.evaluate(() => {
      const el = document.getElementById("vp") as HTMLElement;
      el.dispatchEvent(
        new PointerEvent("pointerdown", { pointerId: 1, clientX: 0, clientY: 0, bubbles: true })
      );
      el.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true }));
    });
    const cursor = await page.$eval("#vp", (el) => (el as HTMLElement).style.cursor);
    expect(cursor).toBe("grab");
  });

  test("clamps wheel zoom to MIN and MAX", async ({ page }) => {
    for (let i = 0; i < 100; i++) {
      await fireWheel(page, 100, 400, 300);
    }
    expect(await transform(page)).toContain("scale(0.1)");
    for (let i = 0; i < 200; i++) {
      await fireWheel(page, -100, 400, 300);
    }
    expect(await transform(page)).toContain("scale(5)");
  });

  test("setViewportContent falls back to container without wrapper", async ({ page }) => {
    const html = await page.evaluate(() => {
      const extra = document.getElementById("e2e-extra") as HTMLElement;
      extra.innerHTML = `<div id="bare"></div>`;
      window.__E2E.setViewportContent(document.getElementById("bare") as HTMLElement, "<p>test</p>");
      return (document.getElementById("bare") as HTMLElement).innerHTML;
    });
    expect(html).toBe("<p>test</p>");
  });

  test("fitSvg tolerates a zero-size SVG without NaN", async ({ page }) => {
    await page.evaluate(() => {
      window.__E2E.setViewportContent(
        document.getElementById("vp") as HTMLElement,
        `<svg xmlns="http://www.w3.org/2000/svg"></svg>`
      );
    });
    const t = await transform(page);
    expect(t).not.toContain("NaN");
    expect(t).not.toContain("Infinity");
  });

  test("fitSvg scales SVG to fit container when both have size", async ({ page }) => {
    await page.evaluate(() => {
      window.__E2E.setViewportContent(
        document.getElementById("vp") as HTMLElement,
        `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"></svg>`
      );
    });
    const t = await transform(page);
    expect(t).toContain("scale(");
    expect(t).not.toContain("NaN");
  });

  test("zoomIn / zoomOut / scale reflect state", async ({ page }) => {
    await page.evaluate(() => {
      window.__E2E_VP.zoomIn();
    });
    expect(await transform(page)).toContain("scale(");
    expect(await transform(page)).not.toContain("scale(1)");
    const scale1 = await page.evaluate(() => window.__E2E_VP.scale);
    expect(scale1).toBeGreaterThan(1);
    await page.evaluate(() => {
      window.__E2E_VP.zoomOut();
    });
    expect(await transform(page)).toContain("scale(");
  });

  test("fit with SVG scales content; fit without resets", async ({ page }) => {
    // with SVG
    await page.evaluate(() => {
      const wrapper = document.querySelector("#vp .viewport-wrapper") as HTMLElement;
      const ns = "http://www.w3.org/2000/svg";
      const svg = document.createElementNS(ns, "svg");
      svg.setAttribute("width", "400");
      svg.setAttribute("height", "300");
      wrapper.appendChild(svg);
      window.__E2E_VP.fit();
    });
    const withSvg = await transform(page);
    expect(withSvg).toContain("scale(");
    expect(withSvg).not.toBe("translate(0px, 0px) scale(1)");
    // without SVG (new viewport with clean wrapper)
    await page.evaluate(() => {
      const extra = document.getElementById("e2e-extra") as HTMLElement;
      extra.innerHTML = `<div id="vp2" style="width:800px;height:600px;position:relative"></div>`;
      window.__E2E_VP2 = window.__E2E.createViewport(document.getElementById("vp2") as HTMLElement);
      window.__E2E_VP2.zoomIn();
      window.__E2E_VP2.fit();
    });
    const cleanFit = await page.$eval(
      "#vp2 .viewport-wrapper",
      (el) => (el as HTMLElement).style.transform
    );
    expect(cleanFit).toBe("translate(0px, 0px) scale(1)");
  });

  test("reset restores identity transform after a drag", async ({ page }) => {
    await fireDrag(page, [0, 0], [50, 50]);
    await page.evaluate(() => {
      window.__E2E_VP.reset();
    });
    expect(await transform(page)).toBe("translate(0px, 0px) scale(1)");
  });

  // [WEB-VIEWPORT-PRESERVE] Re-rendering must not wipe user pan/zoom.
  test("setViewportContent PRESERVES user pan across re-renders", async ({ page }) => {
    await page.evaluate(() => {
      window.__E2E.setViewportContent(
        document.getElementById("vp") as HTMLElement,
        `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"></svg>`
      );
    });
    await fireDrag(page, [0, 0], [123, 77]);
    const afterPan = await transform(page);
    expect(afterPan).toContain("translate(");
    expect(afterPan).not.toBe("translate(0px, 0px) scale(1)");
    await page.evaluate(() => {
      window.__E2E.setViewportContent(
        document.getElementById("vp") as HTMLElement,
        `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"></svg>`
      );
    });
    expect(await transform(page)).toBe(afterPan);
  });

  test("setViewportContent PRESERVES user zoom across re-renders", async ({ page }) => {
    await page.evaluate(() => {
      window.__E2E.setViewportContent(
        document.getElementById("vp") as HTMLElement,
        `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"></svg>`
      );
    });
    await fireWheel(page, -100, 400, 300);
    const afterZoom = await transform(page);
    await page.evaluate(() => {
      window.__E2E.setViewportContent(
        document.getElementById("vp") as HTMLElement,
        `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"></svg>`
      );
    });
    expect(await transform(page)).toBe(afterZoom);
  });
});
