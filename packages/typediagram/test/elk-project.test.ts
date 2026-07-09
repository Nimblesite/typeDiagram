// [ELK-PROJECT-TEST] Covers layout projection branches that real ELK rarely emits.
import { describe, expect, it, vi } from "vitest";

let returnedEdgeId = "";

vi.mock("elkjs/lib/elk.bundled.js", () => {
  const MockELK = function (this: { layout: () => Promise<unknown> }) {
    this.layout = () =>
      Promise.resolve({
        width: 320,
        height: 180,
        children: [{ id: "Ref" }, { id: "Missing" }],
        edges: [
          { id: returnedEdgeId },
          {
            id: "unknown-edge",
            sections: [
              {
                startPoint: { x: 0, y: 0 },
                endPoint: { x: 1, y: 1 },
              },
            ],
          },
        ],
      });
  };
  return { default: MockELK };
});

import { layout } from "../src/layout/elk.js";
import { buildModel } from "../src/model/index.js";
import { parse } from "../src/parser/index.js";

function unwrap<T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!r.ok) {
    throw new Error(`expected ok: ${JSON.stringify(r.error)}`);
  }
  return r.value;
}

describe("[ELK-PROJECT] layout projection defaults and filters", () => {
  it("drops unknown ELK children/edges and defaults missing geometry", async () => {
    const model = unwrap(
      buildModel(
        unwrap(
          parse(`
type Ref {
  shape: Shape
}

union Shape {
  Point { x: Int }
  Line(Int, String)
  Empty
}
`)
        )
      )
    );
    const edge = model.edges[0];
    if (edge === undefined) {
      throw new Error("expected model edge");
    }
    returnedEdgeId = `${edge.sourceDeclName}:${String(edge.sourceRowIndex)}:${edge.targetDeclName}:${edge.kind}`;

    const result = unwrap(await layout(model));
    expect(result.width).toBe(320);
    expect(result.height).toBe(180);
    expect(result.nodes.map((n) => n.id)).toEqual(["Ref"]);
    expect(result.nodes[0]?.x).toBe(0);
    expect(result.nodes[0]?.width).toBeGreaterThan(0);
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]?.id).toBe(returnedEdgeId);
    expect(result.edges[0]?.points).toEqual([]);
  });
});
