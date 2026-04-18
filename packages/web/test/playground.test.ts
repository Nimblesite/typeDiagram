// [WEB-PLAYGROUND-TEST] Integration tests for the tabbed playground.
// CRITICAL: hooks are optional. Empty hooks tab must cause renderToString to
// be called with NO `hooks` option (not even an empty object).
import { describe, expect, it, beforeEach, vi } from "vitest";
import type * as TypeDiagramCore from "typediagram-core";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const resolveCssPath = (): string => resolve(process.cwd(), "src/styles.css");

const { renderToStringMock } = vi.hoisted(() => ({
  renderToStringMock: vi.fn().mockResolvedValue({ ok: true, value: "<svg>mock</svg>" }),
}));

// Mock typediagram-core — keep the REAL svg/raw helpers (via importActual) so
// the hook editor's JS can produce real SafeSvg values that interoperate with
// any real renderer path that might also load.
vi.mock("typediagram-core", async () => {
  const actual = await vi.importActual<typeof TypeDiagramCore>("typediagram-core");
  return {
    ...actual,
    renderToString: renderToStringMock,
  };
});

import { mountPlayground } from "../src/playground.js";
import { PRESETS } from "../src/hook-presets.js";

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe("[WEB-PLAYGROUND]", () => {
  let container: HTMLElement;

  beforeEach(() => {
    localStorage.clear();
    renderToStringMock.mockClear();
    container = document.createElement("div");
    document.body.innerHTML = "";
    document.body.appendChild(container);
  });

  it("builds source and hooks tabs and a preview pane", () => {
    mountPlayground(container);
    expect(container.querySelector("#editor")).not.toBeNull();
    expect(container.querySelector("#hooks-editor")).not.toBeNull();
    expect(container.querySelectorAll(".pane-tab")).toHaveLength(2);
    expect(container.querySelector("#preview")).not.toBeNull();
  });

  it("source tab is active by default — hooks editor is hidden", () => {
    mountPlayground(container);
    const sourceWrap = container.querySelector('[data-editor="source"]');
    const hooksWrap = container.querySelector('[data-editor="hooks"]');
    expect(sourceWrap?.classList.contains("editor-wrap--hidden")).toBe(false);
    expect(hooksWrap?.classList.contains("editor-wrap--hidden")).toBe(true);
  });

  it("clicking the hooks tab reveals the hooks editor", () => {
    mountPlayground(container);
    const hooksTab = container.querySelector<HTMLButtonElement>('.pane-tab[data-tab="hooks"]');
    hooksTab?.click();
    const hooksWrap = container.querySelector('[data-editor="hooks"]');
    const sourceWrap = container.querySelector('[data-editor="source"]');
    expect(hooksWrap?.classList.contains("editor-wrap--hidden")).toBe(false);
    expect(sourceWrap?.classList.contains("editor-wrap--hidden")).toBe(true);
    expect(hooksTab?.classList.contains("pane-tab--on")).toBe(true);
  });

  it("default (fresh mount, commented-out example) -> renderToString called WITHOUT a hooks option", async () => {
    mountPlayground(container);
    await wait(50);
    expect(renderToStringMock).toHaveBeenCalled();
    const lastCall = renderToStringMock.mock.calls.at(-1);
    const opts = lastCall?.[1] as { hooks?: unknown } | undefined;
    expect(opts?.hooks).toBeUndefined();
  });

  it("typing JS in hooks editor passes a hooks object on next render", async () => {
    mountPlayground(container);
    await wait(50);
    const hooksEditor = container.querySelector<HTMLTextAreaElement>("#hooks-editor");
    expect(hooksEditor).not.toBeNull();
    if (hooksEditor === null) {
      return;
    }
    hooksEditor.value = "hooks.node = (ctx, def) => def;";
    hooksEditor.dispatchEvent(new Event("input", { bubbles: true }));
    await wait(200);
    const lastCall = renderToStringMock.mock.calls.at(-1);
    const opts = lastCall?.[1] as { hooks?: Record<string, unknown> } | undefined;
    expect(opts?.hooks).toBeDefined();
    expect(typeof opts?.hooks?.node).toBe("function");
  });

  it("clearing the hooks editor reverts to NO hooks option", async () => {
    mountPlayground(container);
    const hooksEditor = container.querySelector<HTMLTextAreaElement>("#hooks-editor");
    if (hooksEditor === null) {
      throw new Error("missing hooks editor");
    }
    hooksEditor.value = "hooks.node = (_c, d) => d;";
    hooksEditor.dispatchEvent(new Event("input", { bubbles: true }));
    await wait(200);
    hooksEditor.value = "";
    hooksEditor.dispatchEvent(new Event("input", { bubbles: true }));
    await wait(200);
    const lastCall = renderToStringMock.mock.calls.at(-1);
    const opts = lastCall?.[1] as { hooks?: unknown } | undefined;
    expect(opts?.hooks).toBeUndefined();
  });

  // [WEB-PLAYGROUND-HOOKS-PREFILLED] The hooks textarea starts pre-filled with
  // a commented-out real code example the user can uncomment. No overlay.
  it("hooks textarea is pre-populated with a `//` header + a `/* … */` code block", () => {
    mountPlayground(container);
    const hooksEditor = container.querySelector<HTMLTextAreaElement>("#hooks-editor");
    expect(hooksEditor).not.toBeNull();
    const value = hooksEditor?.value ?? "";
    expect(value.length).toBeGreaterThan(0);
    // Header lines are `//` prose so the docs link renders inline without triggering the block.
    expect(value).toMatch(/^\s*\/\/.*Render hooks/m);
    expect(value).toContain("/docs/render-hooks.html");
    // The hook CODE lives inside a /* … */ block so the user deletes two markers to activate it,
    // instead of stripping `//` from every line.
    const blockMatch = value.match(/\/\*([\s\S]*?)\*\//);
    expect(blockMatch).not.toBeNull();
    if (blockMatch === null) {
      return;
    }
    const blockBody = blockMatch[1] ?? "";
    expect(blockBody).toMatch(/hooks\.(defs|node|row|edge|background|post)/);
  });

  it("no overlay hint element is present — textarea IS the source of truth", () => {
    mountPlayground(container);
    expect(container.querySelector(".hooks-empty-hint")).toBeNull();
    expect(container.querySelector(".hooks-empty-example")).toBeNull();
  });

  it("editor input writes source to localStorage", async () => {
    mountPlayground(container);
    const editor = container.querySelector<HTMLTextAreaElement>("#editor");
    if (editor === null) {
      throw new Error("missing source editor");
    }
    editor.value = "typeDiagram\n  type Persisted { x: Int }";
    editor.dispatchEvent(new Event("input", { bubbles: true }));
    await wait(30);
    expect(localStorage.getItem("td-playground-source")).toContain("Persisted");
  });

  it("mount restores previously-saved source and hooks from localStorage", () => {
    localStorage.setItem("td-playground-source", "typeDiagram\n  type Restored { x: Int }");
    localStorage.setItem("td-playground-hooks", "hooks.node = (_c, d) => d;");
    mountPlayground(container);
    const editor = container.querySelector<HTMLTextAreaElement>("#editor");
    const hooksEditor = container.querySelector<HTMLTextAreaElement>("#hooks-editor");
    expect(editor?.value).toContain("Restored");
    expect(hooksEditor?.value).toContain("hooks.node");
  });

  it("hooks docs path referenced in the pre-filled example resolves to a real built docs entry", async () => {
    mountPlayground(container);
    const hooksEditor = container.querySelector<HTMLTextAreaElement>("#hooks-editor");
    const value = hooksEditor?.value ?? "";
    const match = value.match(/\/docs\/([a-z0-9-]+)\.html/);
    expect(match).not.toBeNull();
    if (match === null) {
      return;
    }
    const slug = match[1];
    const docsModule = (await import("../eleventy/_data/docs.js")) as {
      default: ReadonlyArray<{ slug: string; html: string }>;
    };
    const entry = docsModule.default.find((d) => d.slug === slug);
    expect(entry).toBeDefined();
    expect((entry?.html ?? "").length).toBeGreaterThan(500);
  });

  // [WEB-PLAYGROUND-HOOKS-HIGHLIGHT] The hooks editor has JS syntax highlighting.
  it("hooks editor has a syntax-highlight backdrop that reflects typed JS tokens", async () => {
    mountPlayground(container);
    const hooksEditor = container.querySelector<HTMLTextAreaElement>("#hooks-editor");
    if (hooksEditor === null) {
      throw new Error("missing hooks editor");
    }
    const backdrop = container.querySelector<HTMLElement>("#hooks-backdrop");
    expect(backdrop).not.toBeNull();

    hooksEditor.value = "const x = 1; // comment";
    hooksEditor.dispatchEvent(new Event("input", { bubbles: true }));
    await wait(30);

    const html = backdrop?.innerHTML ?? "";
    // Expect at least one span-based token wrapper indicating the JS highlighter ran.
    expect(html).toMatch(/<span[^>]*class=/);
    // Comment must be tokenized.
    expect(html.toLowerCase()).toContain("comment");
  });

  it("invalid hook code surfaces the error in the diag block; preview still renders", async () => {
    mountPlayground(container);
    const hooksEditor = container.querySelector<HTMLTextAreaElement>("#hooks-editor");
    if (hooksEditor === null) {
      throw new Error("missing hooks editor");
    }
    hooksEditor.value = "hooks.node = ###;";
    hooksEditor.dispatchEvent(new Event("input", { bubbles: true }));
    await wait(200);
    const diag = container.querySelector<HTMLElement>("#hooks-diag");
    expect(diag?.hidden).toBe(false);
    expect((diag?.textContent ?? "").length).toBeGreaterThan(0);
    const preview = container.querySelector("#preview");
    expect(preview?.innerHTML).toContain("mock");
  });
});

describe("[WEB-PLAYGROUND-PRESETS] preset buttons paste code into the hooks editor", () => {
  let container: HTMLElement;

  beforeEach(() => {
    localStorage.clear();
    renderToStringMock.mockClear();
    container = document.createElement("div");
    document.body.innerHTML = "";
    document.body.appendChild(container);
  });

  it("renders one preset button per PRESETS entry", () => {
    mountPlayground(container);
    const buttons = container.querySelectorAll(".hook-chip");
    expect(buttons.length).toBe(PRESETS.length);
  });

  // [WEB-PLAYGROUND-CHIPS-CLICKABLE] Bug: the <textarea> overlay was covering
  // the chip toolbar so clicks went to the textarea instead. The toolbar must
  // sit ABOVE the textarea in the stacking context.
  it("chip toolbar has a higher stacking z-index than the hooks textarea", () => {
    mountPlayground(container);
    // Inject the real stylesheet so getComputedStyle reads our rules.
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/src/styles.css";
    // Parse the file directly — happy-dom doesn't fetch.
    const style = document.createElement("style");
    const css = readFileSync(resolveCssPath(), "utf8");
    style.textContent = css;
    document.head.appendChild(style);

    const toolbar = container.querySelector<HTMLElement>(".hooks-toolbar");
    const textarea = container.querySelector<HTMLTextAreaElement>("#hooks-editor");
    expect(toolbar).not.toBeNull();
    expect(textarea).not.toBeNull();
    if (toolbar === null || textarea === null) {
      return;
    }
    const toolbarZ = parseInt(getComputedStyle(toolbar).zIndex || "0", 10) || 0;
    const textareaZ = parseInt(getComputedStyle(textarea).zIndex || "0", 10) || 0;
    expect(toolbarZ).toBeGreaterThan(textareaZ);
  });

  it("clicking a preset button appends its source block into the hooks editor", async () => {
    mountPlayground(container);
    const hooksEditor = container.querySelector<HTMLTextAreaElement>("#hooks-editor");
    const btn = container.querySelector<HTMLButtonElement>('.hook-chip[data-preset-id="drop-shadow"]');
    const before = hooksEditor?.value ?? "";
    btn?.click();
    await wait(30);
    const after = hooksEditor?.value ?? "";
    expect(after.length).toBeGreaterThan(before.length);
    expect(after).toContain("// --- preset:drop-shadow ---");
    expect(after).toContain("hooks.node");
    expect(btn?.getAttribute("aria-pressed")).toBe("true");
  });

  it("clicking the same preset button a second time removes the block", async () => {
    mountPlayground(container);
    const btn = container.querySelector<HTMLButtonElement>('.hook-chip[data-preset-id="grid-bg"]');
    const hooksEditor = container.querySelector<HTMLTextAreaElement>("#hooks-editor");
    btn?.click();
    await wait(30);
    expect(hooksEditor?.value).toContain("preset:grid-bg");
    btn?.click();
    await wait(30);
    expect(hooksEditor?.value).not.toContain("preset:grid-bg");
    expect(btn?.getAttribute("aria-pressed")).toBe("false");
  });

  it("preset click triggers a render with the resulting hooks object", async () => {
    mountPlayground(container);
    await wait(50);
    renderToStringMock.mockClear();
    const btn = container.querySelector<HTMLButtonElement>('.hook-chip[data-preset-id="drop-shadow"]');
    btn?.click();
    await wait(200);
    expect(renderToStringMock).toHaveBeenCalled();
    const lastCall = renderToStringMock.mock.calls.at(-1);
    const opts = lastCall?.[1] as { hooks?: Record<string, unknown> } | undefined;
    expect(opts?.hooks).toBeDefined();
    expect(opts?.hooks?.defs).toBeTypeOf("function");
    expect(opts?.hooks?.node).toBeTypeOf("function");
  });

  it("editing the hooks textarea by hand re-syncs preset button aria-pressed state", async () => {
    mountPlayground(container);
    const hooksEditor = container.querySelector<HTMLTextAreaElement>("#hooks-editor");
    if (hooksEditor === null) {
      throw new Error("no hooks editor");
    }
    // Hand-type a preset block — the matching chip should light up.
    const preset = PRESETS.find((p) => p.id === "classes");
    if (preset === undefined) {
      throw new Error("classes preset missing");
    }
    hooksEditor.value = preset.source;
    hooksEditor.dispatchEvent(new Event("input", { bubbles: true }));
    await wait(30);
    const btn = container.querySelector<HTMLButtonElement>('.hook-chip[data-preset-id="classes"]');
    expect(btn?.getAttribute("aria-pressed")).toBe("true");
    expect(btn?.classList.contains("hook-chip--on")).toBe(true);
  });
});
