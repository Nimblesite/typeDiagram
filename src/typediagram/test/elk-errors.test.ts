// [ELK-ERROR-TEST] Tests for elk.ts error paths.
// Uses vi.mock to intercept the ELK module before elk.ts loads it.
import { describe, expect, it, vi } from "vitest";

// Mock ELK before any imports that depend on it
vi.mock("elkjs/lib/elk.bundled.js", () => ({
  default: class MockELK {
    layoutCount = 0;

    layout(graph: { children: Array<{ id: string; width: number; height: number }>; edges: Array<{ id: string }> }) {
      this.layoutCount++;
      // First call: return edges with no sections (to cover line 240)
      // The error throw path won't be easy to test with a single mock behavior,
      // so we always return results with no sections on edges.
      return Promise.resolve({
        width: 500,
        height: 300,
        children: graph.children.map((c) => ({
          id: c.id,
          x: 10,
          y: 10,
          width: c.width,
          height: c.height,
        })),
        edges: graph.edges.map((e) => ({
          id: e.id,
          sections: undefined,
        })),
      });
    }
  },
}));

import { parse } from "../src/parser/index.js";
import { buildModel } from "../src/model/index.js";
import { layout } from "../src/layout/elk.js";
import { unwrap } from "./helpers.js";

describe("[ELK-NOSECTIONS] layout with edges having no sections", () => {
  it("produces edges with empty points when sections are undefined", async () => {
    const src = `type Foo { x: Bar }\ntype Bar { y: String }`;
    const model = unwrap(buildModel(unwrap(parse(src))));
    const r = await layout(model);
    expect(r.ok).toBe(true);
    expect(r.ok && r.value.edges.some((e) => e.points.length === 0)).toBe(true);
  });
});
