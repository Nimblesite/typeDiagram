// [WEB-PLAYGROUND-E2E] Playground page — source/hooks tabs, preset chips,
// persistence. Formerly mocked renderToString; in a real browser we observe
// the preview SVG instead of mock arguments.
import { expect, test } from "./support/coverage-fixture.js";

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const goto = async (page: import("@playwright/test").Page): Promise<void> => {
  await page.goto("/");
  await page.waitForSelector("#editor");
  await page.waitForFunction(() => {
    const preview = document.querySelector("#preview");
    return preview !== null && preview.innerHTML.length > 0;
  });
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
    const sourceHidden = await page.$eval(
      '[data-editor="source"]',
      (el) => el.classList.contains("editor-wrap--hidden")
    );
    const hooksHidden = await page.$eval(
      '[data-editor="hooks"]',
      (el) => el.classList.contains("editor-wrap--hidden")
    );
    expect(sourceHidden).toBe(false);
    expect(hooksHidden).toBe(true);
  });

  test("clicking the hooks tab reveals the hooks editor", async ({ page }) => {
    await goto(page);
    await page.locator('.pane-tab[data-tab="hooks"]').click();
    const sourceHidden = await page.$eval(
      '[data-editor="source"]',
      (el) => el.classList.contains("editor-wrap--hidden")
    );
    const hooksHidden = await page.$eval(
      '[data-editor="hooks"]',
      (el) => el.classList.contains("editor-wrap--hidden")
    );
    expect(sourceHidden).toBe(true);
    expect(hooksHidden).toBe(false);
    const tabOn = await page.$eval(
      '.pane-tab[data-tab="hooks"]',
      (el) => el.classList.contains("pane-tab--on")
    );
    expect(tabOn).toBe(true);
  });

  test("fresh mount renders a preview SVG", async ({ page }) => {
    await goto(page);
    const html = await page.$eval("#preview", (el) => el.innerHTML);
    expect(html).toContain("<svg");
  });

  test("typing valid JS in hooks editor re-renders (preview stays an SVG)", async ({ page }) => {
    await goto(page);
    const editor = page.locator("#hooks-editor");
    await editor.fill("hooks.node = (_ctx, def) => def;");
    await wait(300);
    const html = await page.$eval("#preview", (el) => el.innerHTML);
    expect(html).toContain("<svg");
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
    const editor = page.locator("#editor");
    await editor.fill("typeDiagram\n  type Persisted { x: Int }");
    await wait(200);
    const stored = await page.evaluate(() =>
      localStorage.getItem("td-playground-source")
    );
    expect(stored).not.toBeNull();
    expect(stored).toContain("Persisted");
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
    await page.locator("#hooks-editor").fill("const x = 1; // comment");
    await wait(150);
    const html = await page.$eval("#hooks-backdrop", (el) => el.innerHTML);
    expect(html).toMatch(/<span[^>]*class=/);
    expect(html.toLowerCase()).toContain("comment");
  });

  test("invalid hook code surfaces a diagnostic; preview still renders", async ({ page }) => {
    await goto(page);
    await page.locator("#hooks-editor").fill("hooks.node = ###;");
    await wait(300);
    const diag = page.locator("#hooks-diag");
    expect(await diag.evaluate((el) => (el as HTMLElement).hidden)).toBe(false);
    const diagText = await diag.textContent();
    expect((diagText ?? "").length).toBeGreaterThan(0);
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
      const toolbarZ = parseInt(
        toolbar === null ? "0" : getComputedStyle(toolbar).zIndex || "0",
        10
      );
      const textareaZ = parseInt(
        textarea === null ? "0" : getComputedStyle(textarea).zIndex || "0",
        10
      );
      return { toolbarZ: isNaN(toolbarZ) ? 0 : toolbarZ, textareaZ: isNaN(textareaZ) ? 0 : textareaZ };
    });
    expect(zs.toolbarZ).toBeGreaterThan(zs.textareaZ);
  });

  test("clicking a preset appends its source block and marks aria-pressed", async ({ page }) => {
    await goto(page);
    const before = await page.$eval("#hooks-editor", (el) => (el as HTMLTextAreaElement).value);
    const btn = page.locator('.hook-chip[data-preset-id="drop-shadow"]');
    await btn.click();
    await wait(200);
    const after = await page.$eval("#hooks-editor", (el) => (el as HTMLTextAreaElement).value);
    expect(after.length).toBeGreaterThan(before.length);
    expect(after).toContain("// --- preset:drop-shadow ---");
    expect(after).toContain("hooks.node");
    expect(await btn.getAttribute("aria-pressed")).toBe("true");
  });

  test("clicking the same preset again removes the block", async ({ page }) => {
    await goto(page);
    const btn = page.locator('.hook-chip[data-preset-id="grid-bg"]');
    await btn.click();
    await wait(150);
    let value = await page.$eval("#hooks-editor", (el) => (el as HTMLTextAreaElement).value);
    expect(value).toContain("preset:grid-bg");
    await btn.click();
    await wait(150);
    value = await page.$eval("#hooks-editor", (el) => (el as HTMLTextAreaElement).value);
    expect(value).not.toContain("preset:grid-bg");
    expect(await btn.getAttribute("aria-pressed")).toBe("false");
  });

  test("preset click keeps the preview SVG rendered", async ({ page }) => {
    await goto(page);
    const btn = page.locator('.hook-chip[data-preset-id="drop-shadow"]');
    await btn.click();
    await wait(300);
    const html = await page.$eval("#preview", (el) => el.innerHTML);
    expect(html).toContain("<svg");
  });

  test("hand-typing a preset block lights up the matching chip", async ({ page }) => {
    await goto(page);
    // Prime it with a known preset source: read chip label to pick an existing one,
    // then click it to grab its source, clear + re-type by hand.
    const btn = page.locator('.hook-chip[data-preset-id="classes"]');
    await btn.click();
    await wait(150);
    const presetSource = await page.$eval("#hooks-editor", (el) => (el as HTMLTextAreaElement).value);
    // Click again to clear, then hand-type.
    await btn.click();
    await wait(150);
    await page.locator("#hooks-editor").fill(presetSource);
    await wait(200);
    expect(await btn.getAttribute("aria-pressed")).toBe("true");
    const classes = await btn.evaluate((el) => el.className);
    expect(classes).toContain("hook-chip--on");
  });
});
