// [CLI-EMIT-SVG-ERR] Test emitSvg error branch via mocked renderToString.
import { describe, expect, it, vi } from "vitest";
import type * as TypediagramCoreMod from "typediagram-core";
import { fixturePath, run } from "./helpers.js";

vi.mock("typediagram-core", async (importOriginal) => {
  const orig = await importOriginal<typeof TypediagramCoreMod>();
  return {
    ...orig,
    renderToString: vi.fn(() =>
      Promise.resolve({
        ok: false as const,
        error: [
          {
            severity: "error" as const,
            message: "mock render fail",
            line: 0,
            col: 0,
            length: 0,
          },
        ],
      })
    ),
  };
});

describe("[CLI-EMIT-SVG-ERR] emitSvg render failure", () => {
  it("--from --emit svg exits 1 when renderToString fails", async () => {
    const { code, stderr } = await run(["--from", "rust", "--emit", "svg", fixturePath("types.rs")]);
    expect(code).toBe(1);
    expect(stderr).toContain("mock render fail");
  });
});
