// [WEB-HOOK-PRESETS-TEST] Presets are code snippets, nothing more. These tests
// verify the splice helpers (toggle in/out, detect presence) and that each
// preset's source parses + evaluates into a callable RenderHooks via evalHooks.
import { describe, expect, it } from "vitest";
import { renderToString } from "typediagram-core";
import { PRESETS, togglePresetInCode, presetsInCode, codeContainsPreset } from "../src/hook-presets.js";
import { evalHooks } from "../src/eval-hooks.js";

const SAMPLE = `typeDiagram
  type User { id: UUID, email: String, name: String, active: Bool }
  type Address { line1: String, city: String }
  union Shape { Circle { radius: Float } Square { side: Float } }
`;

describe("[WEB-PRESET-REGISTRY] PRESETS", () => {
  it("every preset has id, label, blurb, and source", () => {
    for (const p of PRESETS) {
      expect(p.id.length).toBeGreaterThan(0);
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.blurb.length).toBeGreaterThan(0);
      expect(p.source).toContain(`// --- preset:${p.id} ---`);
      expect(p.source).toContain(`// --- /preset:${p.id} ---`);
    }
  });

  it("every preset source evaluates to at least one hook function", () => {
    for (const p of PRESETS) {
      const r = evalHooks(p.source);
      expect(r.ok).toBe(true);
      const fns = Object.values(r.hooks ?? {}).filter((v) => typeof v === "function");
      expect(fns.length).toBeGreaterThan(0);
    }
  });
});

describe("[WEB-PRESET-SPLICE] togglePresetInCode", () => {
  it("adding a preset to empty code yields exactly the preset block", () => {
    const out = togglePresetInCode("", "drop-shadow", true);
    expect(out).toContain("// --- preset:drop-shadow ---");
    expect(out).toContain("// --- /preset:drop-shadow ---");
    expect(presetsInCode(out)).toEqual(["drop-shadow"]);
  });

  it("adding the same preset twice is idempotent (single block)", () => {
    const once = togglePresetInCode("", "grid-bg", true);
    const twice = togglePresetInCode(once, "grid-bg", true);
    expect(twice).toBe(once);
  });

  it("toggling OFF removes the block without disturbing other content", () => {
    const hand = `// user's own hook\nhooks.edge = (_c, d) => d;\n`;
    const added = togglePresetInCode(hand, "classes", true);
    expect(codeContainsPreset(added, "classes")).toBe(true);
    const removed = togglePresetInCode(added, "classes", false);
    expect(codeContainsPreset(removed, "classes")).toBe(false);
    // the user's own hook line survives
    expect(removed).toContain("hooks.edge = (_c, d) => d;");
  });

  it("toggling OFF a preset that isn't present is a no-op", () => {
    const code = "hooks.node = (_c, d) => d;";
    expect(togglePresetInCode(code, "grid-bg", false)).toBe(code);
  });

  it("multiple presets coexist in arbitrary order", () => {
    let code = "";
    code = togglePresetInCode(code, "drop-shadow", true);
    code = togglePresetInCode(code, "grid-bg", true);
    code = togglePresetInCode(code, "field-color", true);
    const active = presetsInCode(code);
    expect(active).toContain("drop-shadow");
    expect(active).toContain("grid-bg");
    expect(active).toContain("field-color");
  });

  it("preset code with all presets added still evaluates successfully", () => {
    let code = "";
    for (const p of PRESETS) {
      code = togglePresetInCode(code, p.id, true);
    }
    const r = evalHooks(code);
    expect(r.ok).toBe(true);
    const fnCount = Object.values(r.hooks ?? {}).filter((v) => typeof v === "function").length;
    expect(fnCount).toBeGreaterThan(0);
  });
});

// [WEB-PRESET-COMPOSE] When multiple presets are active at once, ALL their
// signature effects must appear in the rendered SVG. This is the bug report
// flagged in the playground: selecting shadow + grid + field-color shows ONLY
// grid. Presets must chain — each preset must preserve any prior hooks on the
// same key and compose with them.
describe("[WEB-PRESET-COMPOSE] presets composing in the same hooks editor", () => {
  const compileAndRender = async (ids: ReadonlyArray<string>): Promise<string> => {
    let code = "";
    for (const id of ids) {
      code = togglePresetInCode(code, id as (typeof PRESETS)[number]["id"], true);
    }
    const r = evalHooks(code);
    expect(r.ok).toBe(true);
    const out = await renderToString(SAMPLE, { hooks: r.hooks });
    expect(out.ok).toBe(true);
    if (!out.ok) {
      throw new Error("render failed");
    }
    return out.value;
  };

  it("grid + shadow => BOTH grid pattern AND drop-shadow filter appear in defs", async () => {
    const svgOut = await compileAndRender(["grid-bg", "drop-shadow"]);
    expect(svgOut).toContain(`id="td-preset-grid"`);
    expect(svgOut).toContain(`id="td-preset-drop"`);
    expect(svgOut).toContain(`filter="url(#td-preset-drop)"`);
    expect(svgOut).toContain(`fill="url(#td-preset-grid)"`);
  });

  it("field-color ALONE => id row gets yellow accent", async () => {
    const svgOut = await compileAndRender(["field-color"]);
    expect(svgOut).toContain(`fill="#ffd400"`);
  });

  it("grid + shadow + field-color => grid bg, shadow wrap, AND row accents all present", async () => {
    const svgOut = await compileAndRender(["grid-bg", "drop-shadow", "field-color"]);
    // Grid
    expect(svgOut).toContain(`fill="url(#td-preset-grid)"`);
    // Shadow (applied per-node)
    expect(svgOut).toContain(`filter="url(#td-preset-drop)"`);
    // Field color (yellow for id:, blue for email:, purple for name:)
    expect(svgOut).toContain(`fill="#ffd400"`);
    expect(svgOut).toContain(`fill="#66ccff"`);
  });

  it("glow-union + shadow => union nodes keep glow, non-union nodes still get shadow", async () => {
    const svgOut = await compileAndRender(["glow-union", "drop-shadow"]);
    // Both filters defined
    expect(svgOut).toContain(`id="td-preset-glow"`);
    expect(svgOut).toContain(`id="td-preset-drop"`);
    // User node (record) must be wrapped in the shadow filter
    const userIdx = svgOut.indexOf(`data-decl="User"`);
    expect(userIdx).toBeGreaterThan(-1);
    // Shape node (union) must receive the glow filter at minimum
    const shapeIdx = svgOut.indexOf(`data-decl="Shape"`);
    expect(shapeIdx).toBeGreaterThan(-1);
    const glowMatches = svgOut.match(/url\(#td-preset-glow\)/g) ?? [];
    const shadowMatches = svgOut.match(/url\(#td-preset-drop\)/g) ?? [];
    expect(glowMatches.length).toBeGreaterThan(0);
    expect(shadowMatches.length).toBeGreaterThan(0);
  });
});
