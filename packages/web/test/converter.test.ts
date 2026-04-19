// [WEB-CONVERTER-TEST] Tests for the converter page component.
import { describe, expect, it, beforeEach, vi } from "vitest";

// Mock the converter-render module since it depends on the full typediagram package
vi.mock("../src/converter-render.js", () => ({
  convertFromTd: vi.fn().mockResolvedValue({
    tdSource: "export interface Foo {\n  name: string;\n}\n",
    svgHtml: "<svg></svg>",
  }),
  convertSource: vi.fn().mockResolvedValue({
    tdSource: "typeDiagram\n\ntype Foo {\n  name: String\n}\n",
    svgHtml: "<svg></svg>",
  }),
}));

import { mountConverter } from "../src/converter.js";
import { convertFromTd, convertSource } from "../src/converter-render.js";

describe("[WEB-CONVERTER] mountConverter()", () => {
  let container: HTMLElement;

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  it("renders a tab for every supported language", async () => {
    mountConverter(container);
    await vi.dynamicImportSettled();

    const tabs = Array.from(container.querySelectorAll<HTMLElement>(".conv-lang-tab"));
    const labels: (string | null)[] = tabs.map((t: HTMLElement) => t.textContent);
    expect(labels).toContain("TypeScript");
    expect(labels).toContain("Rust");
    expect(labels).toContain("Python");
    expect(labels).toContain("Go");
    expect(labels).toContain("C#");
    expect(labels).toContain("F#");
    expect(labels).toContain("Dart");
    expect(labels).toContain("Protobuf");
    expect(tabs.length).toBe(labels.length);
  });

  it("sets TypeScript as the default active tab", () => {
    mountConverter(container);

    const activeTab = container.querySelector(".conv-lang-tab--active");
    expect(activeTab?.textContent).toBe("TypeScript");
  });

  it("starts with typeDiagram on the left and target language on the right", () => {
    mountConverter(container);

    const leftLabel = container.querySelector("#conv-left-label");
    const rightLabel = container.querySelector("#conv-right-label");
    expect(leftLabel?.textContent).toBe("typediagram");
    expect(rightLabel?.textContent).toBe("typescript");
  });

  it("loads the single typeDiagram sample into the editor on startup", () => {
    mountConverter(container);

    const editor = container.querySelector<HTMLTextAreaElement>("#conv-editor");
    expect(editor).toBeTruthy();
    expect(editor?.value).toContain("typeDiagram");
    expect(editor?.value).toContain("type ChatRequest");
  });

  it("renders output area", () => {
    mountConverter(container);

    const tdOutput = container.querySelector("#conv-td");
    expect(tdOutput).toBeTruthy();
  });

  it("renders preview area", () => {
    mountConverter(container);

    const preview = container.querySelector("#conv-preview");
    expect(preview).toBeTruthy();
  });

  it("renders a splitter between the two panels", () => {
    mountConverter(container);

    const splitter = container.querySelector("#conv-splitter");
    expect(splitter).toBeTruthy();
  });

  it("switches active tab on click", async () => {
    mountConverter(container);

    const rustTab = container.querySelector('[data-lang="rust"]') as HTMLButtonElement;
    rustTab.click();

    await vi.dynamicImportSettled();

    expect(rustTab.classList.contains("conv-lang-tab--active")).toBe(true);

    const tsTab = container.querySelector('[data-lang="typescript"]');
    expect(tsTab).not.toBeNull();
    expect(tsTab?.classList.contains("conv-lang-tab--active")).toBe(false);
  });

  it("keeps the typeDiagram editor content when switching languages (unflipped)", () => {
    mountConverter(container);

    const editorBefore = container.querySelector<HTMLTextAreaElement>("#conv-editor");
    const originalValue = editorBefore?.value;

    const rustTab = container.querySelector('[data-lang="rust"]') as HTMLButtonElement;
    rustTab.click();

    const editorAfter = container.querySelector<HTMLTextAreaElement>("#conv-editor");
    expect(editorAfter?.value).toBe(originalValue);
    expect(editorAfter?.value).toContain("typeDiagram");
  });

  it("updates the right label when switching languages (unflipped)", () => {
    mountConverter(container);

    const rustTab = container.querySelector('[data-lang="rust"]') as HTMLButtonElement;
    rustTab.click();

    const rightLabel = container.querySelector("#conv-right-label");
    expect(rightLabel?.textContent).toBe("rust");
  });

  it("calls convertFromTd on mount (unflipped)", async () => {
    mountConverter(container);
    await new Promise((r) => setTimeout(r, 10));

    expect(convertFromTd).toHaveBeenCalled();
    expect(convertSource).not.toHaveBeenCalled();
  });

  it("creates backdrop for syntax highlighting", () => {
    mountConverter(container);

    const backdrop = container.querySelector("#conv-backdrop");
    expect(backdrop).toBeTruthy();
    expect(backdrop?.querySelector("code")).toBeTruthy();
  });

  it("renders flip button", () => {
    mountConverter(container);

    const flipBtn = container.querySelector("#conv-flip");
    expect(flipBtn).toBeTruthy();
  });

  it("swaps panel labels when the flip button is clicked", async () => {
    mountConverter(container);

    const flipBtn = container.querySelector<HTMLButtonElement>("#conv-flip");
    const leftLabel = container.querySelector("#conv-left-label");
    const rightLabel = container.querySelector("#conv-right-label");
    expect(flipBtn).not.toBeNull();
    expect(leftLabel).not.toBeNull();
    expect(rightLabel).not.toBeNull();
    if (flipBtn === null || leftLabel === null || rightLabel === null) {
      return;
    }

    expect(leftLabel.textContent).toBe("typediagram");
    expect(rightLabel.textContent).toBe("typescript");

    flipBtn.click();
    await new Promise((r) => setTimeout(r, 10));

    expect(leftLabel.textContent).toBe("typescript");
    expect(rightLabel.textContent).toBe("typediagram");
    expect(flipBtn.classList.contains("conv-flip-btn--active")).toBe(true);
  });

  it("calls convertSource when flipped", async () => {
    mountConverter(container);
    await new Promise((r) => setTimeout(r, 10));
    vi.clearAllMocks();

    const flipBtn = container.querySelector<HTMLButtonElement>("#conv-flip");
    expect(flipBtn).not.toBeNull();
    if (flipBtn === null) {
      return;
    }
    flipBtn.click();
    await new Promise((r) => setTimeout(r, 10));

    expect(convertSource).toHaveBeenCalled();
  });

  it("seeds the editor with the generated language source when flipping (no saved content)", async () => {
    mountConverter(container);
    await new Promise((r) => setTimeout(r, 10));

    const flipBtn = container.querySelector<HTMLButtonElement>("#conv-flip");
    expect(flipBtn).not.toBeNull();
    if (flipBtn === null) {
      return;
    }
    flipBtn.click();
    await new Promise((r) => setTimeout(r, 10));

    const editor = container.querySelector<HTMLTextAreaElement>("#conv-editor");
    expect(editor).not.toBeNull();
    // The mocked convertFromTd returns this TS source; after flipping, the
    // editor should be seeded with it rather than being cleared to empty.
    expect(editor?.value).toBe("export interface Foo {\n  name: string;\n}\n");
  });

  it("after tapping Rust then flip, all three panels show generated content", async () => {
    // Steps from bug report:
    //   1. Tap Rust
    //   2. Tap flip
    // Expected: editor, output, and diagram panels all have generated content.
    mountConverter(container);
    await new Promise((r) => setTimeout(r, 10));

    const rustTab = container.querySelector<HTMLButtonElement>('[data-lang="rust"]');
    expect(rustTab).not.toBeNull();
    if (rustTab === null) {
      return;
    }
    rustTab.click();
    await new Promise((r) => setTimeout(r, 10));

    const flipBtn = container.querySelector<HTMLButtonElement>("#conv-flip");
    expect(flipBtn).not.toBeNull();
    if (flipBtn === null) {
      return;
    }
    flipBtn.click();
    await new Promise((r) => setTimeout(r, 10));

    // Panel 1: the editor (left side, now in flipped/language mode) must contain
    // the generated language source — NOT be empty and NOT trigger a
    // "No Rust type definitions found" error.
    const editor = container.querySelector<HTMLTextAreaElement>("#conv-editor");
    expect(editor).not.toBeNull();
    expect(editor?.value.length).toBeGreaterThan(0);

    // Panel 2: the right-side output must show typeDiagram source derived from
    // the editor content (via convertSource, since we're flipped).
    expect(convertSource).toHaveBeenCalled();
    const tdOutput = container.querySelector("#conv-td code");
    expect(tdOutput).not.toBeNull();
    expect(tdOutput?.textContent?.length ?? 0).toBeGreaterThan(0);
    expect(tdOutput?.textContent).toContain("typeDiagram");

    // Panel 3: the diagram preview must contain an SVG, not an error message.
    const preview = container.querySelector("#conv-preview");
    expect(preview).not.toBeNull();
    expect(preview?.innerHTML ?? "").toContain("<svg");
    expect(preview?.textContent ?? "").not.toContain("No Rust type definitions found");
  });
});
