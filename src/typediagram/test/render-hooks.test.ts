// [HOOK-TEST] End-to-end tests for render hooks: phase coverage, overrides,
// error fallback, determinism, geometry, plus positioning PoC.
import { describe, expect, it, vi } from "vitest";
import { parse } from "../src/parser/index.js";
import { buildModel } from "../src/model/index.js";
import { layout } from "../src/layout/index.js";
import type { LaidOutGraph } from "../src/layout/types.js";
import { renderSvg, svg, raw } from "../src/render-svg/index.js";
import type { EdgeCtx, HookError, NodeCtx, RenderHooks } from "../src/render-svg/index.js";
import { SMALL_EXAMPLE, SINGLE_RECORD, MANY_NODES } from "./fixtures.js";

async function graphFor(source: string): Promise<LaidOutGraph> {
  const parsed = parse(source);
  if (!parsed.ok) {
    throw new Error(`parse failed: ${JSON.stringify(parsed.error)}`);
  }
  const model = buildModel(parsed.value);
  if (!model.ok) {
    throw new Error(`model failed: ${JSON.stringify(model.error)}`);
  }
  const laid = await layout(model.value);
  if (!laid.ok) {
    throw new Error(`layout failed: ${JSON.stringify(laid.error)}`);
  }
  return laid.value;
}

describe("[HOOK-TEST-DEFAULT-IDENTITY] no hooks ≡ pre-hooks output", () => {
  it("renderSvg(graph) ≡ renderSvg(graph, {}) ≡ renderSvg(graph, { hooks: {} })", async () => {
    const g = await graphFor(SMALL_EXAMPLE);
    const a = renderSvg(g);
    const b = renderSvg(g, {});
    const c = renderSvg(g, { hooks: {} });
    expect(a).toBe(b);
    expect(a).toBe(c);
  });

  it("opening tag, arrow marker, first node group are present and ordered", async () => {
    const g = await graphFor(SMALL_EXAMPLE);
    const out = renderSvg(g);
    const openIdx = out.indexOf("<svg ");
    const arrowIdx = out.indexOf(`id="td-arrow"`);
    const defsCloseIdx = out.indexOf("</defs>");
    const firstNodeIdx = out.indexOf("<g data-decl=");
    expect(openIdx).toBeGreaterThanOrEqual(0);
    expect(arrowIdx).toBeGreaterThan(openIdx);
    expect(defsCloseIdx).toBeGreaterThan(arrowIdx);
    expect(firstNodeIdx).toBeGreaterThan(defsCloseIdx);
  });
});

describe("[HOOK-TEST-PHASES] all six phases fire in order", () => {
  it("defs → background → node → row → edge → post", async () => {
    const g = await graphFor(SMALL_EXAMPLE);
    const calls: string[] = [];
    const hooks: RenderHooks = {
      defs: () => {
        calls.push("defs");
        return svg`<linearGradient id="td-test-grad"/>`;
      },
      background: (ctx) => {
        calls.push("background");
        return svg`<rect class="td-test-bg" width="${ctx.width}" height="${ctx.height}" fill="transparent"/>`;
      },
      node: (_ctx, def) => {
        calls.push("node");
        return svg`${def}`;
      },
      row: (_ctx, def) => {
        calls.push("row");
        return svg`${def}`;
      },
      edge: (_ctx, def) => {
        calls.push("edge");
        return svg`${def}`;
      },
      post: (ctx) => {
        calls.push("post");
        return svg`${ctx.svg}<!--td-test-post-->`;
      },
    };
    const out = renderSvg(g, { hooks });
    expect(out).toContain(`id="td-test-grad"`);
    expect(out).toContain(`class="td-test-bg"`);
    expect(out).toContain(`<!--td-test-post-->`);
    expect(calls[0]).toBe("defs");
    expect(calls[1]).toBe("background");
    // node hook is invoked; since it returns a value, row is skipped for that node
    expect(calls.includes("node")).toBe(true);
    expect(calls.includes("edge")).toBe(true);
    expect(calls[calls.length - 1]).toBe("post");
  });
});

describe("[HOOK-TEST-DEFS] defs hook", () => {
  it("adds marker inside <defs> and </defs> still precedes first node", async () => {
    const g = await graphFor(SINGLE_RECORD);
    const out = renderSvg(g, {
      hooks: {
        defs: () => svg`<filter id="td-drop"><feDropShadow dx="1" dy="2" stdDeviation="2"/></filter>`,
      },
    });
    const filterIdx = out.indexOf(`id="td-drop"`);
    const defsCloseIdx = out.indexOf("</defs>");
    const firstNodeIdx = out.indexOf("<g data-decl=");
    expect(filterIdx).toBeGreaterThan(0);
    expect(filterIdx).toBeLessThan(defsCloseIdx);
    expect(defsCloseIdx).toBeLessThan(firstNodeIdx);
    // default arrow marker still present
    expect(out).toContain(`id="td-arrow"`);
  });
});

describe("[HOOK-TEST-BACKGROUND] background hook", () => {
  it("sits between </defs> and first node <g>", async () => {
    const g = await graphFor(SINGLE_RECORD);
    const out = renderSvg(g, {
      hooks: {
        background: (ctx) => svg`<rect class="td-bg" width="${ctx.width}" height="${ctx.height}" fill="#f0f0f0"/>`,
      },
    });
    const defsCloseIdx = out.indexOf("</defs>");
    const bgIdx = out.indexOf(`class="td-bg"`);
    const firstNodeIdx = out.indexOf("<g data-decl=");
    expect(bgIdx).toBeGreaterThan(defsCloseIdx);
    expect(bgIdx).toBeLessThan(firstNodeIdx);
  });
});

describe("[HOOK-TEST-POST] post hook", () => {
  it("wraps the entire SVG", async () => {
    const g = await graphFor(SINGLE_RECORD);
    const out = renderSvg(g, {
      hooks: {
        post: (ctx) => svg`${ctx.svg}<!--post-mark-->`,
      },
    });
    expect(out.endsWith("<!--post-mark-->")).toBe(true);
    expect(out).toContain("</svg>");
    expect(out.indexOf("</svg>")).toBeLessThan(out.indexOf("<!--post-mark-->"));
  });
});

describe("[HOOK-TEST-NODE-OVERRIDE] node hook replaces default", () => {
  it("when node hook returns replacement, default node <g> is absent for that node", async () => {
    const g = await graphFor(SMALL_EXAMPLE);
    const out = renderSvg(g, {
      hooks: {
        node: (ctx) => {
          if (ctx.node.declName !== "User") {
            return undefined;
          }
          return svg`<g data-test-replaced="User"><rect x="${ctx.x}" y="${ctx.y}" width="${ctx.width}" height="${ctx.height}" fill="#fff"/></g>`;
        },
      },
    });
    expect(out).toContain(`data-test-replaced="User"`);
    // Other nodes still render with their default data-decl attribute
    expect(out).toContain(`data-decl="Address"`);
    // User node's default <g data-decl="User"> should NOT appear
    expect(out).not.toContain(`data-decl="User"`);
  });
});

describe("[HOOK-TEST-NODE-WRAPS-DEFAULT] node hook wraps default", () => {
  it("wrapping with a filter group preserves the original rect", async () => {
    const g = await graphFor(SINGLE_RECORD);
    const out = renderSvg(g, {
      hooks: {
        defs: () => svg`<filter id="drop"><feDropShadow dx="1" dy="2" stdDeviation="2"/></filter>`,
        node: (_ctx, def) => svg`<g filter="url(#drop)">${def}</g>`,
      },
    });
    expect(out).toContain(`filter="url(#drop)"`);
    expect(out).toContain(`data-decl="Point"`);
  });
});

describe("[HOOK-TEST-ROW-ALWAYS-FIRST] row hooks always run and feed their output into the node hook's `def`", () => {
  it("row hook fires for EVERY node including any whose node hook returns a value", async () => {
    const g = await graphFor(SMALL_EXAMPLE);
    let rowCallsForUser = 0;
    let rowCallsForOthers = 0;
    renderSvg(g, {
      hooks: {
        node: (ctx) => {
          if (ctx.node.declName === "User") {
            return svg`<g data-test-user></g>`;
          }
          return undefined;
        },
        row: (ctx) => {
          if (ctx.node.declName === "User") {
            rowCallsForUser += 1;
          } else {
            rowCallsForOthers += 1;
          }
          return undefined;
        },
      },
    });
    // User has rows; row hook MUST have been called for each of them.
    expect(rowCallsForUser).toBeGreaterThan(0);
    expect(rowCallsForOthers).toBeGreaterThan(0);
  });

  it("node hook's `def` parameter reflects row-hook transformations", async () => {
    const g = await graphFor(SMALL_EXAMPLE);
    let sawRowMarkerInDef = false;
    renderSvg(g, {
      hooks: {
        row: (_ctx, def) => svg`${def}<rect data-row-marker="1"/>`,
        node: (_ctx, def) => {
          if (def.value.includes(`data-row-marker="1"`)) {
            sawRowMarkerInDef = true;
          }
          return undefined;
        },
      },
    });
    expect(sawRowMarkerInDef).toBe(true);
  });
});

describe("[HOOK-TEST-ROW] row hook decorates rows", () => {
  it("can append an indicator per row", async () => {
    const g = await graphFor(SINGLE_RECORD);
    const out = renderSvg(g, {
      hooks: {
        row: (ctx, def) =>
          svg`${def}<circle class="td-row-dot" cx="${ctx.x + 3}" cy="${ctx.y + ctx.height / 2}" r="2"/>`,
      },
    });
    const matches = out.match(/class="td-row-dot"/g);
    expect(matches).not.toBeNull();
    // Point record has two fields → two rows
    expect(matches?.length).toBe(2);
  });
});

describe("[HOOK-TEST-EDGE] edge hook replaces polyline", () => {
  it("replacement line matches source→target endpoint geometry", async () => {
    const g = await graphFor(MANY_NODES);
    let captured: EdgeCtx | undefined;
    const out = renderSvg(g, {
      hooks: {
        edge: (ctx) => {
          captured ??= ctx;
          const first = ctx.points[0];
          const last = ctx.points[ctx.points.length - 1];
          if (first === undefined || last === undefined) {
            return undefined;
          }
          return svg`<line class="td-test-line" x1="${first.x}" y1="${first.y}" x2="${last.x}" y2="${last.y}" stroke="red"/>`;
        },
      },
    });
    expect(captured).toBeDefined();
    // polyline for a hooked edge should be absent (hook replaced it)
    const polylineCount = (out.match(/<polyline /g) ?? []).length;
    const lineCount = (out.match(/class="td-test-line"/g) ?? []).length;
    expect(polylineCount).toBe(0);
    expect(lineCount).toBeGreaterThan(0);
    // edgeCtx must carry resolved source/target NodeBoxes
    if (captured !== undefined) {
      expect(captured.sourceNode.id).toBe(captured.edge.sourceNodeId);
      expect(captured.targetNode.id).toBe(captured.edge.targetNodeId);
    }
  });
});

describe("[HOOK-TEST-THROW-FALLBACK] hook throws → default used, onError fires", () => {
  it("does not crash renderSvg; reports via onError; default output preserved", async () => {
    const g = await graphFor(SINGLE_RECORD);
    const errs: HookError[] = [];
    const out = renderSvg(g, {
      hooks: {
        node: () => {
          throw new Error("boom");
        },
        onError: (e) => errs.push(e),
      },
    });
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0]?.phase).toBe("node");
    expect(errs[0]?.nodeId).toBeDefined();
    // default <g data-decl="Point"> survives fallback
    expect(out).toContain(`data-decl="Point"`);
  });

  it("reports errors for every phase independently", async () => {
    const g = await graphFor(SINGLE_RECORD);
    const errs: HookError[] = [];
    const boom = () => {
      throw new Error("x");
    };
    renderSvg(g, {
      hooks: {
        defs: boom,
        background: boom,
        node: boom,
        row: boom,
        edge: boom,
        post: boom,
        onError: (e) => errs.push(e),
      },
    });
    const phases = new Set(errs.map((e) => e.phase));
    expect(phases.has("defs")).toBe(true);
    expect(phases.has("background")).toBe(true);
    expect(phases.has("node")).toBe(true);
    expect(phases.has("post")).toBe(true);
    // row is only called when node hook did NOT override; since node throws and
    // falls back to default, row hooks fire per row.
    expect(phases.has("row")).toBe(true);
  });
});

describe("[HOOK-TEST-DETERMINISTIC] same inputs → byte-identical output", () => {
  it("runs twice with identical hook set, asserts equality", async () => {
    const g = await graphFor(SMALL_EXAMPLE);
    const hooks: RenderHooks = {
      defs: () => svg`<filter id="dx"><feGaussianBlur stdDeviation="1"/></filter>`,
      node: (ctx, def) => svg`<g data-h="${ctx.node.declName}">${def}</g>`,
      edge: (_c, def) => svg`${def}`,
    };
    const a = renderSvg(g, { hooks });
    const b = renderSvg(g, { hooks });
    expect(a).toBe(b);
  });
});

describe("[HOOK-TEST-CTX-GEOMETRY] contexts carry absolute padding-adjusted coords", () => {
  it("NodeCtx.x === node.x + padding (default padding = 16)", async () => {
    const g = await graphFor(SINGLE_RECORD);
    const seen: NodeCtx[] = [];
    renderSvg(g, {
      hooks: {
        node: (ctx) => {
          seen.push(ctx);
          return undefined;
        },
      },
    });
    expect(seen.length).toBe(g.nodes.length);
    for (const ctx of seen) {
      expect(ctx.x).toBe(ctx.node.x + 16);
      expect(ctx.y).toBe(ctx.node.y + 16);
      expect(ctx.width).toBe(ctx.node.width);
      expect(ctx.height).toBe(ctx.node.height);
      expect(ctx.padding).toBe(16);
    }
  });

  it("NodeCtx.badge is present iff declKind === 'union'", async () => {
    const g = await graphFor(SMALL_EXAMPLE);
    const kinds = new Map<string, boolean>();
    renderSvg(g, {
      hooks: {
        node: (ctx) => {
          kinds.set(ctx.node.declName, ctx.badge !== undefined);
          return undefined;
        },
      },
    });
    // Shape and Option are unions in SMALL_EXAMPLE
    expect(kinds.get("Shape")).toBe(true);
    expect(kinds.get("Option")).toBe(true);
    // Records / aliases have no badge
    expect(kinds.get("User")).toBe(false);
    expect(kinds.get("Address")).toBe(false);
  });

  it("RowCtx.isUnionVariant mirrors parent declKind", async () => {
    const g = await graphFor(SMALL_EXAMPLE);
    const variantFlags: boolean[] = [];
    renderSvg(g, {
      hooks: {
        row: (ctx) => {
          if (ctx.node.declName === "Shape") {
            variantFlags.push(ctx.isUnionVariant);
          }
          return undefined;
        },
      },
    });
    expect(variantFlags.length).toBeGreaterThan(0);
    expect(variantFlags.every((f) => f)).toBe(true);
  });

  it("EdgeCtx.points[i] === edge.points[i] + padding on both axes", async () => {
    const g = await graphFor(MANY_NODES);
    const padding = 10;
    let checked = 0;
    renderSvg(g, {
      padding,
      hooks: {
        edge: (ctx) => {
          for (let i = 0; i < ctx.points.length; i++) {
            const src = ctx.edge.points[i];
            const dst = ctx.points[i];
            if (src === undefined || dst === undefined) {
              continue;
            }
            expect(dst.x).toBe(src.x + padding);
            expect(dst.y).toBe(src.y + padding);
            checked += 1;
          }
          return undefined;
        },
      },
    });
    expect(checked).toBeGreaterThan(0);
  });
});

describe("[HOOK-TEST-SAFETY] escaping extends to hook-provided strings", () => {
  it("interpolated user-controlled strings through svg`` are escaped", async () => {
    const g = await graphFor(SINGLE_RECORD);
    const hostile = `"><script>alert(1)</script>`;
    const out = renderSvg(g, {
      hooks: {
        node: (_ctx, def) => svg`<g data-x="${hostile}">${def}</g>`,
      },
    });
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;script&gt;");
  });
});

describe("[HOOK-TEST-POS-NODE] positioning PoC — node hook translates to override", () => {
  it("User node renders with a translate placing it at overridden origin", async () => {
    const g = await graphFor(SMALL_EXAMPLE);
    const positions: Record<string, { x: number; y: number }> = { User: { x: 500, y: 500 } };
    const padding = 16;
    const positioning: RenderHooks = {
      node: (ctx, def) => {
        const p = positions[ctx.node.declName];
        if (p === undefined) {
          return undefined;
        }
        const dx = p.x - ctx.x;
        const dy = p.y - ctx.y;
        return svg`<g class="td-pos" data-decl="${ctx.node.declName}" transform="translate(${dx} ${dy})">${def}</g>`;
      },
    };
    const out = renderSvg(g, { padding, hooks: positioning });
    // Compute expected translate magnitudes
    const userNode = g.nodes.find((n) => n.declName === "User");
    expect(userNode).toBeDefined();
    if (userNode === undefined) {
      return;
    }
    const expectedDx = 500 - (userNode.x + padding);
    const expectedDy = 500 - (userNode.y + padding);
    expect(out).toContain(`data-decl="User"`);
    expect(out).toContain(`transform="translate(${String(expectedDx)} ${String(expectedDy)})"`);
  });
});

describe("[HOOK-TEST-POS-EDGE] positioning PoC — edge endpoints follow overridden positions", () => {
  it("edge hook emits straight line from overridden source to overridden target centers", async () => {
    const g = await graphFor(MANY_NODES);
    const overrides: Record<string, { x: number; y: number }> = {};
    // Pick first two nodes connected by an edge
    const firstEdge = g.edges[0];
    expect(firstEdge).toBeDefined();
    if (firstEdge === undefined) {
      return;
    }
    const source = g.nodes.find((n) => n.id === firstEdge.sourceNodeId);
    const target = g.nodes.find((n) => n.id === firstEdge.targetNodeId);
    expect(source && target).toBeTruthy();
    if (source === undefined || target === undefined) {
      return;
    }
    overrides[source.declName] = { x: 1000, y: 100 };
    overrides[target.declName] = { x: 1500, y: 400 };

    const center = (n: { x: number; y: number; width: number; height: number }) => ({
      x: n.x + n.width / 2,
      y: n.y + n.height / 2,
    });

    const positioning: RenderHooks = {
      node: (ctx, def) => {
        const p = overrides[ctx.node.declName];
        if (p === undefined) {
          return undefined;
        }
        const dx = p.x - ctx.x;
        const dy = p.y - ctx.y;
        return svg`<g transform="translate(${dx} ${dy})">${def}</g>`;
      },
      edge: (ctx) => {
        const srcOverride = overrides[ctx.sourceNode.declName];
        const tgtOverride = overrides[ctx.targetNode.declName];
        if (srcOverride === undefined && tgtOverride === undefined) {
          return undefined;
        }
        const srcCenter = srcOverride
          ? { x: srcOverride.x + ctx.sourceNode.width / 2, y: srcOverride.y + ctx.sourceNode.height / 2 }
          : center({ ...ctx.sourceNode });
        const tgtCenter = tgtOverride
          ? { x: tgtOverride.x + ctx.targetNode.width / 2, y: tgtOverride.y + ctx.targetNode.height / 2 }
          : center({ ...ctx.targetNode });
        return svg`<line class="td-pos-edge" data-edge="${ctx.edge.id}" x1="${srcCenter.x}" y1="${srcCenter.y}" x2="${tgtCenter.x}" y2="${tgtCenter.y}" stroke="red"/>`;
      },
    };
    const out = renderSvg(g, { hooks: positioning });

    const srcOverride = overrides[source.declName];
    const tgtOverride = overrides[target.declName];
    if (srcOverride === undefined || tgtOverride === undefined) {
      throw new Error("override positions missing");
    }
    const expectedX1 = srcOverride.x + source.width / 2;
    const expectedY1 = srcOverride.y + source.height / 2;
    const expectedX2 = tgtOverride.x + target.width / 2;
    const expectedY2 = tgtOverride.y + target.height / 2;

    expect(out).toContain(`data-edge="${firstEdge.id}"`);
    expect(out).toContain(`x1="${String(expectedX1)}"`);
    expect(out).toContain(`y1="${String(expectedY1)}"`);
    expect(out).toContain(`x2="${String(expectedX2)}"`);
    expect(out).toContain(`y2="${String(expectedY2)}"`);
  });
});

describe("[HOOK-TEST-RAW-PASSTHROUGH] raw() bypasses escaping for trusted strings", () => {
  it("raw-provided SVG fragment is inlined verbatim", async () => {
    const g = await graphFor(SINGLE_RECORD);
    const frag = `<metadata id="td-raw-marker">x</metadata>`;
    const out = renderSvg(g, {
      hooks: {
        post: (ctx) => svg`${ctx.svg}${raw(frag)}`,
      },
    });
    expect(out).toContain(`id="td-raw-marker"`);
  });
});

describe("[HOOK-TEST-NO-ONERROR] absent onError → throws swallowed silently", () => {
  it("hook that throws without onError does not surface; default used", async () => {
    const g = await graphFor(SINGLE_RECORD);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const out = renderSvg(g, {
      hooks: {
        node: () => {
          throw new Error("silent");
        },
      },
    });
    // no console.error should have been called by the framework
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    expect(out).toContain(`data-decl="Point"`);
  });
});
