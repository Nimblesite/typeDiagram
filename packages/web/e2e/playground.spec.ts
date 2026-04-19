// [WEB-PLAYGROUND-E2E] Playground page — source/hooks tabs, preset chips,
// persistence. Formerly mocked renderToString; in a real browser we observe
// the preview SVG instead of mock arguments.
import { expect, test } from "./support/coverage-fixture.js";

type Page = import("@playwright/test").Page;

// Poll localStorage until the value at `key` contains `marker`. Replaces
// fixed waits after textarea input (debounce timing isn't under test).
const waitForStorageContains = async (page: Page, key: string, marker: string): Promise<void> => {
  await page.waitForFunction(
    (args: { k: string; m: string }) => {
      const v = localStorage.getItem(args.k);
      return v !== null && v.includes(args.m);
    },
    { k: key, m: marker }
  );
};

// Poll #hooks-editor textarea value until it contains/excludes a marker.
const waitForHooksValue = async (page: Page, marker: string, mode: "contains" | "excludes"): Promise<void> => {
  await page.waitForFunction(
    (args: { m: string; mode: "contains" | "excludes" }) => {
      const ta = document.querySelector<HTMLTextAreaElement>("#hooks-editor");
      if (ta === null) {
        return false;
      }
      const has = ta.value.includes(args.m);
      return args.mode === "contains" ? has : !has;
    },
    { m: marker, mode }
  );
};

// Poll #preview innerHTML until it contains <svg (i.e. a render completed).
const waitForPreviewSvg = async (page: Page): Promise<void> => {
  await page.waitForFunction(() => {
    const p = document.querySelector("#preview");
    return p !== null && p.innerHTML.includes("<svg");
  });
};

// Poll #hooks-diag until it's visible (not-hidden) with non-empty text.
const waitForHooksDiag = async (page: Page): Promise<void> => {
  await page.waitForFunction(() => {
    const d = document.querySelector<HTMLElement>("#hooks-diag");
    return d !== null && !d.hidden && (d.textContent ?? "").length > 0;
  });
};

// Poll #hooks-backdrop until a specific highlighted span class appears.
const waitForBackdropToken = async (page: Page, token: string): Promise<void> => {
  await page.waitForFunction((t: string) => {
    const b = document.querySelector("#hooks-backdrop");
    return b !== null && b.innerHTML.toLowerCase().includes(t.toLowerCase());
  }, token);
};

// Poll an aria-pressed state on a chip matching preset id.
const waitForChipPressed = async (page: Page, presetId: string, pressed: boolean): Promise<void> => {
  await page.waitForFunction(
    (args: { id: string; want: boolean }) => {
      const btn = document.querySelector<HTMLButtonElement>(`.hook-chip[data-preset-id="${args.id}"]`);
      return btn !== null && btn.getAttribute("aria-pressed") === String(args.want);
    },
    { id: presetId, want: pressed }
  );
};

const goto = async (page: Page): Promise<void> => {
  // Fresh session for every test — previous specs may have seeded
  // localStorage (mount-restores test) which would otherwise bleed across.
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.clear();
  });
  await page.reload();
  await page.waitForSelector("#editor");
  await page.waitForFunction(() => {
    const preview = document.querySelector("#preview");
    return preview !== null && preview.innerHTML.length > 0;
  });
};

const openHooksTab = async (page: import("@playwright/test").Page): Promise<void> => {
  await page.locator('.pane-tab[data-tab="hooks"]').click();
};

test.describe("[WEB-PLAYGROUND]", () => {
  test("builds source and hooks tabs + preview pane", async ({ page }) => {
    await goto(page);
    await expect(page.locator("#editor")).toHaveCount(1);
    await expect(page.locator("#hooks-editor")).toHaveCount(1);
    await expect(page.locator(".pane-tab")).toHaveCount(2);
    await expect(page.locator("#preview")).toHaveCount(1);
  });

  test("source tab active by default; hooks editor hidden", async ({ page }) => {
    await goto(page);
    const sourceHidden = await page.$eval('[data-editor="source"]', (el) =>
      el.classList.contains("editor-wrap--hidden")
    );
    const hooksHidden = await page.$eval('[data-editor="hooks"]', (el) => el.classList.contains("editor-wrap--hidden"));
    expect(sourceHidden).toBe(false);
    expect(hooksHidden).toBe(true);
  });

  test("clicking the hooks tab reveals the hooks editor", async ({ page }) => {
    await goto(page);
    await page.locator('.pane-tab[data-tab="hooks"]').click();
    const sourceHidden = await page.$eval('[data-editor="source"]', (el) =>
      el.classList.contains("editor-wrap--hidden")
    );
    const hooksHidden = await page.$eval('[data-editor="hooks"]', (el) => el.classList.contains("editor-wrap--hidden"));
    expect(sourceHidden).toBe(true);
    expect(hooksHidden).toBe(false);
    const tabOn = await page.$eval('.pane-tab[data-tab="hooks"]', (el) => el.classList.contains("pane-tab--on"));
    expect(tabOn).toBe(true);
  });

  test("fresh mount renders a preview SVG", async ({ page }) => {
    await goto(page);
    const html = await page.$eval("#preview", (el) => el.innerHTML);
    expect(html).toContain("<svg");
  });

  test("typing valid JS in hooks editor re-renders (preview stays an SVG)", async ({ page }) => {
    await goto(page);
    await openHooksTab(page);
    await page.locator("#hooks-editor").fill("hooks.node = (_ctx, def) => def;");
    // Wait for the debounced re-render to land a new svg in #preview.
    await waitForPreviewSvg(page);
    // Also wait for the new source to persist, which only happens AFTER the
    // render pipeline finishes — proves the hook wired through end-to-end.
    await waitForStorageContains(page, "td-playground-hooks", "hooks.node = (_ctx, def)");
  });

  test("hooks textarea pre-populates with header + example block", async ({ page }) => {
    await goto(page);
    const value = await page.$eval("#hooks-editor", (el) => (el as HTMLTextAreaElement).value);
    expect(value.length).toBeGreaterThan(0);
    expect(value).toMatch(/\/\/.*Render hooks/);
    expect(value).toContain("/docs/render-hooks.html");
    // Example code block present (/* ... */).
    const blockMatch = /\/\*([\s\S]*?)\*\//.exec(value);
    expect(blockMatch).not.toBeNull();
    expect(blockMatch?.[1] ?? "").toMatch(/hooks\.(defs|node|row|edge|background|post)/);
  });

  test("no overlay empty-hint element — textarea is source of truth", async ({ page }) => {
    await goto(page);
    await expect(page.locator(".hooks-empty-hint")).toHaveCount(0);
    await expect(page.locator(".hooks-empty-example")).toHaveCount(0);
  });

  test("editor input writes source to localStorage", async ({ page }) => {
    await goto(page);
    await page.locator("#editor").fill("typeDiagram\n  type Persisted { x: Int }");
    await waitForStorageContains(page, "td-playground-source", "Persisted");
  });

  test("mount restores previously-saved source and hooks from localStorage", async ({ page }) => {
    await page.goto("/");
    // Seed then reload so mountPlayground reads the values on the next boot.
    await page.evaluate(() => {
      localStorage.setItem("td-playground-source", "typeDiagram\n  type Restored { x: Int }");
      localStorage.setItem("td-playground-hooks", "hooks.node = (_c, d) => d;");
    });
    await page.reload();
    await page.waitForSelector("#editor");
    const sourceValue = await page.$eval("#editor", (el) => (el as HTMLTextAreaElement).value);
    const hooksValue = await page.$eval("#hooks-editor", (el) => (el as HTMLTextAreaElement).value);
    expect(sourceValue).toContain("Restored");
    expect(hooksValue).toContain("hooks.node");
  });

  test("hooks editor has syntax-highlight backdrop with JS tokens", async ({ page }) => {
    await goto(page);
    await openHooksTab(page);
    await page.locator("#hooks-editor").fill("const x = 1; // comment");
    await waitForBackdropToken(page, "comment");
    const html = await page.$eval("#hooks-backdrop", (el) => el.innerHTML);
    expect(html).toMatch(/<span[^>]*class=/);
  });

  test("invalid hook code surfaces a diagnostic; preview still renders", async ({ page }) => {
    await goto(page);
    await openHooksTab(page);
    await page.locator("#hooks-editor").fill("hooks.node = ###;");
    await waitForHooksDiag(page);
    const previewHtml = await page.$eval("#preview", (el) => el.innerHTML);
    expect(previewHtml).toContain("<svg");
  });
});

test.describe("[WEB-PLAYGROUND-PRESETS]", () => {
  test("one hook-chip button per preset", async ({ page }) => {
    await goto(page);
    const chipCount = await page.locator(".hook-chip").count();
    expect(chipCount).toBeGreaterThan(0);
  });

  test("chip toolbar sits above the hooks textarea (z-index)", async ({ page }) => {
    await goto(page);
    const zs = await page.evaluate(() => {
      const toolbar = document.querySelector(".hooks-toolbar");
      const textarea = document.querySelector("#hooks-editor");
      const toolbarZ = parseInt(toolbar === null ? "0" : getComputedStyle(toolbar).zIndex || "0", 10);
      const textareaZ = parseInt(textarea === null ? "0" : getComputedStyle(textarea).zIndex || "0", 10);
      return { toolbarZ: isNaN(toolbarZ) ? 0 : toolbarZ, textareaZ: isNaN(textareaZ) ? 0 : textareaZ };
    });
    expect(zs.toolbarZ).toBeGreaterThan(zs.textareaZ);
  });

  test("clicking a preset appends its source block and marks aria-pressed", async ({ page }) => {
    await goto(page);
    await openHooksTab(page);
    const before = await page.$eval("#hooks-editor", (el) => (el as HTMLTextAreaElement).value);
    const btn = page.locator('.hook-chip[data-preset-id="drop-shadow"]');
    await btn.click();
    await waitForHooksValue(page, "// --- preset:drop-shadow ---", "contains");
    await waitForChipPressed(page, "drop-shadow", true);
    const after = await page.$eval("#hooks-editor", (el) => (el as HTMLTextAreaElement).value);
    expect(after.length).toBeGreaterThan(before.length);
    expect(after).toContain("hooks.node");
  });

  test("clicking the same preset again removes the block", async ({ page }) => {
    await goto(page);
    await openHooksTab(page);
    const btn = page.locator('.hook-chip[data-preset-id="grid-bg"]');
    await btn.click();
    await waitForHooksValue(page, "preset:grid-bg", "contains");
    await btn.click();
    await waitForHooksValue(page, "preset:grid-bg", "excludes");
    await waitForChipPressed(page, "grid-bg", false);
  });

  test("preset click keeps the preview SVG rendered", async ({ page }) => {
    await goto(page);
    await openHooksTab(page);
    await page.locator('.hook-chip[data-preset-id="drop-shadow"]').click();
    await waitForHooksValue(page, "preset:drop-shadow", "contains");
    await waitForPreviewSvg(page);
  });

  test("hand-typing a preset block lights up the matching chip", async ({ page }) => {
    await goto(page);
    await openHooksTab(page);
    const btn = page.locator('.hook-chip[data-preset-id="classes"]');
    await btn.click();
    await waitForChipPressed(page, "classes", true);
    const presetSource = await page.$eval("#hooks-editor", (el) => (el as HTMLTextAreaElement).value);
    await btn.click();
    await waitForChipPressed(page, "classes", false);
    await page.locator("#hooks-editor").fill(presetSource);
    await waitForChipPressed(page, "classes", true);
    expect(await btn.evaluate((el) => el.className)).toContain("hook-chip--on");
  });
});
