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
