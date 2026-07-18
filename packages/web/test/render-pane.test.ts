// [WEB-RENDER-PANE-TEST] renderPane returns SVG on valid src and diagnostics html on bad src.
import { describe, expect, it, vi } from "vitest";
import { renderPane } from "../src/render-pane.js";

const SMALL = `typeDiagram
  type User { id: UUID }
  union Option<T> { Some { value: T }, None }
`;

describe("[WEB-RENDER-PANE] renderPane", () => {
  it("returns SVG string for valid source", async () => {
    const html = await renderPane(SMALL);
    expect(html).toMatch(/^<svg[\s>]/);
    expect(html).toContain("User");
  });

  it("returns diagnostics block for invalid source", async () => {
    const html = await renderPane("type { bad }");
    expect(html).toMatch(/class="diag"/);
  });

  it("uses dark theme when prefers-color-scheme is dark", async () => {
    const spy = vi.spyOn(window, "matchMedia").mockReturnValue({
      matches: true,
      media: "(prefers-color-scheme: dark)",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      onchange: null,
      dispatchEvent: vi.fn(),
    });
    const html = await renderPane(SMALL);
    expect(html).toMatch(/^<svg[\s>]/);
    // dark theme uses dark node fill color
    expect(html).toContain("#222a3d");
    spy.mockRestore();
  });
});
