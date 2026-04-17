// [VSCODE-MD-PLUGIN-TEST] Verifies the markdown-it fence renderer swaps ```typediagram
// blocks with inline SVG using the core sync renderer — same integration VS Code's
// markdown preview uses at runtime.
import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import MarkdownIt from "markdown-it";
import { warmupSyncRender } from "typediagram-core";
import { typediagramMarkdownItPlugin } from "../src/markdown-it-plugin.js";
import type { MarkdownIt as MdShape } from "../src/markdown-it-plugin.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXAMPLE_DOC = resolve(__dirname, "../examples/doc.md");

describe("[VSCODE-MD-PLUGIN] typediagramMarkdownItPlugin", () => {
  beforeAll(async () => {
    await warmupSyncRender();
  });

  const render = (source: string): string => {
    const md = new MarkdownIt();
    typediagramMarkdownItPlugin(md as unknown as MdShape);
    return md.render(source);
  };

  it("renders the example doc.md typediagram fence to inline SVG", () => {
    const src = readFileSync(EXAMPLE_DOC, "utf8");
    const html = render(src);
    expect(html).toContain("<svg");
    expect(html).toContain('class="typediagram"');
    expect(html).not.toContain("```typediagram");
    // And prose around it still renders
    expect(html.toLowerCase()).toContain("something");
  });

  it("is case-insensitive — lowercase typediagram", () => {
    const html = render("```typediagram\ntype X { a: Int }\n```");
    expect(html).toContain("<svg");
  });

  it("is case-insensitive — CamelCase typeDiagram", () => {
    const html = render("```typeDiagram\ntype X { a: Int }\n```");
    expect(html).toContain("<svg");
  });

  it("is case-insensitive — UPPERCASE TYPEDIAGRAM", () => {
    const html = render("```TYPEDIAGRAM\ntype X { a: Int }\n```");
    expect(html).toContain("<svg");
  });

  it("passes through non-typediagram fences to the default fence renderer", () => {
    const html = render("```js\nconsole.log(1)\n```");
    expect(html).toContain("console.log");
    expect(html).not.toContain("<svg");
  });

  it("emits an error block for a bad fence instead of an SVG", () => {
    const html = render("```typediagram\ntype X { @bad }\n```");
    expect(html).not.toContain("<svg");
    expect(html).toContain("typediagram-error");
    expect(html).toContain("typediagram error");
  });

  it("escapes HTML in the source to prevent XSS inside error blocks", () => {
    const html = render("```typediagram\ntype X { <script>: String }\n```");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("handles multiple typediagram fences in one doc", () => {
    const html = render("```typediagram\ntype A { x: Int }\n```\n\n```typediagram\ntype B { y: Int }\n```");
    const svgCount = (html.match(/<svg/g) ?? []).length;
    expect(svgCount).toBe(2);
  });

  it("handles missing previous fence rule gracefully (emits empty string)", () => {
    // Force-delete markdown-it's default fence rule so previousFence is undefined.
    const md = new MarkdownIt();
    // @ts-expect-error — deliberately simulating an md instance with no default fence renderer
    delete md.renderer.rules.fence;
    typediagramMarkdownItPlugin(md as unknown as MdShape);
    // Non-typediagram fence should now produce empty string (no previous renderer to fall back to)
    const html = md.render("```js\nconsole.log(1)\n```");
    expect(html).not.toContain("console.log");
    // Typediagram fence still works
    const html2 = md.render("```typediagram\ntype X { a: Int }\n```");
    expect(html2).toContain("<svg");
  });
});
