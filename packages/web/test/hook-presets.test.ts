// [WEB-HOOK-PRESETS-TEST] Each preset, when passed to renderToString, produces
// an SVG containing the preset's signature markup. Also covers mergePresets.
import { describe, expect, it } from "vitest";
import { renderToString } from "typediagram-core";
import { PRESETS, mergePresets, type PresetId } from "../src/hook-presets.js";

const SRC = `typeDiagram
  type User { id: UUID, email: String, name: String, active: Bool }
  type Address { line1: String, city: String }
  union Shape { Circle { radius: Float } Square { side: Float } }
  alias Email = String
`;

const renderWith = async (ids: ReadonlyArray<PresetId>): Promise<string> => {
  const selected = PRESETS.filter((p) => ids.includes(p.id));
  const hooks = mergePresets(selected);
  const r = await renderToString(SRC, { hooks });
  if (!r.ok) {
    throw new Error(`render failed: ${JSON.stringify(r.error)}`);
  }
  return r.value;
};

describe("[WEB-HOOK-PRESETS] PRESETS registry", () => {
  it("has every expected preset id", () => {
    const ids = PRESETS.map((p) => p.id);
    expect(ids).toContain("drop-shadow");
    expect(ids).toContain("field-color");
    expect(ids).toContain("grid-bg");
    expect(ids).toContain("classes");
    expect(ids).toContain("glow-union");
  });

  it("every preset has a non-empty label and blurb", () => {
    for (const p of PRESETS) {
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.blurb.length).toBeGreaterThan(0);
    }
  });
});

describe("[WEB-HOOK-PRESET-DROP-SHADOW]", () => {
  it("adds a drop-shadow filter and wraps every node group with it", async () => {
    const out = await renderWith(["drop-shadow"]);
    expect(out).toContain(`id="td-preset-drop"`);
    expect(out).toContain("feDropShadow");
    expect(out).toContain(`filter="url(#td-preset-drop)"`);
  });
});

describe("[WEB-HOOK-PRESET-FIELD-COLOR]", () => {
  it("colors id / email / name rows with distinct accent rects", async () => {
    const out = await renderWith(["field-color"]);
    // id rows use #ffd400
    expect(out).toContain(`fill="#ffd400"`);
    // email rows use #66ccff
    expect(out).toContain(`fill="#66ccff"`);
  });
});

describe("[WEB-HOOK-PRESET-GRID-BG]", () => {
  it("injects a grid pattern in defs and paints it under the diagram", async () => {
    const out = await renderWith(["grid-bg"]);
    expect(out).toContain(`id="td-preset-grid"`);
    expect(out).toContain(`fill="url(#td-preset-grid)"`);
    // grid rect must sit after </defs> and before first node <g>
    const defsClose = out.indexOf("</defs>");
    const gridRect = out.indexOf(`fill="url(#td-preset-grid)"`);
    const firstNode = out.indexOf("<g data-decl=");
    expect(gridRect).toBeGreaterThan(defsClose);
    expect(gridRect).toBeLessThan(firstNode);
  });
});

describe("[WEB-HOOK-PRESET-CLASSES]", () => {
  it("adds td-kind-* classes and injects style rules", async () => {
    const out = await renderWith(["classes"]);
    expect(out).toContain(`class="td-kind-record"`);
    expect(out).toContain(`class="td-kind-union"`);
    expect(out).toContain(`class="td-kind-alias"`);
    expect(out).toContain(`<style>`);
    expect(out).toContain(`.td-kind-union`);
  });
});

describe("[WEB-HOOK-PRESET-GLOW-UNION]", () => {
  it("only union nodes receive the glow filter", async () => {
    const out = await renderWith(["glow-union"]);
    expect(out).toContain(`id="td-preset-glow"`);
    // The Shape union must be wrapped in the glow filter; User (record) must not.
    const shapeIdx = out.indexOf(`data-decl="Shape"`);
    const userIdx = out.indexOf(`data-decl="User"`);
    expect(shapeIdx).toBeGreaterThan(0);
    expect(userIdx).toBeGreaterThan(0);
    // Count glow-filter groups: must be exactly the number of unions in SRC (1: Shape)
    const glowMatches = out.match(/filter="url\(#td-preset-glow\)"/g) ?? [];
    expect(glowMatches.length).toBe(1);
  });
});

describe("[WEB-HOOK-PRESETS-MERGE] mergePresets composes all phases", () => {
  it("empty selection returns empty RenderHooks object", () => {
    expect(mergePresets([])).toEqual({});
  });

  it("combining drop-shadow + grid-bg + classes leaves all three signatures in output", async () => {
    const out = await renderWith(["drop-shadow", "grid-bg", "classes"]);
    expect(out).toContain(`id="td-preset-drop"`);
    expect(out).toContain(`id="td-preset-grid"`);
    expect(out).toContain(`class="td-kind-record"`);
    // post-hook style rules still present
    expect(out).toContain(`<style>`);
  });

  it("node transform hooks chain — presets compose in registry order", async () => {
    const out = await renderWith(["classes", "drop-shadow"]);
    // Selection is filtered by PRESETS registry order (drop-shadow declared before classes),
    // so drop-shadow runs first on the default, then classes wraps that output.
    // Result: classes group is OUTER, filter group is INNER: classIdx < filterIdx.
    expect(out).toContain(`filter="url(#td-preset-drop)"`);
    expect(out).toContain(`class="td-kind-record"`);
    const filterIdx = out.indexOf(`<g filter="url(#td-preset-drop)">`);
    const classIdx = out.indexOf(`<g class="td-kind-record"`);
    expect(filterIdx).toBeGreaterThan(-1);
    expect(classIdx).toBeLessThan(filterIdx);
  });

  it("default output unchanged when NO presets selected", async () => {
    const plain = await renderWith([]);
    const base = await renderToString(SRC);
    if (!base.ok) {
      throw new Error("base render failed");
    }
    expect(plain).toBe(base.value);
  });
});
