// [LAYOUT-SYNC-COLD] Exercises the pre-warmup error path of layoutSync. Uses
// vi.resetModules() to get a fresh copy of the elk module with warmedUp=false.
import { describe, expect, it, vi } from "vitest";

describe("[LAYOUT-SYNC-COLD] layoutSync before warmup", () => {
  it("returns Result.err with a clear message when called before warmup", async () => {
    vi.resetModules();
    const { renderToStringSync } = await import("../src/index.js");
    const r = renderToStringSync("type X { a: Int }");
    expect(r.ok).toBe(false);
    if (r.ok) {
      throw new Error("unreachable");
    }
    expect(r.error[0]?.message).toContain("warmup");
  });
});
