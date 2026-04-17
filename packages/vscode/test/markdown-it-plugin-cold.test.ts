// [VSCODE-MD-PLUGIN-COLD] Proves the plugin emits a placeholder when sync render is
// not yet warm. Mocks typediagram-core so isSyncRenderReady returns false.
import { describe, expect, it, vi } from "vitest";
import MarkdownIt from "markdown-it";
import * as mock from "./vscode-mock.js";

vi.mock("vscode", () => mock);

vi.mock("typediagram-core", () => ({
  isSyncRenderReady: () => false,
  renderToStringSync: () => {
    throw new Error("should not be called when cold");
  },
  warmupSyncRender: async () => {},
}));

describe("[VSCODE-MD-PLUGIN-COLD] renders placeholder before warmup", () => {
  it("emits a typediagram-pending placeholder, NOT an SVG", async () => {
    const { typediagramMarkdownItPlugin, type: _ } = await import("../src/markdown-it-plugin.js");
    void _;
    const md = new MarkdownIt();
    typediagramMarkdownItPlugin(md as unknown as Parameters<typeof typediagramMarkdownItPlugin>[0]);
    const html = md.render("```typediagram\ntype X { a: Int }\n```");
    expect(html).toContain("typediagram-pending");
    expect(html).toContain("data-typediagram-source");
    expect(html).not.toContain("<svg");
  });

  it("escapes HTML inside the placeholder source attribute", async () => {
    const { typediagramMarkdownItPlugin } = await import("../src/markdown-it-plugin.js");
    const md = new MarkdownIt();
    typediagramMarkdownItPlugin(md as unknown as Parameters<typeof typediagramMarkdownItPlugin>[0]);
    const html = md.render('```typediagram\ntype X { a: "<b>hi</b>" }\n```');
    expect(html).toContain("typediagram-pending");
    expect(html).not.toContain("<b>hi</b>");
    expect(html).toContain("&lt;b&gt;");
  });
});
