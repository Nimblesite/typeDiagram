import ELK from "elkjs/lib/elk.bundled.js";
import type { Diagnostic } from "../parser/diagnostics.js";
import { type Result, err, ok } from "../result.js";
import type { Edge, Model, ResolvedDecl, ResolvedTypeRef } from "../model/types.js";
import { measureBlock, measureText } from "./measure.js";
import type { EdgeRoute, LaidOutGraph, LayoutOpts, NodeBox, NodeRow } from "./types.js";

const DEFAULT_FONT_SIZE = 13;
const DEFAULT_PAD_X = 12;
const DEFAULT_PAD_Y = 6;
const HEADER_PAD_Y = 8;
/** [RENDER-UNION-ONEOF] Extra height for the "one of" badge below union headers. */
const UNION_BADGE_H = 16;

interface ElkPort {
  id: string;
  width: number;
  height: number;
  layoutOptions?: Record<string, string>;
  properties?: Record<string, string>;
}

interface ElkNode {
  id: string;
  width: number;
  height: number;
  ports?: ElkPort[];
  layoutOptions?: Record<string, string>;
  properties?: Record<string, string>;
}

interface ElkEdge {
  id: string;
  sources: string[];
  targets: string[];
}

interface ElkGraph {
  id: string;
  layoutOptions: Record<string, string>;
  children: ElkNode[];
  edges: ElkEdge[];
}

interface ElkResultNode {
  id: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  ports?: Array<{ id: string; x?: number; y?: number; width?: number; height?: number }>;
}

interface ElkResultEdge {
  id: string;
  sections?: Array<{
    startPoint: { x: number; y: number };
    endPoint: { x: number; y: number };
    bendPoints?: Array<{ x: number; y: number }>;
  }>;
}

interface ElkResult {
  width?: number;
  height?: number;
  children?: ElkResultNode[];
  edges?: ElkResultEdge[];
}

interface PreNode {
  id: string;
  decl: ResolvedDecl;
  header: string;
  rows: NodeRow[];
  width: number;
  height: number;
}

function rowText(name: string, type: ResolvedTypeRef): string {
  return `${name}: ${printRefShort(type)}`;
}

function printRefShort(t: ResolvedTypeRef): string {
  if (t.args.length === 0) {
    return t.name;
  }
  return `${t.name}<${t.args.map(printRefShort).join(", ")}>`;
}

function declHeader(d: ResolvedDecl): string {
  const generics = d.generics.length === 0 ? "" : `<${d.generics.join(", ")}>`;
  const tag = d.kind === "record" ? "" : d.kind === "union" ? "union " : "alias ";
  return `${tag}${d.name}${generics}`;
}

function buildPreNodes(decls: ResolvedDecl[], fontSize: number, padX: number, padY: number): PreNode[] {
  const rowH = fontSize * 1.4 + padY * 0.5;
  const headerH = fontSize * 1.4 + HEADER_PAD_Y * 2;
  const out: PreNode[] = [];

  for (const d of decls) {
    const header = declHeader(d);
    const headerSize = measureText(header, fontSize);
    let widest = headerSize.w;
    const rows: NodeRow[] = [];
    /** [RENDER-UNION-ONEOF] Union nodes get extra badge space below the header. */
    let y = d.kind === "union" ? headerH + UNION_BADGE_H : headerH;

    if (d.kind === "record") {
      for (const f of d.fields) {
        const text = rowText(f.name, f.type);
        const m = measureText(text, fontSize);
        if (m.w > widest) {
          widest = m.w;
        }
        rows.push({ text, y, height: rowH });
        y += rowH;
      }
    } else if (d.kind === "union") {
      for (const v of d.variants) {
        const variantHeader =
          v.fields.length === 0 ? v.name : `${v.name} { ${v.fields.map((f) => rowText(f.name, f.type)).join(", ")} }`;
        const m = measureText(variantHeader, fontSize);
        if (m.w > widest) {
          widest = m.w;
        }
        rows.push({ text: variantHeader, y, height: rowH });
        y += rowH;
      }
    } else {
      const text = `= ${printRefShort(d.target)}`;
      const m = measureText(text, fontSize);
      if (m.w > widest) {
        widest = m.w;
      }
      rows.push({ text, y, height: rowH });
      y += rowH;
    }

    const width = Math.ceil(widest + padX * 2);
    const height = Math.ceil(y);
    out.push({ id: d.name, decl: d, header, rows, width, height });
  }

  // suppress unused-var warning
  void measureBlock;
  return out;
}

function rowPortId(nodeId: string, rowIndex: number): string {
  return `${nodeId}::row::${String(rowIndex)}`;
}

function headerPortId(nodeId: string): string {
  return `${nodeId}::header`;
}

function edgeContentId(e: Edge): string {
  return `${e.sourceDeclName}:${String(e.sourceRowIndex)}:${e.targetDeclName}:${e.kind}`;
}

function edgePortIds(e: Edge): { sourcePort: string; targetPort: string } {
  const sourcePort =
    e.sourceRowIndex < 0 ? headerPortId(e.sourceDeclName) : rowPortId(e.sourceDeclName, e.sourceRowIndex);
  const targetPort = headerPortId(e.targetDeclName);
  return { sourcePort, targetPort };
}

interface ElkBuild {
  graph: ElkGraph;
  edgeMap: Map<string, Edge>;
}

function buildElkGraph(model: Model, pre: PreNode[]): ElkBuild {
  const nodeOptions: Record<string, string> = {
    "elk.portConstraints": "FIXED_SIDE",
  };

  const children: ElkNode[] = pre.map((n) => {
    const ports: ElkPort[] = [];
    ports.push({
      id: headerPortId(n.id),
      width: 1,
      height: 1,
      layoutOptions: { "elk.port.side": "WEST" },
      properties: { "port.index": "0" },
    });
    n.rows.forEach((_r, i) => {
      ports.push({
        id: rowPortId(n.id, i),
        width: 1,
        height: 1,
        layoutOptions: { "elk.port.side": "EAST" },
      });
    });
    return { id: n.id, width: n.width, height: n.height, ports, layoutOptions: nodeOptions };
  });

  const edgeMap = new Map<string, Edge>();
  const edges: ElkEdge[] = model.edges.map((e) => {
    const id = edgeContentId(e);
    edgeMap.set(id, e);
    const { sourcePort, targetPort } = edgePortIds(e);
    return { id, sources: [sourcePort], targets: [targetPort] };
  });

  const graph: ElkGraph = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.spacing.nodeNode": "40",
      "elk.layered.spacing.nodeNodeBetweenLayers": "60",
      "elk.spacing.edgeNode": "20",
    },
    children,
    edges,
  };
  return { graph, edgeMap };
}

function projectResult(pre: PreNode[], edgeMap: Map<string, Edge>, elkResult: ElkResult): LaidOutGraph {
  const preById = new Map(pre.map((n) => [n.id, n]));
  const nodes: NodeBox[] = (elkResult.children ?? []).flatMap((c) => {
    const p = preById.get(c.id);
    if (p === undefined) {
      return [];
    }
    return [
      {
        id: p.id,
        declName: p.decl.name,
        declKind: p.decl.kind,
        x: c.x ?? 0,
        y: c.y ?? 0,
        width: c.width ?? p.width,
        height: c.height ?? p.height,
        header: p.header,
        rows: p.rows.map((r) => ({ ...r })),
      },
    ];
  });

  const edges: EdgeRoute[] = (elkResult.edges ?? []).flatMap((e) => {
    const modelEdge = edgeMap.get(e.id);
    if (modelEdge === undefined) {
      return [];
    }
    const section = e.sections?.[0];
    const points = section ? [section.startPoint, ...(section.bendPoints ?? []), section.endPoint] : [];
    return [
      {
        id: e.id,
        sourceNodeId: modelEdge.sourceDeclName,
        targetNodeId: modelEdge.targetDeclName,
        points,
        label: modelEdge.label,
        kind: modelEdge.kind,
      },
    ];
  });

  return { width: elkResult.width ?? 0, height: elkResult.height ?? 0, nodes, edges };
}

let elkInstance: InstanceType<typeof ELK> | null = null;
function getElk(): InstanceType<typeof ELK> {
  elkInstance ??= new ELK();
  return elkInstance;
}

// [LAYOUT-SYNC] Sync layout is possible because elk.bundled.js is pure JS whose
// algorithm runs synchronously; elkjs wraps dispatch in `setTimeout(_, 0)` inside
// PromisedWorker (see elk-api.js) to emulate a Web Worker. We bypass that wrapper
// by reaching into the fake worker's dispatcher directly. elkjs must be warmed up
// (one async layout) first so layout algorithms are registered; subsequent sync
// calls reuse that registration. Fragile to elkjs internal shape — pinned to 0.9.x.
interface FakeWorkerDispatcher {
  saveDispatch: (msg: {
    data: { id: number; cmd: string; graph: unknown; layoutOptions: unknown; options: unknown };
  }) => void;
}
interface FakeWorker {
  dispatcher: FakeWorkerDispatcher;
}
interface PromisedWorker {
  worker: FakeWorker;
}
interface ElkInternal {
  worker: PromisedWorker;
  initialized: boolean;
}

let warmedUp = false;

export async function warmupLayout(): Promise<void> {
  if (warmedUp) {
    return;
  }
  const trivial: ElkGraph = {
    id: "__warmup",
    layoutOptions: { "elk.algorithm": "layered", "elk.direction": "RIGHT" },
    children: [
      { id: "a", width: 1, height: 1 },
      { id: "b", width: 1, height: 1 },
    ],
    edges: [{ id: "e", sources: ["a"], targets: ["b"] }],
  };
  await getElk().layout(trivial as unknown as Parameters<InstanceType<typeof ELK>["layout"]>[0]);
  warmedUp = true;
}

export function isLayoutWarm(): boolean {
  return warmedUp;
}

interface ElkSyncAnswer {
  id: number;
  data?: ElkResult;
  error?: { message?: string };
}

function callElkSync(graph: ElkGraph): ElkResult {
  const elk = getElk() as unknown as ElkInternal;
  const DispatcherCtor = elk.worker.worker.dispatcher.constructor as new (client: {
    postMessage: (msg: ElkSyncAnswer) => void;
  }) => FakeWorkerDispatcher;
  const answers: ElkSyncAnswer[] = [];
  const dispatcher = new DispatcherCtor({ postMessage: (m) => answers.push(m) });
  const graphCopy = JSON.parse(JSON.stringify(graph)) as unknown;
  dispatcher.saveDispatch({ data: { id: 0, cmd: "layout", graph: graphCopy, layoutOptions: {}, options: {} } });
  const answer = answers[0];
  if (answer === undefined) {
    throw new Error("elk sync dispatcher returned no answer");
  }
  if (answer.error) {
    throw new Error(answer.error.message ?? "elk sync error");
  }
  if (!answer.data) {
    throw new Error("elk sync dispatcher returned no data");
  }
  return answer.data;
}

// [LAYOUT-SHARED] Produces the ElkGraph + projection pieces used by BOTH sync and async.
function prepare(model: Model, opts: LayoutOpts): { pre: PreNode[]; graph: ElkGraph; edgeMap: Map<string, Edge> } {
  const fontSize = opts.fontSize ?? DEFAULT_FONT_SIZE;
  const padX = opts.rowPaddingX ?? DEFAULT_PAD_X;
  const padY = opts.rowPaddingY ?? DEFAULT_PAD_Y;
  const pre = buildPreNodes(model.decls, fontSize, padX, padY);
  const { graph, edgeMap } = buildElkGraph(model, pre);
  return { pre, graph, edgeMap };
}

function layoutError(e: unknown): Result<LaidOutGraph, Diagnostic[]> {
  return err([
    {
      severity: "error",
      message: `layout failed: ${(e as Error).message}`,
      line: 0,
      col: 0,
      length: 0,
    },
  ]);
}

export async function layout(model: Model, opts: LayoutOpts = {}): Promise<Result<LaidOutGraph, Diagnostic[]>> {
  const { pre, graph, edgeMap } = prepare(model, opts);
  try {
    const result = (await getElk().layout(
      graph as unknown as Parameters<InstanceType<typeof ELK>["layout"]>[0]
    )) as unknown as ElkResult;
    warmedUp = true;
    return ok(projectResult(pre, edgeMap, result));
  } catch (e) {
    return layoutError(e);
  }
}

// [LAYOUT-SYNC] Synchronous layout. Caller MUST have awaited `warmupLayout()` (or any
// async `layout()` call) at least once before invoking this.
export function layoutSync(model: Model, opts: LayoutOpts = {}): Result<LaidOutGraph, Diagnostic[]> {
  if (!warmedUp) {
    return err([
      {
        severity: "error",
        message: "layoutSync called before warmup; call warmupLayout() first",
        line: 0,
        col: 0,
        length: 0,
      },
    ]);
  }
  const { pre, graph, edgeMap } = prepare(model, opts);
  try {
    const result = callElkSync(graph);
    return ok(projectResult(pre, edgeMap, result));
  } catch (e) {
    return layoutError(e);
  }
}
