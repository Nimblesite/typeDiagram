// [EDITOR-CANVAS] Direct manipulation for rendered typeDiagram SVGs.
import { parse } from "../parser/index.js";
import { buildModel } from "../model/build.js";
import type { ResolvedDataDecl, ResolvedTypeRef } from "../model/types.js";
import { addDeclaration, connectDeclarations } from "./source-editor.js";
import { createCanvasChrome, type CanvasChrome } from "./controls.js";
import { installVisualEditorStyles } from "./styles.js";
import { createViewport, setViewportContent, type ViewportControls } from "./viewport.js";
import { runWhen, runWhenDefined } from "./effects.js";
import { applyMutation, renderInspector, type EditorNode, type EditorRow } from "./inspector.js";

export type NodePosition = { x: number; y: number };
export type VisualEditorOptions = {
  getSource: () => string;
  onSourceChange: (source: string) => void;
  initialPositions?: Readonly<Record<string, NodePosition>>;
  onPositionsChange?: (positions: Readonly<Record<string, NodePosition>>) => void;
};
export type VisualEditor = ViewportControls & { setContent: (html: string) => void; refresh: () => void };

type DragState = { name: string; startX: number; startY: number; origin: NodePosition; moved: boolean };
type ConnectState = { name: string; rowIndex: number; path: SVGPathElement };
type EditorState = {
  selected: string | undefined;
  drag: DragState | undefined;
  connect: ConnectState | undefined;
  suppressClick: boolean;
  positions: Map<string, NodePosition>;
  polylines: WeakMap<SVGPolylineElement, Array<NodePosition>>;
};
type EditorContext = {
  state: EditorState;
  options: VisualEditorOptions;
  chrome: CanvasChrome;
  viewport: ViewportControls;
};
type NodeContext = EditorContext & { svg: SVGSVGElement };
type TrackingContext = NodeContext;

const SVG_NS = "http://www.w3.org/2000/svg";
const snap = (value: number) => Math.round(value / 8) * 8;
const refText = (ref: ResolvedTypeRef): string =>
  ref.args.length === 0 ? ref.name : `${ref.name}<${ref.args.map(refText).join(", ")}>`;

const declRows = (decl: ResolvedDataDecl): EditorRow[] => {
  switch (decl.kind) {
    case "record":
      return decl.fields.map((field) => ({ name: field.name, type: refText(field.type) }));
    case "union":
      return decl.variants.map((variant) => ({
        name: variant.name,
        type: variant.fields[0]?.type ? refText(variant.fields[0].type) : "",
      }));
    case "alias":
      return [{ name: "target", type: refText(decl.target) }];
  }
};

const inspectNode = (source: string, name: string): EditorNode | undefined => {
  const parsed = parse(source);
  const built = parsed.ok ? buildModel(parsed.value) : undefined;
  const decl = built?.ok === true ? built.value.decls.find((candidate) => candidate.name === name) : undefined;
  return decl === undefined || decl.kind === "function"
    ? undefined
    : { name: decl.name, kind: decl.kind, rows: declRows(decl) };
};

const positionRecord = (positions: Map<string, NodePosition>) => Object.fromEntries(positions.entries());

const applyNodePosition = (node: SVGGElement, position: NodePosition) => {
  node.setAttribute("transform", `translate(${String(position.x)} ${String(position.y)})`);
  node.dataset.editorX = String(position.x);
  node.dataset.editorY = String(position.y);
};

const basePoints = (polyline: SVGPolylineElement) =>
  Array.from(polyline.points).map((point) => ({ x: point.x, y: point.y }));

const shiftedPoints = (points: NodePosition[], source: NodePosition, target: NodePosition) =>
  points.map((point, index) => {
    const offset =
      index < Math.min(2, points.length / 2) ? source : index >= points.length - 2 ? target : { x: 0, y: 0 };
    return { x: point.x + offset.x, y: point.y + offset.y };
  });

const updateEdge = (edge: SVGGElement, state: EditorState) => {
  const polyline = edge.querySelector("polyline");
  const line = polyline instanceof SVGPolylineElement ? polyline : undefined;
  const source = state.positions.get(edge.dataset.source ?? "") ?? { x: 0, y: 0 };
  const target = state.positions.get(edge.dataset.target ?? "") ?? { x: 0, y: 0 };
  runWhenDefined(line, (current) => {
    const original = state.polylines.get(current) ?? basePoints(current);
    state.polylines.set(current, original);
    current.setAttribute(
      "points",
      shiftedPoints(original, source, target)
        .map((point) => `${String(point.x)},${String(point.y)}`)
        .join(" ")
    );
  });
};

const updateEdges = (svg: SVGSVGElement, state: EditorState) => {
  svg.querySelectorAll<SVGGElement>("g[data-edge]").forEach((edge) => {
    updateEdge(edge, state);
  });
};

const circle = (x: number, y: number, className: string, rowIndex: number) => {
  const port = document.createElementNS(SVG_NS, "circle");
  port.setAttribute("cx", String(x));
  port.setAttribute("cy", String(y));
  port.setAttribute("r", "4.5");
  port.setAttribute("class", `td-port ${className}`.trim());
  port.setAttribute("data-td-interactive", "true");
  port.dataset.rowIndex = String(rowIndex);
  return port;
};

const numberData = (element: SVGGElement, key: string) => Number(element.dataset[key] ?? "0");

const decoratePorts = (node: SVGGElement) => {
  const x = numberData(node, "x");
  const y = numberData(node, "y");
  const width = numberData(node, "width");
  const height = numberData(node, "height");
  const declarationPort = Array.from(
    node.ownerSVGElement?.querySelectorAll<SVGTextElement>("g[data-decl] > text") ?? []
  ).some((text) => text.textContent.includes("<"))
    ? [circle(x + width, y + 16, "td-source-port", -1)]
    : [];
  node.querySelectorAll(":scope > .td-port").forEach((port) => {
    port.remove();
  });
  node.append(circle(x, y + height / 2, "td-target-port", -2), ...declarationPort);
  node.querySelectorAll<SVGGElement>("g[data-row-index]").forEach((row) => {
    const rowY = numberData(row, "rowY");
    const rowHeight = numberData(row, "rowHeight");
    node.append(circle(x + width, rowY + rowHeight / 2, "td-source-port", Number(row.dataset.rowIndex ?? "-1")));
  });
};

const svgPoint = (svg: SVGSVGElement, clientX: number, clientY: number) => {
  const point = svg.createSVGPoint();
  point.x = clientX;
  point.y = clientY;
  const matrix = svg.getScreenCTM()?.inverse();
  const local = matrix === undefined ? point : point.matrixTransform(matrix);
  return { x: local.x, y: local.y };
};

const previewPath = (svg: SVGSVGElement, start: NodePosition) => {
  const path = document.createElementNS(SVG_NS, "path");
  path.classList.add("td-connection-preview");
  path.dataset.startX = String(start.x);
  path.dataset.startY = String(start.y);
  svg.appendChild(path);
  return path;
};

const curve = (start: NodePosition, end: NodePosition) => {
  const bend = Math.max(48, Math.abs(end.x - start.x) * 0.45);
  return `M ${String(start.x)} ${String(start.y)} C ${String(start.x + bend)} ${String(start.y)}, ${String(end.x - bend)} ${String(end.y)}, ${String(end.x)} ${String(end.y)}`;
};

const startConnection = (event: PointerEvent, node: SVGGElement, svg: SVGSVGElement, state: EditorState) => {
  const target = event.target instanceof SVGCircleElement ? event.target : undefined;
  const sourcePort = target?.classList.contains("td-source-port") === true;
  const start = sourcePort ? svgPoint(svg, event.clientX, event.clientY) : undefined;
  state.connect =
    start === undefined
      ? undefined
      : {
          name: node.dataset.decl ?? "",
          rowIndex: Number(target?.dataset.rowIndex ?? "-1"),
          path: previewPath(svg, start),
        };
  runWhen(sourcePort, () => {
    event.preventDefault();
    event.stopPropagation();
  });
  return sourcePort;
};

const selectNode = (svg: SVGSVGElement, node: SVGGElement, state: EditorState) => {
  state.selected = node.dataset.decl;
  svg
    .querySelectorAll("[data-decl]")
    .forEach((candidate) => candidate.classList.toggle("td-selected", candidate === node));
};

const startNodeDrag = (event: PointerEvent, node: SVGGElement, state: EditorState) => {
  const name = node.dataset.decl ?? "";
  state.drag = {
    name,
    startX: event.clientX,
    startY: event.clientY,
    origin: state.positions.get(name) ?? { x: 0, y: 0 },
    moved: false,
  };
  event.stopPropagation();
};

const focusEditor = (svg: SVGSVGElement) => {
  const editor = svg.closest<HTMLElement>(".td-visual-editor") ?? undefined;
  runWhenDefined(editor, (current) => {
    current.focus();
  });
};

const handleNodePointerDown = (event: PointerEvent, node: SVGGElement, context: NodeContext) => {
  const { svg, state, chrome } = context;
  const connected = startConnection(event, node, svg, state);
  selectNode(svg, node, state);
  runWhen(!connected, () => {
    startNodeDrag(event, node, state);
  });
  chrome.inspector.hidden = true;
};

const handleNodeClick = (event: MouseEvent, node: SVGGElement, context: NodeContext) => {
  const { state, options, chrome } = context;
  const port = event.target instanceof Element && event.target.closest(".td-port") !== null;
  const suppressed = state.suppressClick || state.drag?.moved === true;
  const name = node.dataset.decl ?? "";
  const detail = port || suppressed ? undefined : inspectNode(options.getSource(), name);
  runWhenDefined(detail, (current) => {
    renderInspector(current, chrome, options);
  });
  focusEditor(context.svg);
  state.drag = undefined;
  state.suppressClick = false;
};

const installNode = (node: SVGGElement, context: NodeContext) => {
  const name = node.dataset.decl ?? "";
  applyNodePosition(node, context.state.positions.get(name) ?? { x: 0, y: 0 });
  decoratePorts(node);
  node.addEventListener("pointerdown", (event) => {
    handleNodePointerDown(event, node, context);
  });
  node.addEventListener("pointerup", (event) => {
    finishPointerGesture(event, context);
  });
  node.addEventListener("click", (event) => {
    handleNodeClick(event, node, context);
  });
};

const moveDrag = (event: PointerEvent, svg: SVGSVGElement, state: EditorState, viewport: ViewportControls) => {
  const drag = state.drag;
  runWhenDefined(drag, (current) => {
    const node = svg.querySelector<SVGGElement>(`[data-decl="${CSS.escape(current.name)}"]`) ?? undefined;
    const position = {
      x: snap(current.origin.x + (event.clientX - current.startX) / viewport.scale),
      y: snap(current.origin.y + (event.clientY - current.startY) / viewport.scale),
    };
    current.moved =
      current.moved || Math.abs(event.clientX - current.startX) > 2 || Math.abs(event.clientY - current.startY) > 2;
    runWhenDefined(node, (element) => {
      applyDragPosition(element, position, current.name, svg, state);
    });
  });
};

const applyDragPosition = (
  node: SVGGElement,
  position: NodePosition,
  name: string,
  svg: SVGSVGElement,
  state: EditorState
) => {
  state.positions.set(name, position);
  applyNodePosition(node, position);
  updateEdges(svg, state);
};

const moveConnection = (event: PointerEvent, svg: SVGSVGElement, state: EditorState) => {
  const connection = state.connect;
  runWhenDefined(connection, (current) => {
    const start = { x: Number(current.path.dataset.startX), y: Number(current.path.dataset.startY) };
    const end = svgPoint(svg, event.clientX, event.clientY);
    current.path.setAttribute("d", curve(start, end));
  });
};

const finishConnection = (
  event: PointerEvent,
  state: EditorState,
  options: VisualEditorOptions,
  chrome: CanvasChrome
) => {
  const connection = state.connect;
  const eventTarget = event.target instanceof Element ? event.target.closest<SVGGElement>("[data-decl]") : null;
  const target =
    eventTarget ?? document.elementFromPoint(event.clientX, event.clientY)?.closest<SVGGElement>("[data-decl]");
  const targetName = target?.dataset.decl;
  runWhenDefined(connection, (current) => {
    state.selected = undefined;
    chrome.inspector.hidden = true;
    const destination = targetName === current.name ? undefined : targetName;
    runWhenDefined(destination, (name) => {
      applyMutation(connectDeclarations(options.getSource(), current.name, current.rowIndex, name), options, chrome);
    });
  });
  connection?.path.remove();
  state.connect = undefined;
};

const finishPointerGesture = (event: PointerEvent, context: TrackingContext) => {
  const { state, options, chrome } = context;
  const drag = state.drag;
  runWhen(drag?.moved === true, () => {
    options.onPositionsChange?.(positionRecord(state.positions));
    focusEditor(context.svg);
  });
  const detail = drag?.moved === false ? inspectNode(options.getSource(), drag.name) : undefined;
  runWhenDefined(detail, (current) => {
    renderInspector(current, chrome, options);
  });
  runWhen(drag?.moved === true, () => {
    state.suppressClick = true;
  });
  runWhen(drag?.moved === false, () => {
    state.suppressClick = false;
  });
  state.drag = undefined;
  finishConnection(event, state, options, chrome);
};

const cancelPointerGesture = (state: EditorState) => {
  state.connect?.path.remove();
  state.connect = undefined;
  state.drag = undefined;
};

const installPointerTracking = (container: HTMLElement, context: TrackingContext) => {
  const { svg, state, viewport } = context;
  svg.addEventListener("pointermove", (event) => {
    moveDrag(event, svg, state, viewport);
    moveConnection(event, svg, state);
  });
  svg.addEventListener("pointerup", (event) => {
    finishPointerGesture(event, context);
  });
  container.addEventListener("pointercancel", () => {
    cancelPointerGesture(state);
  });
};

const exportSvg = (wrapper: HTMLElement) => {
  const svg = wrapper.querySelector("svg");
  const url =
    svg instanceof SVGSVGElement
      ? URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml" }))
      : undefined;
  const anchor = url === undefined ? undefined : document.createElement("a");
  runWhenDefined(anchor, (current) => {
    Object.assign(current, { href: url, download: "type-diagram.svg", hidden: true });
    document.body.append(current);
  });
  anchor?.click();
  anchor?.remove();
  runWhenDefined(url, (current) => {
    URL.revokeObjectURL(current);
  });
};

const installKeys = (container: HTMLElement, viewport: ViewportControls, chrome: CanvasChrome) => {
  container.tabIndex = 0;
  container.ownerDocument.addEventListener("keydown", (event) => {
    const editing = event.target instanceof HTMLInputElement;
    const inside = event.target instanceof Element && container.contains(event.target);
    runWhen(inside && !editing && event.key === "+", viewport.zoomIn);
    runWhen(inside && !editing && event.key === "-", viewport.zoomOut);
    runWhen(inside && !editing && event.key === "0", viewport.reset);
    runWhen(inside && !editing && event.key.toLowerCase() === "f", viewport.fit);
    runWhen(event.key === "Escape", () => {
      chrome.inspector.hidden = true;
    });
  });
};

const createEditorState = (options: VisualEditorOptions): EditorState => ({
  selected: undefined,
  drag: undefined,
  connect: undefined,
  suppressClick: false,
  positions: new Map(Object.entries(options.initialPositions ?? {})),
  polylines: new WeakMap(),
});

const trackSource = (options: VisualEditorOptions) => {
  let source = options.getSource();
  return {
    options: {
      ...options,
      getSource: () => source,
      onSourceChange: (next: string) => {
        source = next;
        options.onSourceChange(next);
      },
    },
    sync: () => {
      source = options.getSource();
    },
  };
};

const installSvg = (svg: SVGSVGElement, context: EditorContext, container: HTMLElement) => {
  const tracking = { ...context, svg };
  svg.querySelectorAll<SVGGElement>("g[data-decl]").forEach((node) => {
    installNode(node, tracking);
  });
  updateEdges(svg, context.state);
  installPointerTracking(container, tracking);
};

const refreshEditor = (container: HTMLElement, context: EditorContext) => {
  const { viewport } = context;
  const svg = viewport.wrapper.querySelector<SVGSVGElement>("svg") ?? undefined;
  runWhenDefined(svg, (current) => {
    installSvg(current, context, container);
  });
  const { selected } = context.state;
  const detail = selected === undefined ? undefined : inspectNode(context.options.getSource(), selected);
  runWhenDefined(detail, (current) => {
    renderInspector(current, context.chrome, context.options);
  });
};

const clearLayout = (state: EditorState, options: VisualEditorOptions, viewport: ViewportControls) => {
  state.positions.clear();
  options.onPositionsChange?.({});
  const svg = viewport.wrapper.querySelector<SVGSVGElement>("svg");
  svg?.querySelectorAll<SVGGElement>("g[data-decl]").forEach((node) => {
    applyNodePosition(node, { x: 0, y: 0 });
  });
  runWhenDefined(svg ?? undefined, (current) => {
    updateEdges(current, state);
  });
};

const createEditorChrome = (
  container: HTMLElement,
  viewport: ViewportControls,
  state: EditorState,
  options: VisualEditorOptions
) => {
  const chrome = createCanvasChrome(container, {
    addNode: (kind) => {
      runWhenDefined(chrome, (current) => {
        applyMutation(addDeclaration(options.getSource(), kind), options, current);
      });
    },
    ...viewport,
    clearLayout: () => {
      clearLayout(state, options, viewport);
    },
    exportSvg: () => {
      exportSvg(viewport.wrapper);
    },
  });
  return chrome;
};

const installEditorEvents = (container: HTMLElement, viewport: ViewportControls, chrome: CanvasChrome) => {
  viewport.wrapper.addEventListener("td:viewport", () => {
    chrome.setZoom(viewport.scale);
  });
  installKeys(container, viewport, chrome);
};

const editorRefresh = (container: HTMLElement, context: EditorContext) => () => {
  refreshEditor(container, context);
};

export const createVisualEditor = (container: HTMLElement, options: VisualEditorOptions) => {
  installVisualEditorStyles(container.ownerDocument);
  container.classList.add("td-visual-editor");
  const tracked = trackSource(options);
  const viewport = createViewport(container);
  const state = createEditorState(tracked.options);
  const chrome = createEditorChrome(container, viewport, state, tracked.options);
  const context: EditorContext = { state, options: tracked.options, chrome, viewport };
  const refresh = editorRefresh(container, context);
  installEditorEvents(container, viewport, chrome);
  return Object.assign(viewport, {
    refresh,
    setContent: (html: string) => {
      tracked.sync();
      setViewportContent(container, html);
      refresh();
    },
  });
};
