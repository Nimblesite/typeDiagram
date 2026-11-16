// [ELK-THROW-TEST] Tests for elk.ts layout failure (catch block lines 273-282).
import { describe, expect, it, vi } from "vitest";

vi.mock("elkjs/lib/elk.bundled.js", () => ({
  default: class MockELK {
    layout() {
      return Promise.reject(new Error("mock elk failure"));
    }
  },
}));

import { parse } from "../src/parser/index.js";
import { buildModel } from "../src/model/index.js";
import { layout } from "../src/layout/elk.js";
import { unwrap } from "./helpers.js";

describe("[ELK-THROW] layout failure catch block", () => {
  it("returns err result when ELK layout throws", async () => {
    const src = `type Foo { x: String }`;
    const model = unwrap(buildModel(unwrap(parse(src))));
    const r = await layout(model);
    expect(r.ok).toBe(false);
    expect(r.ok).toBe(false);
    if (r.ok) {
      return;
    }
    expect(r.error[0]?.message).toContain("layout failed");
    expect(r.error[0]?.message).toContain("mock elk failure");
  });
});
