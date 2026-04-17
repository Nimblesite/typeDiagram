// [WEB-PLAYGROUND-TEST] Integration test for the mountPlayground component.
import { describe, expect, it, beforeEach, vi } from "vitest";

// Mock typediagram to avoid pulling the full framework in this DOM-focused test.
// svg / raw must still work so hook-presets.ts (imported by playground) can load.
const { renderToStringMock } = vi.hoisted(() => ({
  renderToStringMock: vi.fn().mockResolvedValue({ ok: true, value: "<svg>mock</svg>" }),
}));
vi.mock("typediagram-core", () => ({
  renderToString: renderToStringMock,
  parser: { formatDiagnostics: (d: unknown[]) => d.map(String).join("\n") },
  svg: (strings: TemplateStringsArray, ..._values: unknown[]) => ({
    __brand: "SafeSvg",
    value: strings.join(""),
  }),
  raw: (s: string) => ({ __brand: "SafeSvg", value: s }),
}));

import { mountPlayground } from "../src/playground.js";
import { PRESETS } from "../src/hook-presets.js";

describe("[WEB-PLAYGROUND]", () => {
  let container: HTMLElement;

  beforeEach(() => {
    localStorage.clear();
    renderToStringMock.mockClear();
    container = document.createElement("div");
    document.body.innerHTML = "";
    document.body.appendChild(container);
  });

  it("builds the DOM structure with editor, splitter, and preview", () => {
    mountPlayground(container);
    expect(container.querySelector("#editor")).not.toBeNull();
    expect(container.querySelector("#splitter")).not.toBeNull();
    expect(container.querySelector("#preview")).not.toBeNull();
    expect(container.querySelector("#backdrop")).not.toBeNull();
  });

  it("adds playground class to container", () => {
    mountPlayground(container);
    expect(container.classList.contains("playground")).toBe(true);
  });

  it("populates editor with initial example text", () => {
    mountPlayground(container);
    const editor = container.querySelector<HTMLTextAreaElement>("#editor");
    expect(editor).not.toBeNull();
    expect(editor?.value).toContain("typeDiagram");
    expect(editor?.value).toContain("ChatRequest");
  });

  it("renders preview on mount", async () => {
    mountPlayground(container);
    // Allow async render to settle
    await new Promise((r) => setTimeout(r, 50));
    const preview = container.querySelector("#preview");
    expect(preview).not.toBeNull();
    expect(preview?.innerHTML).toContain("mock");
  });

  it("re-renders on editor input", async () => {
    mountPlayground(container);
    await new Promise((r) => setTimeout(r, 50));

    const editor = container.querySelector<HTMLTextAreaElement>("#editor");
    expect(editor).not.toBeNull();
    if (editor === null) {
      return;
    }
    editor.value = "typeDiagram\n  type Foo { x: Int }";
    editor.dispatchEvent(new Event("input", { bubbles: true }));

    // Wait for debounce (120ms) + render
    await new Promise((r) => setTimeout(r, 200));
    const preview = container.querySelector("#preview");
    expect(preview?.innerHTML).toContain("mock");
  });

  it("creates splitter and viewport inside preview", () => {
    mountPlayground(container);
    const preview = container.querySelector("#preview");
    expect(preview).not.toBeNull();
    expect(preview?.querySelector(".viewport-wrapper")).not.toBeNull();
  });

  it("creates editor pane labels", () => {
    mountPlayground(container);
    const labels = container.querySelectorAll(".pane-label");
    expect(labels.length).toBe(2);
    expect(labels[0]?.textContent).toBe("source");
    expect(labels[1]?.textContent).toBe("preview");
  });
});

describe("[WEB-PLAYGROUND-HOOK-CHIPS] hook preset chips", () => {
  let container: HTMLElement;

  beforeEach(() => {
    localStorage.clear();
    renderToStringMock.mockClear();
    container = document.createElement("div");
    document.body.innerHTML = "";
    document.body.appendChild(container);
  });

  it("renders one chip per registered preset", () => {
    mountPlayground(container);
    const chips = container.querySelectorAll(".hook-chip");
    expect(chips.length).toBe(PRESETS.length);
    for (const p of PRESETS) {
      const chip = container.querySelector(`.hook-chip[data-preset-id="${p.id}"]`);
      expect(chip).not.toBeNull();
      expect(chip?.textContent).toBe(p.label);
    }
  });

  it("chips start unselected — initial render passes NO hooks (hooks are optional)", async () => {
    mountPlayground(container);
    await new Promise((r) => setTimeout(r, 50));
    expect(renderToStringMock).toHaveBeenCalled();
    const lastCall = renderToStringMock.mock.calls[renderToStringMock.mock.calls.length - 1];
    const opts = lastCall?.[1] as { hooks?: unknown } | undefined;
    expect(opts?.hooks).toBeUndefined();
  });

  it("clicking a chip re-renders WITH a hooks option", async () => {
    mountPlayground(container);
    await new Promise((r) => setTimeout(r, 50));
    renderToStringMock.mockClear();
    const chip = container.querySelector<HTMLButtonElement>(`.hook-chip[data-preset-id="drop-shadow"]`);
    expect(chip).not.toBeNull();
    chip?.click();
    await new Promise((r) => setTimeout(r, 20));
    expect(renderToStringMock).toHaveBeenCalled();
    const lastCall = renderToStringMock.mock.calls[renderToStringMock.mock.calls.length - 1];
    const opts = lastCall?.[1] as { hooks?: Record<string, unknown> } | undefined;
    expect(opts?.hooks).toBeDefined();
    // drop-shadow preset supplies defs + node hooks
    expect(opts?.hooks?.defs).toBeTypeOf("function");
    expect(opts?.hooks?.node).toBeTypeOf("function");
  });

  it("toggling a chip OFF reverts to no-hooks render", async () => {
    mountPlayground(container);
    await new Promise((r) => setTimeout(r, 50));
    const chip = container.querySelector<HTMLButtonElement>(`.hook-chip[data-preset-id="drop-shadow"]`);
    chip?.click();
    await new Promise((r) => setTimeout(r, 20));
    chip?.click();
    await new Promise((r) => setTimeout(r, 20));
    const lastCall = renderToStringMock.mock.calls[renderToStringMock.mock.calls.length - 1];
    const opts = lastCall?.[1] as { hooks?: unknown } | undefined;
    expect(opts?.hooks).toBeUndefined();
  });

  it("chip toggles aria-pressed and td-chip--on class", () => {
    mountPlayground(container);
    const chip = container.querySelector<HTMLButtonElement>(`.hook-chip[data-preset-id="grid-bg"]`);
    expect(chip).not.toBeNull();
    expect(chip?.getAttribute("aria-pressed")).toBe("false");
    expect(chip?.classList.contains("hook-chip--on")).toBe(false);
    chip?.click();
    expect(chip?.getAttribute("aria-pressed")).toBe("true");
    expect(chip?.classList.contains("hook-chip--on")).toBe(true);
    chip?.click();
    expect(chip?.getAttribute("aria-pressed")).toBe("false");
    expect(chip?.classList.contains("hook-chip--on")).toBe(false);
  });

  it("every chip has a tooltip (title) matching its blurb", () => {
    mountPlayground(container);
    for (const p of PRESETS) {
      const chip = container.querySelector<HTMLButtonElement>(`.hook-chip[data-preset-id="${p.id}"]`);
      expect(chip?.title).toBe(p.blurb);
    }
  });
});
