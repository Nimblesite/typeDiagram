// [VSCODE-MD-PLUGIN-TEST] Verifies the markdown-it fence renderer swaps ```typediagram
// blocks with inline SVG using the core sync renderer — same integration VS Code's
// markdown preview uses at runtime.
import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import MarkdownIt from "markdown-it";
import { warmupSyncRender } from "typediagram-core";
import * as mock from "./vscode-mock.js";
import { typediagramMarkdownItPlugin, setPluginLogger } from "../src/markdown-it-plugin.js";
import type { MarkdownIt as MdShape } from "../src/markdown-it-plugin.js";

vi.mock("vscode", () => mock);

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXAMPLE_DOC = resolve(__dirname, "../examples/spec.md");

describe("[VSCODE-MD-PLUGIN] typediagramMarkdownItPlugin", () => {
  beforeAll(async () => {
    await warmupSyncRender();
  });

  const render = (source: string): string => {
    const md = new MarkdownIt();
    typediagramMarkdownItPlugin(md as unknown as MdShape);
    return md.render(source);
  };

  it("renders the example spec.md typediagram fence to inline SVG", () => {
    const src = readFileSync(EXAMPLE_DOC, "utf8");
    const html = render(src);
    expect(html).toContain("<svg");
    expect(html).toContain('class="typediagram"');
    expect(html).not.toContain("```typediagram");
    // And prose around it still renders
    expect(html.toLowerCase()).toContain("specification");
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

  it("logs a render event when a typediagram fence is processed", () => {
    const entries: Array<{ level: string; msg: string; fields: Record<string, unknown> }> = [];
    const capture = {
      trace: () => {},
      debug: (msg: string, fields?: Record<string, unknown>) =>
        entries.push({ level: "debug", msg, fields: fields ?? {} }),
      info: (msg: string, fields?: Record<string, unknown>) =>
        entries.push({ level: "info", msg, fields: fields ?? {} }),
      warn: (msg: string, fields?: Record<string, unknown>) =>
        entries.push({ level: "warn", msg, fields: fields ?? {} }),
      error: (msg: string, fields?: Record<string, unknown>) =>
        entries.push({ level: "error", msg, fields: fields ?? {} }),
      child: () => capture,
    };

    setPluginLogger(capture as never);
    render("```typediagram\ntype X { a: Int }\n```");
    const renderLog = entries.find((e) => e.msg === "rendered typediagram fence to SVG");
    expect(renderLog).toBeDefined();
    expect(renderLog?.level).toBe("info");
    expect(renderLog?.fields["svgLength"]).toBeGreaterThan(100);
    expect(typeof renderLog?.fields["elapsedMs"]).toBe("number");
    const invokeLog = entries.find((e) => e.msg === "fence rule invoked");
    expect(invokeLog).toBeDefined();
    expect(invokeLog?.fields["matches"]).toBe(true);
    expect(invokeLog?.fields["info"]).toBe("typediagram");
  });

  it("uses the overridden plugin logger after setPluginLogger", () => {
    const entries: Array<{ msg: string }> = [];
    const capture = {
      trace: () => {},
      debug: (msg: string) => entries.push({ msg }),
      info: (msg: string) => entries.push({ msg }),
      warn: (msg: string) => entries.push({ msg }),
      error: (msg: string) => entries.push({ msg }),
      child: () => capture,
    };
    setPluginLogger(capture as never);
    render("```typediagram\ntype Z { a: Int }\n```");
    // The overridden capture logger received logs (not the lazy channel one)
    expect(entries.some((e) => e.msg === "plugin installed on markdown-it instance")).toBe(true);
    expect(entries.some((e) => e.msg === "rendered typediagram fence to SVG")).toBe(true);
  });

  it("logs an error event when a fence fails to render", () => {
    const entries: Array<{ level: string; msg: string; fields: Record<string, unknown> }> = [];
    const capture = {
      trace: () => {},
      debug: (msg: string, fields?: Record<string, unknown>) =>
        entries.push({ level: "debug", msg, fields: fields ?? {} }),
      info: (msg: string, fields?: Record<string, unknown>) =>
        entries.push({ level: "info", msg, fields: fields ?? {} }),
      warn: (msg: string, fields?: Record<string, unknown>) =>
        entries.push({ level: "warn", msg, fields: fields ?? {} }),
      error: (msg: string, fields?: Record<string, unknown>) =>
        entries.push({ level: "error", msg, fields: fields ?? {} }),
      child: () => capture,
    };

    setPluginLogger(capture as never);
    render("```typediagram\ntype X { @bad }\n```");
    const errLog = entries.find((e) => e.msg === "typediagram render failed");
    expect(errLog).toBeDefined();
    expect(errLog?.level).toBe("error");
    expect(typeof errLog?.fields["msg"]).toBe("string");
  });

  it("logs via lazy Output Channel when setPluginLogger was never called", async () => {
    // Reset modules so the plugin has no override logger AND the logger module is fresh.
    vi.resetModules();
    mock.mockOutputChannel.appendLine.mockClear();
    // Re-import BOTH: the fresh plugin AND a fresh core so we warm the new core instance.
    const freshCore = await import("typediagram-core");
    await freshCore.warmupSyncRender();
    const freshPlugin = await import("../src/markdown-it-plugin.js");
    const md = new MarkdownIt();
    freshPlugin.typediagramMarkdownItPlugin(md as unknown as MdShape);
    md.render("```typediagram\ntype X { a: Int }\n```");
    // The plugin MUST log even without an explicit logger wire-up.
    const lines = mock.mockOutputChannel.appendLine.mock.calls.map((c) => c[0] as string);
    expect(lines.some((l) => l.includes("plugin installed on markdown-it instance"))).toBe(true);
    expect(lines.some((l) => l.includes("fence rule invoked"))).toBe(true);
    expect(lines.some((l) => l.includes("rendered typediagram fence to SVG"))).toBe(true);
    // Scope binding from getLogger().child({ scope: "md-plugin" }) must be present
    expect(lines.some((l) => l.includes('"scope":"md-plugin"'))).toBe(true);
  });

  // [VSCODE-MD-INTERLEAVED] Proves that when real markdown-it renders a doc mixing
  // prose, headings, lists, quotes, and js fences around typediagram blocks, every
  // section survives and the SVGs land in the correct order.
  it("preserves heading → prose → typediagram → list → typediagram → quote order through real markdown-it", () => {
    const src = [
      "# Title",
      "",
      "Intro with **bold** and `code`.",
      "",
      "```typediagram",
      "type A { x: Int }",
      "```",
      "",
      "- item one",
      "- item two",
      "",
      "```typediagram",
      "type B { y: String }",
      "```",
      "",
      "> closing quote",
    ].join("\n");
    const html = render(src);
    // Structural HTML tags from markdown-it prove prose survived.
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<code>code</code>");
    expect(html).toContain("<li>item one</li>");
    expect(html).toContain("<li>item two</li>");
    expect(html).toContain("<blockquote>");
    expect(html).toContain("closing quote");
    // Both diagrams rendered inline, in order.
    const svgs = [...html.matchAll(/<svg/g)];
    expect(svgs.length).toBe(2);
    const iH1 = html.indexOf("<h1>Title");
    const iSvg0 = svgs[0]?.index ?? -1;
    const iList = html.indexOf("<li>item one");
    const iSvg1 = svgs[1]?.index ?? -1;
    const iQuote = html.indexOf("<blockquote>");
    expect(iH1).toBeGreaterThanOrEqual(0);
    expect(iSvg0).toBeGreaterThan(iH1);
    expect(iList).toBeGreaterThan(iSvg0);
    expect(iSvg1).toBeGreaterThan(iList);
    expect(iQuote).toBeGreaterThan(iSvg1);
    // No leaked fence source.
    expect(html).not.toContain("type A { x: Int }");
    expect(html).not.toContain("type B { y: String }");
    expect(html).not.toContain("```typediagram");
  });

  it('wraps each typediagram fence in <div class="typediagram">, one wrapper per diagram', () => {
    const src = [
      "prose",
      "",
      "```typediagram",
      "type A { x: Int }",
      "```",
      "",
      "more prose",
      "",
      "```typediagram",
      "type B { y: Int }",
      "```",
    ].join("\n");
    const html = render(src);
    const wrappers = [...html.matchAll(/<div class="typediagram">/g)];
    expect(wrappers.length).toBe(2);
    // Each wrapper contains a real SVG (not an error block, not a placeholder).
    expect(html).not.toContain("typediagram-error");
    expect(html).not.toContain("typediagram-pending");
  });

  it("does not corrupt a js fence that sits between two typediagram fences", () => {
    const src = [
      "```typediagram",
      "type A { x: Int }",
      "```",
      "",
      "```js",
      "const secret = 42;",
      "```",
      "",
      "```typediagram",
      "type B { y: Int }",
      "```",
    ].join("\n");
    const html = render(src);
    // js fence renders as <pre><code> with the original content intact.
    expect(html).toContain("const secret = 42");
    expect((html.match(/<svg/g) ?? []).length).toBe(2);
    // The js block appears strictly between the two SVGs.
    const svgs = [...html.matchAll(/<svg/g)];
    const iJs = html.indexOf("const secret");
    expect(svgs[0]?.index).toBeLessThan(iJs);
    expect(iJs).toBeLessThan(svgs[1]?.index ?? -1);
  });

  it("emits SVG as raw HTML (not escaped) so the browser actually paints it", () => {
    const html = render("before\n\n```typediagram\ntype A { x: Int }\n```\n\nafter");
    expect(html).toContain("<svg");
    expect(html).not.toContain("&lt;svg");
    expect(html).toContain("<p>before</p>");
    expect(html).toContain("<p>after</p>");
  });

  it("one bad typediagram between two good ones — good ones still produce SVG, bad one produces an error block", () => {
    const src = [
      "```typediagram",
      "type A { x: Int }",
      "```",
      "",
      "middle paragraph",
      "",
      "```typediagram",
      "type X { @bad }",
      "```",
      "",
      "```typediagram",
      "type B { y: Int }",
      "```",
    ].join("\n");
    const html = render(src);
    expect((html.match(/<svg/g) ?? []).length).toBe(2);
    expect(html).toContain("typediagram-error");
    expect(html).toContain("<p>middle paragraph</p>");
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
