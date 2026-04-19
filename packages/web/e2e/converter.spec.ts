// [WEB-CONVERTER-E2E] Converter page UI — tabs, flip, labels, round-tripping
// through the real typediagram-core parser. Runs on both viewports so the
// responsive layout (stacked editors on mobile) is exercised end-to-end.
import { expect, test } from "./support/coverage-fixture.js";

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const gotoConverter = async (page: import("@playwright/test").Page): Promise<void> => {
  await page.goto("/converter.html");
  // mountConverter runs on DOMContentLoaded, but the first `run()` is async.
  await page.waitForSelector("#conv-editor");
  await page.waitForFunction(() => {
    const ta = document.querySelector<HTMLTextAreaElement>("#conv-editor");
    return ta !== null && ta.value.includes("typeDiagram");
  });
};

test.describe("[WEB-CONVERTER]", () => {
  test.beforeEach(async ({ page }) => {
    await gotoConverter(page);
  });

  test("renders a tab for every supported language", async ({ page }) => {
    const labels = await page.$$eval(".conv-lang-tab", (tabs) => tabs.map((t) => t.textContent));
    for (const name of ["TypeScript", "Rust", "Python", "Go", "C#", "F#", "Dart", "Protobuf", "PHP"]) {
      expect(labels).toContain(name);
    }
    expect(labels.length).toBe(9);
  });

  test("sets TypeScript as the default active tab", async ({ page }) => {
    const active = await page.$eval(".conv-lang-tab--active", (el) => el.textContent);
    expect(active).toBe("TypeScript");
  });

  test("starts with typeDiagram on left label, target language on right", async ({ page }) => {
    const left = await page.$eval("#conv-left-label", (el) => el.textContent);
    const right = await page.$eval("#conv-right-label", (el) => el.textContent);
    expect(left).toBe("typediagram");
    expect(right).toBe("typescript");
  });

  test("loads the typeDiagram sample into the editor on startup", async ({ page }) => {
    const value = await page.$eval("#conv-editor", (el) => (el as HTMLTextAreaElement).value);
    expect(value).toContain("typeDiagram");
    expect(value).toContain("type ChatRequest");
  });

  test("renders the output area", async ({ page }) => {
    await expect(page.locator("#conv-td")).toHaveCount(1);
  });

  test("renders the diagram preview area", async ({ page }) => {
    await expect(page.locator("#conv-preview")).toHaveCount(1);
  });

  test("renders the splitter between the two input panels", async ({ page }) => {
    await expect(page.locator("#conv-splitter")).toHaveCount(1);
  });

  test("renders the flip button", async ({ page }) => {
    await expect(page.locator("#conv-flip")).toHaveCount(1);
  });

  test("switches the active tab on click", async ({ page }) => {
    await page.locator('[data-lang="rust"]').click();
    const classes = await page.$eval('[data-lang="rust"]', (el) => el.className);
    expect(classes).toContain("conv-lang-tab--active");
    const tsClasses = await page.$eval('[data-lang="typescript"]', (el) => el.className);
    expect(tsClasses).not.toContain("conv-lang-tab--active");
  });

  test("keeps the typeDiagram editor content when switching languages (unflipped)", async ({ page }) => {
    const before = await page.$eval("#conv-editor", (el) => (el as HTMLTextAreaElement).value);
    await page.locator('[data-lang="rust"]').click();
    const after = await page.$eval("#conv-editor", (el) => (el as HTMLTextAreaElement).value);
    expect(after).toBe(before);
    expect(after).toContain("typeDiagram");
  });

  test("updates the right label when switching languages (unflipped)", async ({ page }) => {
    await page.locator('[data-lang="rust"]').click();
    const right = await page.$eval("#conv-right-label", (el) => el.textContent);
    expect(right).toBe("rust");
  });

  test("produces non-empty language source from the TD editor", async ({ page }) => {
    // Wait for initial debounced render (150ms debounce).
    await wait(250);
    const tdText = await page.$eval("#conv-td code", (el) => el.textContent ?? "");
    expect(tdText.length).toBeGreaterThan(50);
    expect(tdText).toContain("interface");
  });

  test("creates a backdrop for syntax highlighting", async ({ page }) => {
    await expect(page.locator("#conv-backdrop code")).toHaveCount(1);
  });

  test("swaps panel labels when the flip button is clicked", async ({ page }) => {
    await page.locator("#conv-flip").click();
    await wait(200);
    const left = await page.$eval("#conv-left-label", (el) => el.textContent);
    const right = await page.$eval("#conv-right-label", (el) => el.textContent);
    expect(left).toBe("typescript");
    expect(right).toBe("typediagram");
    const classes = await page.$eval("#conv-flip", (el) => el.className);
    expect(classes).toContain("conv-flip-btn--active");
  });

  test("flipping seeds the editor with generated language source", async ({ page }) => {
    await page.locator("#conv-flip").click();
    await wait(300);
    const value = await page.$eval("#conv-editor", (el) => (el as HTMLTextAreaElement).value);
    expect(value.length).toBeGreaterThan(50);
    expect(value).toContain("interface");
  });

  test("Rust + flip fills all three panels (no 'no definitions' error)", async ({ page }) => {
    await page.locator('[data-lang="rust"]').click();
    await wait(250);
    await page.locator("#conv-flip").click();
    await wait(300);

    const editorValue = await page.$eval("#conv-editor", (el) => (el as HTMLTextAreaElement).value);
    expect(editorValue.length).toBeGreaterThan(0);

    const tdText = await page.$eval("#conv-td code", (el) => el.textContent ?? "");
    expect(tdText.length).toBeGreaterThan(0);
    expect(tdText).toContain("typeDiagram");

    const preview = await page.$eval("#conv-preview", (el) => el.innerHTML);
    expect(preview).toContain("<svg");
    expect(preview).not.toContain("No Rust type definitions found");
  });

  test("flipping back restores the last known TD source", async ({ page }) => {
    const original = await page.$eval("#conv-editor", (el) => (el as HTMLTextAreaElement).value);
    await page.locator("#conv-flip").click();
    await wait(300);
    await page.locator("#conv-flip").click();
    await wait(300);
    const restored = await page.$eval("#conv-editor", (el) => (el as HTMLTextAreaElement).value);
    expect(restored).toBe(original);
  });
});
