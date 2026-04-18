import type { EdgeRoute, LaidOutGraph, NodeBox, NodeRow } from "../layout/types.js";
import {
  invokeHook,
  invokeSimpleHook,
  type BackgroundCtx,
  type BaseCtx,
  type DefsCtx,
  type EdgeCtx,
  type NodeCtx,
  type PostCtx,
  type RenderHooks,
  type RowCtx,
} from "./hooks.js";
import { escapeText, raw, svg, type SafeSvg } from "./svg-tag.js";
import { getTheme, type Theme, type ThemeName } from "./theme.js";

export interface SvgOpts {
  theme?: ThemeName;
  fontSize?: number;
  /** Outer padding around the diagram. */
  padding?: number;
  /** [HOOK-API] Optional render hooks for extending SVG output. */
  hooks?: RenderHooks;
}

const DEFAULT_FONT_SIZE = 13;
const DEFAULT_PADDING = 16;

/** [RENDER-UNION-ONEOF] Height of the "one of" badge below union headers. */
const UNION_BADGE_H = 16;

interface RenderCtx {
  readonly theme: Theme;
  readonly fontSize: number;
  readonly padding: number;
  readonly graph: LaidOutGraph;
  readonly hooks?: RenderHooks;
  readonly width: number;
  readonly height: number;
  readonly nodeById: ReadonlyMap<string, NodeBox>;
}

export function renderSvg(graph: LaidOutGraph, opts: SvgOpts = {}): string {
  const ctx = buildRenderCtx(graph, opts);
  const defs = renderDefs(ctx);
  const background = renderBackgroundLine(ctx);
  const nodes = raw(graph.nodes.map((n) => renderNodeWithHook(n, ctx).value).join("\n"));
  const edges = raw(graph.edges.map((e) => renderEdgeWithHook(e, ctx).value).join("\n"));
  const body = svg`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ctx.width} ${ctx.height}" width="${ctx.width}" height="${ctx.height}" font-family="${ctx.theme.fontFamily}" font-size="${ctx.fontSize}">
${defs}
<rect x="0" y="0" width="${ctx.width}" height="${ctx.height}" fill="none"/>${background}
${nodes}
${edges}
</svg>`;
  return applyPostHook(body, ctx).value;
}

/** Emit background with its own leading newline when present, or nothing, preserving default byte-output. */
function renderBackgroundLine(ctx: RenderCtx): SafeSvg {
  const arg: BackgroundCtx = { ...baseCtx(ctx), width: ctx.width, height: ctx.height };
  const out = invokeSimpleHook<BackgroundCtx>(ctx.hooks?.background, arg, "background", ctx.hooks?.onError);
  if (out === undefined) {
    return raw("");
  }
  return svg`\n${out}`;
}

function buildRenderCtx(graph: LaidOutGraph, opts: SvgOpts): RenderCtx {
  const theme = getTheme(opts.theme ?? "light");
  const fontSize = opts.fontSize ?? DEFAULT_FONT_SIZE;
  const padding = opts.padding ?? DEFAULT_PADDING;
  const width = Math.max(1, Math.ceil(graph.width + padding * 2));
  const height = Math.max(1, Math.ceil(graph.height + padding * 2));
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n] as const));
  return { theme, fontSize, padding, graph, width, height, nodeById, ...(opts.hooks ? { hooks: opts.hooks } : {}) };
}

function baseCtx(ctx: RenderCtx): BaseCtx {
  return { theme: ctx.theme, fontSize: ctx.fontSize, padding: ctx.padding, graph: ctx.graph };
}

function renderDefs(ctx: RenderCtx): SafeSvg {
  const base = defaultDefs(ctx.theme);
  const extra = invokeSimpleHook<DefsCtx>(ctx.hooks?.defs, baseCtx(ctx), "defs", ctx.hooks?.onError);
  if (extra === undefined) {
    return svg`<defs>
  ${base}
</defs>`;
  }
  return svg`<defs>
  ${base}
  ${extra}
</defs>`;
}

function defaultDefs(theme: Theme): SafeSvg {
  return svg`<marker id="td-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
    <path d="M0,0 L10,5 L0,10 z" fill="${theme.edgeStroke}"/>
  </marker>`;
}

function applyPostHook(body: SafeSvg, ctx: RenderCtx): SafeSvg {
  const post = ctx.hooks?.post;
  if (post === undefined) {
    return body;
  }
  const arg: PostCtx = { ...baseCtx(ctx), width: ctx.width, height: ctx.height, svg: body };
  try {
    return post(arg);
  } catch (error) {
    ctx.hooks?.onError?.({ phase: "post", error });
    return body;
  }
}

function accentFor(declKind: NodeBox["declKind"], theme: Theme): string {
  return declKind === "union" ? theme.unionAccent : declKind === "alias" ? theme.aliasAccent : theme.recordAccent;
}

interface NodeGeometry {
  x: number;
  y: number;
  isUnion: boolean;
  firstRowY: number;
  nameHeaderH: number;
  headerFill: string;
  accent: string;
}

function nodeGeometry(n: NodeBox, ctx: RenderCtx): NodeGeometry {
  const isUnion = n.declKind === "union";
  const firstRowY = n.rows[0]?.y ?? n.height;
  return {
    x: n.x + ctx.padding,
    y: n.y + ctx.padding,
    isUnion,
    firstRowY,
    nameHeaderH: isUnion ? firstRowY - UNION_BADGE_H : firstRowY,
    headerFill: isUnion ? ctx.theme.unionHeaderFill : ctx.theme.headerFill,
    accent: accentFor(n.declKind, ctx.theme),
  };
}

function buildNodeCtx(n: NodeBox, ctx: RenderCtx, geo: NodeGeometry): NodeCtx {
  const badge = geo.isUnion
    ? {
        y: geo.y + geo.nameHeaderH,
        height: UNION_BADGE_H,
        fontSize: Math.round(ctx.fontSize * 0.7),
      }
    : undefined;
  return {
    ...baseCtx(ctx),
    node: n,
    x: geo.x,
    y: geo.y,
    width: n.width,
    height: n.height,
    accent: geo.accent,
    isUnion: geo.isUnion,
    header: { text: n.header, height: geo.firstRowY, fill: geo.headerFill },
    ...(badge ? { badge } : {}),
  };
}

function renderNodeWithHook(n: NodeBox, ctx: RenderCtx): SafeSvg {
  const geo = nodeGeometry(n, ctx);
  const nodeCtx = buildNodeCtx(n, ctx, geo);
  // [HOOK-NODE-ROW-COMPOSE] Row hooks always run first, so the `def` passed to
  // the node hook already reflects any per-row customizations. A node hook
  // that wraps `def` preserves those row effects. A node hook that returns a
  // completely new <g> discards them — that is the user's decision, made
  // visible by the code they wrote.
  const defaultWithRowHooks = renderDefaultNode(n, ctx, geo, nodeCtx, true);
  const nodeHook = ctx.hooks?.node;
  if (nodeHook === undefined) {
    return defaultWithRowHooks;
  }
  const { svg: out } = invokeHook<NodeCtx>(nodeHook, nodeCtx, defaultWithRowHooks, "node", ctx.hooks?.onError, {
    nodeId: n.id,
  });
  return out;
}

function renderDefaultNode(
  n: NodeBox,
  ctx: RenderCtx,
  geo: NodeGeometry,
  nodeCtx: NodeCtx,
  invokeRowHooks: boolean
): SafeSvg {
  const rows = renderRows(n, ctx, geo, nodeCtx, invokeRowHooks);
  const headerY = geo.y + geo.nameHeaderH / 2 + ctx.fontSize * 0.35;
  const badge = geo.isUnion
    ? renderUnionBadge(geo.x, geo.y + geo.nameHeaderH, UNION_BADGE_H, n.width, ctx.theme, ctx.fontSize)
    : raw("");
  return svg`<g data-decl="${n.declName}" data-kind="${n.declKind}">
  <rect x="${geo.x}" y="${geo.y}" width="${n.width}" height="${n.height}" rx="6" ry="6" fill="${ctx.theme.nodeFill}" stroke="${ctx.theme.nodeStroke}" stroke-width="1"/>
  <rect x="${geo.x}" y="${geo.y}" width="${n.width}" height="${geo.firstRowY}" rx="6" ry="6" fill="${geo.headerFill}" stroke="none"/>
  <rect x="${geo.x}" y="${geo.y + geo.firstRowY - 6}" width="${n.width}" height="6" fill="${geo.headerFill}" stroke="none"/>
  <line x1="${geo.x}" y1="${geo.y + geo.firstRowY}" x2="${geo.x + n.width}" y2="${geo.y + geo.firstRowY}" stroke="${ctx.theme.nodeStroke}" stroke-width="1"/>
  <rect x="${geo.x}" y="${geo.y}" width="4" height="${n.height}" rx="2" ry="2" fill="${geo.accent}"/>
  <text x="${geo.x + 10}" y="${headerY}" fill="${ctx.theme.headerText}" font-weight="600">${raw(escapeText(n.header))}</text>
  ${badge}
  ${rows}
</g>`;
}

function renderRows(n: NodeBox, ctx: RenderCtx, geo: NodeGeometry, nodeCtx: NodeCtx, invokeRowHooks: boolean): SafeSvg {
  const parts = n.rows.map((r, i) => renderRow(n, r, i, ctx, geo, nodeCtx, invokeRowHooks).value);
  return raw(parts.join("\n"));
}

function renderRow(
  n: NodeBox,
  r: NodeRow,
  i: number,
  ctx: RenderCtx,
  geo: NodeGeometry,
  nodeCtx: NodeCtx,
  invokeRowHooks: boolean
): SafeSvg {
  const def = renderDefaultRow(n, r, ctx, geo, nodeCtx.isUnion);
  if (!invokeRowHooks) {
    return def;
  }
  const rowCtx = buildRowCtx(n, r, i, ctx, geo, nodeCtx);
  const { svg: out } = invokeHook<RowCtx>(ctx.hooks?.row, rowCtx, def, "row", ctx.hooks?.onError, { nodeId: n.id });
  return out;
}

function buildRowCtx(n: NodeBox, r: NodeRow, i: number, ctx: RenderCtx, geo: NodeGeometry, nodeCtx: NodeCtx): RowCtx {
  const ry = geo.y + r.y;
  return {
    ...baseCtx(ctx),
    node: n,
    row: r,
    rowIndex: i,
    x: geo.x,
    y: ry,
    width: n.width,
    height: r.height,
    isUnionVariant: nodeCtx.isUnion,
    textX: geo.x + 10,
    textY: ry + r.height / 2 + ctx.fontSize * 0.35,
  };
}

function renderDefaultRow(n: NodeBox, r: NodeRow, ctx: RenderCtx, geo: NodeGeometry, isUnion: boolean): SafeSvg {
  const ry = geo.y + r.y;
  const dashAttr = isUnion ? raw(` stroke-dasharray="4 3"`) : raw("");
  const textY = ry + r.height / 2 + ctx.fontSize * 0.35;
  const prefix = isUnion ? "\u25c7 " : "";
  const divider = svg`<line x1="${geo.x}" y1="${ry}" x2="${geo.x + n.width}" y2="${ry}" stroke="${ctx.theme.rowDivider}" stroke-width="1"${dashAttr}/>`;
  const text = svg`<text x="${geo.x + 10}" y="${textY}" fill="${ctx.theme.rowText}">${raw(escapeText(prefix + r.text))}</text>`;
  return raw(`${divider.value}\n${text.value}`);
}

function renderUnionBadge(
  x: number,
  headerBottom: number,
  badgeH: number,
  width: number,
  theme: Theme,
  fontSize: number
): SafeSvg {
  const badgeY = headerBottom + badgeH / 2 + fontSize * 0.2;
  const badgeFontSize = Math.round(fontSize * 0.7);
  return svg`<text x="${x + width / 2}" y="${badgeY}" fill="${theme.unionBadgeText}" font-size="${badgeFontSize}" font-weight="700" text-anchor="middle" font-style="italic" letter-spacing="0.08em">ONE OF</text>
  <line x1="${x}" y1="${headerBottom + badgeH}" x2="${x + width}" y2="${headerBottom + badgeH}" stroke="${theme.rowDivider}" stroke-width="1"/>`;
}

function renderEdgeWithHook(e: EdgeRoute, ctx: RenderCtx): SafeSvg {
  const empty = raw("");
  if (e.points.length < 2) {
    return empty;
  }
  const edgeCtx = buildEdgeCtx(e, ctx);
  const def = renderDefaultEdge(e, ctx, edgeCtx);
  const { svg: out } = invokeHook<EdgeCtx>(ctx.hooks?.edge, edgeCtx, def, "edge", ctx.hooks?.onError, { edgeId: e.id });
  return out;
}

function buildEdgeCtx(e: EdgeRoute, ctx: RenderCtx): EdgeCtx {
  const pts = e.points.map((p) => ({ x: p.x + ctx.padding, y: p.y + ctx.padding }));
  const mid = midpoint(e.points);
  const source = ctx.nodeById.get(e.sourceNodeId);
  const target = ctx.nodeById.get(e.targetNodeId);
  if (source === undefined || target === undefined) {
    throw new Error(
      `[HOOK-EDGE] edge ${e.id} references unknown node (source=${e.sourceNodeId} target=${e.targetNodeId})`
    );
  }
  const dash = e.kind === "genericArg" ? "3 3" : undefined;
  return {
    ...baseCtx(ctx),
    edge: e,
    points: pts,
    midpoint: { x: mid.x + ctx.padding, y: mid.y + ctx.padding },
    sourceNode: source,
    targetNode: target,
    stroke: ctx.theme.edgeStroke,
    strokeWidth: e.kind === "genericArg" ? 1 : 1.5,
    ...(dash ? { dashArray: dash } : {}),
  };
}

function renderDefaultEdge(e: EdgeRoute, ctx: RenderCtx, edgeCtx: EdgeCtx): SafeSvg {
  const points = edgeCtx.points.map((p) => `${String(p.x)},${String(p.y)}`).join(" ");
  const dash = edgeCtx.dashArray !== undefined ? raw(`stroke-dasharray="${edgeCtx.dashArray}"`) : raw("");
  const polyline = svg`<polyline points="${points}" fill="none" stroke="${edgeCtx.stroke}" stroke-width="${edgeCtx.strokeWidth}" marker-end="url(#td-arrow)" ${dash}/>`;
  const label =
    e.label === ""
      ? raw("")
      : svg`<text x="${edgeCtx.midpoint.x}" y="${edgeCtx.midpoint.y - 4}" fill="${ctx.theme.edgeText}" font-size="${Math.round(ctx.fontSize * 0.85)}" text-anchor="middle">${raw(escapeText(e.label))}</text>`;
  return raw(`${polyline.value}\n${label.value}`);
}

function midpoint(points: ReadonlyArray<{ x: number; y: number }>): { x: number; y: number } {
  if (points.length === 2) {
    const [a, b] = points;
    if (a !== undefined && b !== undefined) {
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }
  }
  const mid = Math.floor(points.length / 2);
  const prev = points[mid - 1];
  const next = points[mid];
  if (prev === undefined || next === undefined) {
    return { x: 0, y: 0 };
  }
  return { x: (prev.x + next.x) / 2, y: (prev.y + next.y) / 2 };
}
