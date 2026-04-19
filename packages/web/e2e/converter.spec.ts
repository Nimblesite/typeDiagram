// [WEB-CONVERTER-E2E] Converter page UI — tabs, flip, labels, round-tripping
// through the real typediagram-core parser. Runs on both viewports so the
// responsive layout (stacked editors on mobile) is exercised end-to-end.
import type { Page } from "@playwright/test";
import { expect, test } from "./support/coverage-fixture.js";

// Poll the TD output pane until it contains `marker`. The converter's
// render is debounced (150ms) then async; polling avoids hard-coded sleeps
// that are either flaky (too short) or wasteful (too long).
const waitForTdCode = async (page: Page, marker: string): Promise<void> => {
  await page.waitForFunction((m: string) => {
    const code = document.querySelector("#conv-td code");
    return code?.textContent.includes(m) === true;
  }, marker);
};

// Poll the editor textarea until its value contains a marker (flip/seed
// writes asynchronously after the debounced conversion completes).
const waitForEditorContains = async (page: Page, marker: string): Promise<void> => {
  await page.waitForFunction((m: string) => {
    const ta = document.querySelector<HTMLTextAreaElement>("#conv-editor");
    return ta?.value.includes(m) === true;
  }, marker);
};

// Poll until the editor value changes from a known baseline. Used when the
// exact new content isn't predictable (e.g. after switching language while
// flipped — the seeded source varies by language).
const waitForEditorChange = async (page: Page, from: string): Promise<void> => {
  await page.waitForFunction((baseline: string) => {
    const ta = document.querySelector<HTMLTextAreaElement>("#conv-editor");
    return ta !== null && ta.value !== baseline && ta.value.length > 0;
  }, from);
};

const gotoConverter = async (page: Page): Promise<void> => {
  // Fresh storage every test — splitter ratio + other widgets persist.
  await page.goto("/converter.html");
  await page.evaluate(() => {
    localStorage.clear();
  });
  await page.reload();
  // mountConverter runs on DOMContentLoaded, but the first `run()` is async.
  await page.waitForSelector("#conv-editor");
  await page.waitForFunction(() => {
    const ta = document.querySelector<HTMLTextAreaElement>("#conv-editor");
    return ta?.value.includes("typeDiagram") === true;
  });
};

test.describe("[WEB-CONVERTER]", () => {
  test.beforeEach(async ({ page }) => {
    await gotoConverter(page);
  });

  test("initial layout: tabs, labels, sample text, panels", async ({ page }) => {
    const labels = await page.$$eval(".conv-lang-tab", (tabs) => tabs.map((t) => t.textContent));
    for (const name of ["TypeScript", "Rust", "Python", "Go", "C#", "F#", "Dart", "Protobuf", "PHP"]) {
      expect(labels).toContain(name);
    }
    expect(labels.length).toBe(9);
    expect(await page.$eval(".conv-lang-tab--active", (el) => el.textContent)).toBe("TypeScript");
    expect(await page.$eval("#conv-left-label", (el) => el.textContent)).toBe("typediagram");
    expect(await page.$eval("#conv-right-label", (el) => el.textContent)).toBe("typescript");
    const value = await page.$eval("#conv-editor", (el) => (el as HTMLTextAreaElement).value);
    expect(value).toContain("typeDiagram");
    expect(value).toContain("type ChatRequest");
    await expect(page.locator("#conv-td")).toHaveCount(1);
    await expect(page.locator("#conv-preview")).toHaveCount(1);
    await expect(page.locator("#conv-splitter")).toHaveCount(1);
    await expect(page.locator("#conv-flip")).toHaveCount(1);
  });

  test("switching language updates active tab + right label, keeps TD editor content", async ({ page }) => {
    const before = await page.$eval("#conv-editor", (el) => (el as HTMLTextAreaElement).value);
    await page.locator('[data-lang="rust"]').click();
    expect(await page.$eval('[data-lang="rust"]', (el) => el.classList.contains("conv-lang-tab--active"))).toBe(true);
    expect(await page.$eval('[data-lang="typescript"]', (el) => el.classList.contains("conv-lang-tab--active"))).toBe(
      false
    );
    const after = await page.$eval("#conv-editor", (el) => (el as HTMLTextAreaElement).value);
    expect(after).toBe(before);
    expect(after).toContain("typeDiagram");
    expect(await page.$eval("#conv-right-label", (el) => el.textContent)).toBe("rust");
  });

  test("produces non-empty language source from TD editor; backdrop present", async ({ page }) => {
    await expect(page.locator("#conv-backdrop code")).toHaveCount(1);
    await waitForTdCode(page, "interface");
    const tdText = await page.$eval("#conv-td code", (el) => el.textContent);
    expect(tdText.length).toBeGreaterThan(50);
  });

  test("swaps panel labels when the flip button is clicked", async ({ page }) => {
    await page.locator("#conv-flip").click();
    await expect(page.locator("#conv-flip")).toHaveClass(/conv-flip-btn--active/);
    expect(await page.$eval("#conv-left-label", (el) => el.textContent)).toBe("typescript");
    expect(await page.$eval("#conv-right-label", (el) => el.textContent)).toBe("typediagram");
  });

  test("flipping seeds the editor with generated language source", async ({ page }) => {
    await page.locator("#conv-flip").click();
    await waitForEditorContains(page, "interface");
    const value = await page.$eval("#conv-editor", (el) => (el as HTMLTextAreaElement).value);
    expect(value.length).toBeGreaterThan(50);
  });

  test("Rust + flip fills all three panels (no 'no definitions' error)", async ({ page }) => {
    await page.locator('[data-lang="rust"]').click();
    // Wait for the language switch to propagate to the TD pane before flipping.
    await waitForTdCode(page, "struct");
    await page.locator("#conv-flip").click();
    // After flip, TD pane shows the round-tripped typeDiagram source.
    await waitForTdCode(page, "typeDiagram");

    const editorValue = await page.$eval("#conv-editor", (el) => (el as HTMLTextAreaElement).value);
    expect(editorValue.length).toBeGreaterThan(0);

    const preview = await page.$eval("#conv-preview", (el) => el.innerHTML);
    expect(preview).toContain("<svg");
    expect(preview).not.toContain("No Rust type definitions found");
  });

  test("flipping back restores the last known TD source", async ({ page }) => {
    const original = await page.$eval("#conv-editor", (el) => (el as HTMLTextAreaElement).value);
    await page.locator("#conv-flip").click();
    await waitForEditorContains(page, "interface");
    await page.locator("#conv-flip").click();
    await waitForEditorContains(page, "type ChatRequest");
    const restored = await page.$eval("#conv-editor", (el) => (el as HTMLTextAreaElement).value);
    expect(restored).toBe(original);
  });

  test("scrolling the editor (flipped) mirrors scrollTop onto the backdrop", async ({ page }) => {
    await page.locator("#conv-flip").click();
    await waitForEditorContains(page, "interface");
    await page.evaluate(() => {
      const ta = document.querySelector<HTMLTextAreaElement>("#conv-editor");
      if (ta === null) {
        throw new Error("no editor");
      }
      ta.value += "\n" + Array.from({ length: 200 }, (_, i) => `// line ${String(i)}`).join("\n");
      ta.dispatchEvent(new Event("input", { bubbles: true }));
      ta.scrollTop = 200;
      ta.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    // scroll sync is synchronous (listener fires inline) — no poll required,
    // but waitForFunction survives any reflow timing differences.
    await page.waitForFunction(() => (document.querySelector<HTMLElement>("#conv-backdrop")?.scrollTop ?? 0) === 200);
  });

  test("scrolling the editor mirrors scrollTop onto the backdrop", async ({ page }) => {
    await page.evaluate(() => {
      const ta = document.querySelector<HTMLTextAreaElement>("#conv-editor");
      if (ta === null) {
        throw new Error("no editor");
      }
      ta.value = Array.from({ length: 200 }, (_, i) => `// line ${String(i)}`).join("\n");
      ta.dispatchEvent(new Event("input", { bubbles: true }));
      ta.scrollTop = 300;
      ta.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    await page.waitForFunction(() => (document.querySelector<HTMLElement>("#conv-backdrop")?.scrollTop ?? 0) === 300);
  });

  test("clicks inside the lang-tab bar but not on a tab are ignored", async ({ page }) => {
    const beforeActive = await page.$eval(".conv-lang-tab--active", (el) => el.textContent);
    await page.evaluate(() => {
      const bar = document.querySelector<HTMLElement>(".conv-lang-tabs");
      if (bar === null) {
        throw new Error("no tab bar");
      }
      bar.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    // No state change expected — we need a brief idle window to prove that.
    // Poll the TD code pane once to flush any pending debounced render, then
    // confirm the active tab is still the same.
    await waitForTdCode(page, "interface");
    const afterActive = await page.$eval(".conv-lang-tab--active", (el) => el.textContent);
    expect(afterActive).toBe(beforeActive);
  });

  test("switching language while flipped re-seeds the editor (seedLanguageEditor path)", async ({ page }) => {
    await page.locator("#conv-flip").click();
    await waitForEditorContains(page, "interface");
    const beforeFlipValue = await page.$eval("#conv-editor", (el) => (el as HTMLTextAreaElement).value);
    await page.locator('[data-lang="rust"]').click();
    await waitForEditorChange(page, beforeFlipValue);
    const afterFlipValue = await page.$eval("#conv-editor", (el) => (el as HTMLTextAreaElement).value);
    expect(afterFlipValue.length).toBeGreaterThan(0);
    expect(await page.$eval("#conv-right-label", (el) => el.textContent)).toBe("typediagram");
  });
});
