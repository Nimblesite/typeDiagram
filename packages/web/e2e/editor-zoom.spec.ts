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

  test("applies default 13px on init; restores + clamps persisted size", async ({ page }) => {
    expect(await fontSizeOf(page, "#ez-ta")).toBe("13px");
    expect(await fontSizeOf(page, "#ez-backdrop")).toBe("13px");
    const remountWith = async (stored: string): Promise<string> =>
      page.evaluate((s) => {
        window.__E2E.reset();
        localStorage.setItem("typediagram-editor-zoom", s);
        const root = document.getElementById("e2e-mount") as HTMLElement;
        root.innerHTML = `<div id="ez-wrap"><pre id="ez-backdrop"></pre><textarea id="ez-ta"></textarea></div>`;
        window.__E2E.initEditorZoom(
          document.getElementById("ez-wrap") as HTMLElement,
          document.getElementById("ez-ta") as HTMLTextAreaElement,
          document.getElementById("ez-backdrop") as HTMLElement
        );
        return (document.getElementById("ez-ta") as HTMLElement).style.fontSize;
      }, stored);
    expect(await remountWith("18")).toBe("18px");
    expect(await remountWith("2")).toBe("8px");
    expect(await remountWith("99")).toBe("32px");
  });

  test("wheel zoom: Ctrl-up = in+persist, Ctrl-down = out, Meta-up = in, plain = no-op", async ({ page }) => {
    await dispatchWheel(page, -100);
    expect(await fontSizeOf(page, "#ez-ta")).toBe("14px");
    expect(await fontSizeOf(page, "#ez-backdrop")).toBe("14px");
    expect(await page.evaluate(() => localStorage.getItem("typediagram-editor-zoom"))).toBe("14");
    await dispatchWheel(page, 100);
    await dispatchWheel(page, 100);
    expect(await fontSizeOf(page, "#ez-ta")).toBe("12px");
    await dispatchWheel(page, -100, { ctrlKey: false, metaKey: true });
    expect(await fontSizeOf(page, "#ez-ta")).toBe("13px");
    await dispatchWheel(page, -100, { ctrlKey: false, metaKey: false });
    expect(await fontSizeOf(page, "#ez-ta")).toBe("13px");
  });

  test("runtime clamps: cannot zoom below 8px or above 32px via wheel", async ({ page }) => {
    const remountAt = async (size: string): Promise<void> => {
      await page.evaluate((s) => {
        window.__E2E.reset();
        localStorage.setItem("typediagram-editor-zoom", s);
        const root = document.getElementById("e2e-mount") as HTMLElement;
        root.innerHTML = `<div id="ez-wrap"><pre id="ez-backdrop"></pre><textarea id="ez-ta"></textarea></div>`;
        window.__E2E.initEditorZoom(
          document.getElementById("ez-wrap") as HTMLElement,
          document.getElementById("ez-ta") as HTMLTextAreaElement,
          document.getElementById("ez-backdrop") as HTMLElement
        );
      }, size);
    };
    await remountAt("8");
    await dispatchWheel(page, 100);
    expect(await fontSizeOf(page, "#ez-ta")).toBe("8px");
    await remountAt("32");
    await dispatchWheel(page, -100);
    expect(await fontSizeOf(page, "#ez-ta")).toBe("32px");
  });
});
