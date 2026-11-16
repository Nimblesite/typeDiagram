import { describe, expect, it } from "vitest";
import { renderToString } from "../src/index.js";
import { escapeAttr, escapeText, svg, raw } from "../src/render-svg/svg-tag.js";
import { renderSvg } from "../src/render-svg/index.js";
import type { LaidOutGraph } from "../src/layout/types.js";
import { CHAT_EXAMPLE, SMALL_EXAMPLE } from "./fixtures.js";
import { unwrap } from "./helpers.js";

describe("render — small example", () => {
  it("produces an <svg> document", async () => {
    const out = unwrap(await renderToString(SMALL_EXAMPLE));
    expect(out.startsWith("<svg")).toBe(true);
    expect(out).toContain("</svg>");
  });

  it("contains every decl name", async () => {
    const out = unwrap(await renderToString(SMALL_EXAMPLE));
    for (const name of ["User", "Address", "Shape", "Option", "Email"]) {
      expect(out).toContain(name);
    }
  });

  it("contains every field name", async () => {
    const out = unwrap(await renderToString(SMALL_EXAMPLE));
    for (const f of ["id", "name", "email", "roles", "address", "line1", "city", "country"]) {
      expect(out).toContain(f);
    }
  });

  it("dark theme switches background", async () => {
    const light = unwrap(await renderToString(SMALL_EXAMPLE, { theme: "light" }));
    const dark = unwrap(await renderToString(SMALL_EXAMPLE, { theme: "dark" }));
    expect(light).not.toBe(dark);
    expect(dark).toContain("#222a3d");
    expect(dark).toContain('id="td-grid"');
    expect(dark).toContain('id="td-ambient-shadow"');
  });
});

describe("render — chat example", () => {
  it("contains every union variant name", async () => {
    const out = unwrap(await renderToString(CHAT_EXAMPLE));
    for (const v of ["Image", "Audio", "Video", "Document", "Web", "Api"]) {
      expect(out).toContain(v);
    }
  });

  it("snapshot — chat example SVG (default theme)", async () => {
    const out = unwrap(await renderToString(CHAT_EXAMPLE));
    expect(out).toMatchSnapshot();
  });

  it("snapshot — small example SVG (default theme)", async () => {
    const out = unwrap(await renderToString(SMALL_EXAMPLE));
    expect(out).toMatchSnapshot();
  });

  it("renders explicit union discriminants in the SVG text", async () => {
    const out = unwrap(
      await renderToString(`
union ErrorCode {
  ParseError = -32700
  InvalidRequest = -32600
  MethodNotFound = -32601
}
`)
    );

    expect(out).toContain("ParseError = -32700");
    expect(out).toContain("InvalidRequest = -32600");
    expect(out).toContain("MethodNotFound = -32601");
  });
});

describe("render — error path", () => {
  it("returns Result.err for parse errors instead of throwing", async () => {
    const r = await renderToString("type X { @bad }");
    expect(r.ok).toBe(false);
  });

  it("does not throw on garbage input", async () => {
    await expect(renderToString("@@@@")).resolves.toBeDefined();
  });
});

describe("render — svg-tag escaping", () => {
  it("escapeAttr escapes ampersand", () => {
    expect(escapeAttr("a&b")).toBe("a&amp;b");
  });

  it("escapeAttr escapes less-than", () => {
    expect(escapeAttr("a<b")).toBe("a&lt;b");
  });

  it("escapeAttr escapes greater-than", () => {
    expect(escapeAttr("a>b")).toBe("a&gt;b");
  });

  it("escapeAttr escapes double quote", () => {
    expect(escapeAttr('a"b')).toBe("a&quot;b");
  });

  it("escapeAttr escapes single quote", () => {
    expect(escapeAttr("a'b")).toBe("a&apos;b");
  });

  it("escapeAttr leaves normal text unchanged", () => {
    expect(escapeAttr("hello")).toBe("hello");
  });

  it("escapeText escapes ampersand, lt, gt", () => {
    expect(escapeText("a&b<c>d")).toBe("a&amp;b&lt;c&gt;d");
  });

  it("escapeText leaves normal text unchanged", () => {
    expect(escapeText("hello")).toBe("hello");
  });

  it("svg tagged template escapes string interpolations", () => {
    const result = svg`<text x="${10}">${"a&b"}</text>`;
    expect(result.value).toContain("&amp;");
  });

  it("svg tagged template passes numbers raw", () => {
    const result = svg`<rect x="${42}"/>`;
    expect(result.value).toContain("42");
  });

  it("svg tagged template passes SafeSvg raw", () => {
    const safe = raw("<g>inner</g>");
    const result = svg`<svg>${safe}</svg>`;
    expect(result.value).toContain("<g>inner</g>");
  });

  it("svg tagged template skips undefined runtime values", () => {
    // Safe: this deliberately exercises the runtime guard for malformed callers.
    const strings = ["<g>"] as unknown as TemplateStringsArray;
    const result = svg(strings, undefined as unknown as string);
    expect(result.value).toBe("<g>");
  });

  it("svg tagged template tolerates missing trailing string chunks", () => {
    // Safe: this deliberately exercises the runtime fallback for malformed callers.
    const strings = ["<g>"] as unknown as TemplateStringsArray;
    const result = svg(strings, 1);
    expect(result.value).toBe("<g>1");
  });

  it("raw creates a SafeSvg", () => {
    const s = raw("test");
    expect(s.value).toBe("test");
  });

  it("render handles edge with no label", async () => {
    // An alias creates an edge with an empty label
    const r = await renderToString("type Foo { x: String }\nalias Bar = Foo");
    expect(r.ok).toBe(true);
  });

  it("render skips edge routes with fewer than two points", () => {
    const graph: LaidOutGraph = {
      width: 10,
      height: 10,
      nodes: [],
      edges: [
        {
          id: "short",
          sourceNodeId: "a",
          targetNodeId: "b",
          points: [{ x: 1, y: 1 }],
          label: "short",
          kind: "field",
        },
      ],
    };
    const out = renderSvg(graph);
    expect(out).toContain("<svg");
    expect(out).not.toContain("short");
  });

  it("render throws when an edge references an unknown node", () => {
    const graph: LaidOutGraph = {
      width: 10,
      height: 10,
      nodes: [],
      edges: [
        {
          id: "bad",
          sourceNodeId: "a",
          targetNodeId: "b",
          points: [
            { x: 0, y: 0 },
            { x: 1, y: 1 },
          ],
          label: "bad",
          kind: "genericArg",
        },
      ],
    };
    expect(() => renderSvg(graph)).toThrow("references unknown node");
  });
});
