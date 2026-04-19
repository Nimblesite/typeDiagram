// [WEB-EDITOR-ZOOM-E2E] Ctrl/Cmd+wheel font-size zoom on editor panes. Uses
// real WheelEvent dispatch so modifier-key handling is exercised the way the
// browser actually fires it.
import { expect, test } from "./support/coverage-fixture.js";
import { openHarness } from "./support/harness-page.js";

const mount = async (page: import("@playwright/test").Page): Promise<void> => {
  await page.evaluate(() => {
    const root = document.getElementById("e2e-mount") as HTMLElement;
    root.innerHTML = `
      <div id="ez-wrap" style="position:relative;width:400px;height:200px">
        <pre id="ez-backdrop"></pre>
        <textarea id="ez-ta"></textarea>
      </div>`;
    window.__E2E.initEditorZoom(
      document.getElementById("ez-wrap") as HTMLElement,
      document.getElementById("ez-ta") as HTMLTextAreaElement,
      document.getElementById("ez-backdrop") as HTMLElement
    );
  });
};

const fontSizeOf = (page: import("@playwright/test").Page, sel: string): Promise<string> =>
  page.$eval(sel, (el) => (el as HTMLElement).style.fontSize);

const dispatchWheel = async (
  page: import("@playwright/test").Page,
  deltaY: number,
  opts: { ctrlKey?: boolean; metaKey?: boolean } = {}
): Promise<void> => {
  await page.evaluate(
    ([d, ctrl, meta]) => {
      const wrap = document.getElementById("ez-wrap") as HTMLElement;
      const e = new WheelEvent("wheel", { deltaY: d as number, bubbles: true, cancelable: true });
      Object.defineProperty(e, "ctrlKey", { value: ctrl as boolean });
      Object.defineProperty(e, "metaKey", { value: meta as boolean });
      wrap.dispatchEvent(e);
    },
    [deltaY, opts.ctrlKey ?? true, opts.metaKey ?? false] as const
  );
};

test.describe("[WEB-EDITOR-ZOOM]", () => {
  test.beforeEach(async ({ page }) => {
    await openHarness(page);
    await mount(page);
  });

  test("applies default 13px font size on init", async ({ page }) => {
    expect(await fontSizeOf(page, "#ez-ta")).toBe("13px");
    expect(await fontSizeOf(page, "#ez-backdrop")).toBe("13px");
  });

  test("restores persisted font size from localStorage", async ({ page }) => {
    await page.evaluate(() => {
      window.__E2E.reset();
      localStorage.setItem("typediagram-editor-zoom", "18");
      const root = document.getElementById("e2e-mount") as HTMLElement;
      root.innerHTML = `<div id="ez-wrap"><pre id="ez-backdrop"></pre><textarea id="ez-ta"></textarea></div>`;
      window.__E2E.initEditorZoom(
        document.getElementById("ez-wrap") as HTMLElement,
        document.getElementById("ez-ta") as HTMLTextAreaElement,
        document.getElementById("ez-backdrop") as HTMLElement
      );
    });
    expect(await fontSizeOf(page, "#ez-ta")).toBe("18px");
  });

  test("clamps stored font size to 8px MIN", async ({ page }) => {
    await page.evaluate(() => {
      window.__E2E.reset();
      localStorage.setItem("typediagram-editor-zoom", "2");
      const root = document.getElementById("e2e-mount") as HTMLElement;
      root.innerHTML = `<div id="ez-wrap"><pre id="ez-backdrop"></pre><textarea id="ez-ta"></textarea></div>`;
      window.__E2E.initEditorZoom(
        document.getElementById("ez-wrap") as HTMLElement,
        document.getElementById("ez-ta") as HTMLTextAreaElement,
        document.getElementById("ez-backdrop") as HTMLElement
      );
    });
    expect(await fontSizeOf(page, "#ez-ta")).toBe("8px");
  });

  test("clamps stored font size to 32px MAX", async ({ page }) => {
    await page.evaluate(() => {
      window.__E2E.reset();
      localStorage.setItem("typediagram-editor-zoom", "99");
      const root = document.getElementById("e2e-mount") as HTMLElement;
      root.innerHTML = `<div id="ez-wrap"><pre id="ez-backdrop"></pre><textarea id="ez-ta"></textarea></div>`;
      window.__E2E.initEditorZoom(
        document.getElementById("ez-wrap") as HTMLElement,
        document.getElementById("ez-ta") as HTMLTextAreaElement,
        document.getElementById("ez-backdrop") as HTMLElement
      );
    });
    expect(await fontSizeOf(page, "#ez-ta")).toBe("32px");
  });

  test("Ctrl+wheel-up zooms IN and persists", async ({ page }) => {
    await dispatchWheel(page, -100);
    expect(await fontSizeOf(page, "#ez-ta")).toBe("14px");
    expect(await fontSizeOf(page, "#ez-backdrop")).toBe("14px");
    const stored = await page.evaluate(() => localStorage.getItem("typediagram-editor-zoom"));
    expect(stored).toBe("14");
  });

  test("Ctrl+wheel-down zooms OUT", async ({ page }) => {
    await dispatchWheel(page, 100);
    expect(await fontSizeOf(page, "#ez-ta")).toBe("12px");
  });

  test("Meta+wheel-up zooms IN on macOS", async ({ page }) => {
    await dispatchWheel(page, -100, { ctrlKey: false, metaKey: true });
    expect(await fontSizeOf(page, "#ez-ta")).toBe("14px");
  });

  test("plain wheel (no modifier) does NOT change size", async ({ page }) => {
    await dispatchWheel(page, -100, { ctrlKey: false, metaKey: false });
    expect(await fontSizeOf(page, "#ez-ta")).toBe("13px");
  });

  test("clamps runtime zoom-out to 8px MIN", async ({ page }) => {
    await page.evaluate(() => {
      window.__E2E.reset();
      localStorage.setItem("typediagram-editor-zoom", "8");
      const root = document.getElementById("e2e-mount") as HTMLElement;
      root.innerHTML = `<div id="ez-wrap"><pre id="ez-backdrop"></pre><textarea id="ez-ta"></textarea></div>`;
      window.__E2E.initEditorZoom(
        document.getElementById("ez-wrap") as HTMLElement,
        document.getElementById("ez-ta") as HTMLTextAreaElement,
        document.getElementById("ez-backdrop") as HTMLElement
      );
    });
    await dispatchWheel(page, 100);
    expect(await fontSizeOf(page, "#ez-ta")).toBe("8px");
  });

  test("clamps runtime zoom-in to 32px MAX", async ({ page }) => {
    await page.evaluate(() => {
      window.__E2E.reset();
      localStorage.setItem("typediagram-editor-zoom", "32");
      const root = document.getElementById("e2e-mount") as HTMLElement;
      root.innerHTML = `<div id="ez-wrap"><pre id="ez-backdrop"></pre><textarea id="ez-ta"></textarea></div>`;
      window.__E2E.initEditorZoom(
        document.getElementById("ez-wrap") as HTMLElement,
        document.getElementById("ez-ta") as HTMLTextAreaElement,
        document.getElementById("ez-backdrop") as HTMLElement
      );
    });
    await dispatchWheel(page, -100);
    expect(await fontSizeOf(page, "#ez-ta")).toBe("32px");
  });
});
