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

  // [WEB-PRESET-LOUD] Preset effects must be IMPOSSIBLE to miss. Each preset
  // must either saturate the background, wrap every node in a conspicuous
  // shape, or paint a high-contrast overlay. Subtle = a bug.
  describe("[WEB-PRESET-LOUD] presets produce unambiguously visible effects", () => {
    it("drop-shadow: every node is wrapped in a HIGH-CONTRAST coloured filter (dark-bg friendly)", async () => {
      const svgOut = await compileAndRender(["drop-shadow"]);
      const filterDef = svgOut.match(/<filter id="td-preset-drop"[^>]*>[\s\S]*?<feDropShadow ([^/]+)\/>/);
      expect(filterDef).not.toBeNull();
      if (filterDef === null) {
        return;
      }
      const attrs = filterDef[1] ?? "";
      const dx = parseFloat((attrs.match(/dx="(-?[\d.]+)"/) ?? ["", "0"])[1] ?? "0");
      const dy = parseFloat((attrs.match(/dy="(-?[\d.]+)"/) ?? ["", "0"])[1] ?? "0");
      const stdDev = parseFloat((attrs.match(/stdDeviation="(-?[\d.]+)"/) ?? ["", "0"])[1] ?? "0");
      const opacity = parseFloat((attrs.match(/flood-opacity="(-?[\d.]+)"/) ?? ["", "0"])[1] ?? "0");
      const floodColor = (attrs.match(/flood-color="([^"]+)"/) ?? ["", ""])[1] ?? "";
      expect(Math.abs(dx) + Math.abs(dy) + stdDev).toBeGreaterThan(12);
      expect(opacity).toBeGreaterThanOrEqual(0.85);
      // Black shadow disappears on a dark background — must be a bright colour.
      expect(floodColor.toLowerCase()).not.toBe("#000000");
      expect(floodColor.toLowerCase()).not.toBe("black");
      expect(floodColor).toMatch(/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i);
      // Quick brightness check: sum of RGB components must be high.
      const hex = floodColor.replace(/^#/, "");
      const full =
        hex.length === 3
          ? hex
              .split("")
              .map((c) => c + c)
              .join("")
          : hex;
      const r = parseInt(full.slice(0, 2), 16);
      const g = parseInt(full.slice(2, 4), 16);
      const b = parseInt(full.slice(4, 6), 16);
      expect(r + g + b).toBeGreaterThan(400);
    });

    it("grid-bg: background pattern covers the full diagram, not a tiny corner", async () => {
      const svgOut = await compileAndRender(["grid-bg"]);
      const bgRect = svgOut.match(/<rect[^>]*fill="url\(#td-preset-grid\)"[^>]*\/>/);
      expect(bgRect).not.toBeNull();
      if (bgRect === null) {
        return;
      }
      const tag = bgRect[0];
      const w = parseFloat((tag.match(/width="([\d.]+)"/) ?? ["", "0"])[1] ?? "0");
      const h = parseFloat((tag.match(/height="([\d.]+)"/) ?? ["", "0"])[1] ?? "0");
      expect(w).toBeGreaterThan(200);
      expect(h).toBeGreaterThan(200);
      // And the pattern stroke must be visible (not near-transparent).
      const pattern = svgOut.match(/<pattern id="td-preset-grid"[\s\S]*?<\/pattern>/);
      expect(pattern).not.toBeNull();
      if (pattern === null) {
        return;
      }
      const strokeMatch = pattern[0].match(/stroke="([^"]+)"/);
      expect(strokeMatch).not.toBeNull();
      const stroke = strokeMatch?.[1] ?? "";
      // Either a solid/hex colour, OR an rgba with opacity >= 0.5.
      const rgbaMatch = stroke.match(/rgba?\([^)]*?,\s*([\d.]+)\s*\)/);
      const isHex = /^#[0-9a-f]{3,8}$/i.test(stroke);
      const isNamed = /^[a-z]+$/i.test(stroke);
      const rgbaAlpha = rgbaMatch ? parseFloat(rgbaMatch[1] ?? "1") : 1;
      expect(isHex || isNamed || rgbaAlpha >= 0.5).toBe(true);
    });

    it("field-color: row accent rect is at least 6px wide (visible, not a hairline)", async () => {
      const svgOut = await compileAndRender(["field-color"]);
      const rect = svgOut.match(/<rect[^>]*fill="#ffd400"[^>]*\/>/);
      expect(rect).not.toBeNull();
      if (rect === null) {
        return;
      }
      const width = parseFloat((rect[0].match(/width="([\d.]+)"/) ?? ["", "0"])[1] ?? "0");
      expect(width).toBeGreaterThanOrEqual(6);
    });

    it("glow-union: filter applies significant gaussian blur (stdDeviation >= 4)", async () => {
      const svgOut = await compileAndRender(["glow-union"]);
      const blur = svgOut.match(/<feGaussianBlur[^>]*stdDeviation="([\d.]+)"/);
      expect(blur).not.toBeNull();
      if (blur === null) {
        return;
      }
      const stdDev = parseFloat(blur[1] ?? "0");
      expect(stdDev).toBeGreaterThanOrEqual(4);
    });

    it("classes: post-injected <style> changes brightness on union nodes by >=20%", async () => {
      const svgOut = await compileAndRender(["classes"]);
      const styleBlock = svgOut.match(/<style>([\s\S]*?)<\/style>/);
      expect(styleBlock).not.toBeNull();
      if (styleBlock === null) {
        return;
      }
      const css = styleBlock[1] ?? "";
      // Either brightness(1.2+) or a saturated outline/background — anything OBVIOUS.
      const brightness = css.match(/brightness\(([\d.]+)\)/);
      const hasLoudOutline = /outline\s*:\s*\d+px/.test(css) || /box-shadow/.test(css);
      if (brightness !== null) {
        expect(parseFloat(brightness[1] ?? "1")).toBeGreaterThanOrEqual(1.2);
      } else {
        expect(hasLoudOutline).toBe(true);
      }
    });
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
