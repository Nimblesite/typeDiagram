// [CLI-API-SMOKE] Smoke test: import every public export path from "typediagram-core".
// Catches missing or broken `exports` entries in package.json.
import { describe, expect, it } from "vitest";
import { SMALL_EXAMPLE } from "../../typediagram/test/fixtures.js";

describe("[CLI-API-SMOKE] typediagram public API", () => {
  it("renderToString from root export", async () => {
    const { renderToString } = await import("typediagram-core");
    const r = await renderToString(SMALL_EXAMPLE);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toMatch(/^<svg[\s>]/);
    }
  });

  it("Result helpers from root export", async () => {
    const { ok, err, isOk, isErr, map, mapErr, andThen, unwrap } = await import("typediagram-core");
    const good = ok(42);
    expect(isOk(good)).toBe(true);
    expect(isErr(good)).toBe(false);
    expect(unwrap(good)).toBe(42);
    expect(unwrap(map(good, (n) => n + 1))).toBe(43);
    const bad = err("nope");
    expect(isErr(bad)).toBe(true);
    const mapped = mapErr(bad, (e) => `wrapped: ${e}`);
    expect(isErr(mapped)).toBe(true);
    if (!mapped.ok) {
      expect(mapped.error).toBe("wrapped: nope");
    }
    const chained = andThen(good, (n) => ok(String(n)));
    expect(unwrap(chained)).toBe("42");
  });

  it("parser subpath export resolves", async () => {
    const parser = await import("typediagram-core/parser");
    expect(parser.parse).toBeTypeOf("function");
    const r = parser.parse(SMALL_EXAMPLE);
    expect(r.ok).toBe(true);
  });

  it("model subpath export resolves", async () => {
    const model = await import("typediagram-core/model");
    expect(model.buildModel).toBeTypeOf("function");
  });

  it("layout subpath export resolves", async () => {
    const layoutMod = await import("typediagram-core/layout");
    expect(layoutMod.layout).toBeTypeOf("function");
  });

  it("render-svg subpath export resolves", async () => {
    const renderSvg = await import("typediagram-core/render-svg");
    expect(renderSvg.renderSvg).toBeTypeOf("function");
  });

  it("markdown subpath export resolves", async () => {
    const md = await import("typediagram-core/markdown");
    expect(md.renderMarkdown).toBeTypeOf("function");
  });

  it("layer barrel re-exports from root", async () => {
    const td = await import("typediagram-core");
    expect(td.parser).toBeDefined();
    expect(td.model).toBeDefined();
    expect(td.layoutLayer).toBeDefined();
    expect(td.renderSvgLayer).toBeDefined();
  });
});
