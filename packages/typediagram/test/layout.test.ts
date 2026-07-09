import { describe, expect, it } from "vitest";
import { parse } from "../src/parser/index.js";
import { buildModel } from "../src/model/index.js";
import { layout, measureBlock, measureText } from "../src/layout/index.js";
import { CHAT_EXAMPLE, SMALL_EXAMPLE } from "./fixtures.js";

function unwrap<T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!r.ok) {
    throw new Error(`expected ok: ${JSON.stringify(r.error)}`);
  }
  return r.value;
}

describe("layout — measure", () => {
  it("ASCII text width is chars * 0.6 * fontSize", () => {
    expect(measureText("hello", 10).w).toBeCloseTo(5 * 0.6 * 10);
  });

  it("CJK chars take a full em", () => {
    const m = measureText("日本", 10);
    expect(m.w).toBeCloseTo(2 * 1.0 * 10);
  });

  it("mixed text sums correctly", () => {
    const m = measureText("a日b", 10);
    expect(m.w).toBeCloseTo((0.6 + 1.0 + 0.6) * 10);
  });
});

describe("layout — small example", () => {
  it("produces non-overlapping nodes for every decl", async () => {
    const model = unwrap(buildModel(unwrap(parse(SMALL_EXAMPLE))));
    const g = unwrap(await layout(model));
    expect(g.nodes).toHaveLength(model.decls.length);
    for (let i = 0; i < g.nodes.length; i++) {
      for (let j = i + 1; j < g.nodes.length; j++) {
        const a = g.nodes[i];
        const b = g.nodes[j];
        if (a === undefined || b === undefined) {
          continue;
        }
        const overlap = a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
        expect(overlap, `nodes ${a.id} and ${b.id} overlap`).toBe(false);
      }
    }
  });

  it("has graph dimensions > 0", async () => {
    const model = unwrap(buildModel(unwrap(parse(SMALL_EXAMPLE))));
    const g = unwrap(await layout(model));
    expect(g.width).toBeGreaterThan(0);
    expect(g.height).toBeGreaterThan(0);
  });

  it("produces an edge for every model edge", async () => {
    const model = unwrap(buildModel(unwrap(parse(SMALL_EXAMPLE))));
    const g = unwrap(await layout(model));
    expect(g.edges.length).toBe(model.edges.length);
    for (const e of g.edges) {
      expect(e.points.length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("layout — chat example with port routing", () => {
  it("union node edges attach to a y-coordinate inside the corresponding row", async () => {
    const model = unwrap(buildModel(unwrap(parse(CHAT_EXAMPLE))));
    const g = unwrap(await layout(model));
    // Find the edge from ToolResultContent (union) -> ContentItem.
    const e = g.edges.find((x) => x.sourceNodeId === "ToolResultContent" && x.targetNodeId === "ContentItem");
    expect(e).toBeDefined();
    const node = g.nodes.find((n) => n.id === "ToolResultContent");
    const start = e?.points[0];
    expect(node).toBeDefined();
    expect(start).toBeDefined();
    if (node === undefined || start === undefined) {
      return;
    }
    // The start y must be within the union node's vertical bounds.
    expect(start.y).toBeGreaterThanOrEqual(node.y);
    expect(start.y).toBeLessThanOrEqual(node.y + node.height);
  });

  it("all node ids unique", async () => {
    const model = unwrap(buildModel(unwrap(parse(CHAT_EXAMPLE))));
    const g = unwrap(await layout(model));
    const ids = new Set(g.nodes.map((n) => n.id));
    expect(ids.size).toBe(g.nodes.length);
  });
});

describe("layout — measureBlock", () => {
  it("measures single line block", () => {
    const result = measureBlock(["hello"], 10);
    expect(result.w).toBeCloseTo(5 * 0.6 * 10);
    expect(result.h).toBeCloseTo(10 * 1.2);
  });

  it("measures multi-line block using widest line", () => {
    const result = measureBlock(["hi", "hello world"], 10);
    expect(result.w).toBeCloseTo(11 * 0.6 * 10);
    expect(result.h).toBeCloseTo(2 * 10 * 1.2);
  });

  it("keeps the current widest line when later lines are shorter", () => {
    const result = measureBlock(["hello world", "hi"], 10);
    expect(result.w).toBeCloseTo(11 * 0.6 * 10);
    expect(result.h).toBeCloseTo(2 * 10 * 1.2);
  });

  it("measures empty block", () => {
    const result = measureBlock([], 10);
    expect(result.w).toBe(0);
    expect(result.h).toBe(0);
  });

  it("measures CJK characters in block", () => {
    const result = measureBlock(["abc", "\u4e2d\u6587"], 10);
    // "abc" = 3*0.6*10 = 18, "中文" = 2*1.0*10 = 20
    expect(result.w).toBeCloseTo(20);
  });
});

describe("layout — CJK wide char measurement", () => {
  it("measures Hangul Jamo (0x1100-0x115f) as wide", () => {
    const m = measureText("\u1100", 10);
    expect(m.w).toBeCloseTo(1.0 * 10);
  });

  it("measures CJK radicals (0x2e80) as wide", () => {
    const m = measureText("\u2e80", 10);
    expect(m.w).toBeCloseTo(1.0 * 10);
  });

  it("measures Hiragana (0x3041) as wide", () => {
    const m = measureText("\u3041", 10);
    expect(m.w).toBeCloseTo(1.0 * 10);
  });

  it("measures fullwidth form (0xff01) as wide", () => {
    const m = measureText("\uff01", 10);
    expect(m.w).toBeCloseTo(1.0 * 10);
  });

  it("measures Hangul Syllables (0xac00) as wide", () => {
    const m = measureText("\uac00", 10);
    expect(m.w).toBeCloseTo(1.0 * 10);
  });

  it("measures emoji as wide (surrogate pair)", () => {
    const m = measureText("\u{1f600}", 10);
    expect(m.w).toBeCloseTo(1.0 * 10);
  });
});

describe("layout — alias node rendering", () => {
  it("lays out an alias type node correctly", async () => {
    const src = `type Foo { x: String }\nalias Bar = Foo`;
    const model = unwrap(buildModel(unwrap(parse(src))));
    const g = unwrap(await layout(model));
    const bar = g.nodes.find((n) => n.id === "Bar");
    expect(bar).toBeDefined();
    expect(bar?.declKind).toBe("alias");
    expect(bar?.rows.length).toBeGreaterThan(0);
  });
});
