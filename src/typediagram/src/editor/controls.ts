// [EDITOR-CONTROLS] Shared compact canvas controls, semantic legend, and inspector shell.
import type { DeclarationKind } from "./source-editor.js";

export type CanvasActions = {
  addNode: (kind: DeclarationKind) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  reset: () => void;
  fit: () => void;
  clearLayout: () => void;
  exportSvg: () => void;
};

export type CanvasChrome = {
  inspector: HTMLElement;
  inspectorBody: HTMLElement;
  inspectorKind: HTMLElement;
  toast: HTMLElement;
  setZoom: (scale: number) => void;
};

const button = (label: string, title: string, action: () => void) => {
  const element = document.createElement("button");
  element.type = "button";
  element.className = "td-canvas-button";
  element.textContent = label;
  element.title = title;
  element.setAttribute("aria-label", title);
  element.setAttribute("data-td-interactive", "true");
  element.addEventListener("click", action);
  return element;
};

const separator = () => {
  const element = document.createElement("span");
  element.className = "td-canvas-separator";
  element.setAttribute("aria-hidden", "true");
  return element;
};

export const closeIcon = () => {
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  icon.setAttribute("viewBox", "0 0 16 16");
  icon.setAttribute("aria-hidden", "true");
  icon.setAttribute("focusable", "false");
  path.setAttribute("d", "M4 4l8 8M12 4l-8 8");
  icon.appendChild(path);
  return icon;
};

const nodeKindButton = (kind: DeclarationKind, label: string, actions: CanvasActions, creator: HTMLElement) => {
  const current = button(label, `Add ${kind} type`, () => {
    actions.addNode(kind);
    creator.hidden = true;
  });
  current.classList.add("td-node-kind-button");
  return current;
};

const createNodeCreator = (container: HTMLElement, actions: CanvasActions) => {
  const creator = document.createElement("div");
  creator.className = "td-node-creator";
  creator.hidden = true;
  creator.setAttribute("data-td-interactive", "true");
  creator.setAttribute("aria-label", "Choose type kind");
  creator.append(
    nodeKindButton("record", "Record", actions, creator),
    nodeKindButton("union", "Union", actions, creator),
    nodeKindButton("alias", "Alias", actions, creator)
  );
  container.appendChild(creator);
  return creator;
};

const createToolbar = (container: HTMLElement, actions: CanvasActions, creator: HTMLElement) => {
  const toolbar = document.createElement("div");
  const zoom = button("100%", "Current zoom", () => undefined);
  const addType = button("+ Type", "Add type", () => {
    creator.hidden = creator.hidden === false;
  });
  toolbar.className = "td-canvas-toolbar";
  toolbar.setAttribute("role", "toolbar");
  toolbar.setAttribute("aria-label", "Canvas controls");
  zoom.classList.add("td-zoom-value");
  addType.classList.add("td-add-node");
  toolbar.append(
    addType,
    separator(),
    button("−", "Zoom out", actions.zoomOut),
    zoom,
    button("+", "Zoom in", actions.zoomIn),
    separator(),
    button("Fit", "Fit diagram to view", actions.fit),
    button("1:1", "Reset canvas", actions.reset),
    button("Auto", "Restore automatic layout", actions.clearLayout),
    separator(),
    button("SVG", "Export SVG", actions.exportSvg)
  );
  container.appendChild(toolbar);
  return zoom;
};

const legendItem = (label: string, modifier: string) => {
  const item = document.createElement("span");
  const swatch = document.createElement("i");
  item.className = "td-legend-item";
  swatch.className = `td-legend-swatch ${modifier}`.trim();
  item.append(swatch, document.createTextNode(label));
  return item;
};

const createLegend = (container: HTMLElement) => {
  const legend = document.createElement("div");
  legend.className = "td-canvas-legend";
  legend.setAttribute("aria-label", "Diagram legend");
  legend.append(legendItem("Type", ""), legendItem("Union", "td-legend-union"), legendItem("Alias", "td-legend-alias"));
  container.appendChild(legend);
};

const createInspector = (container: HTMLElement) => {
  const inspector = document.createElement("aside");
  const head = document.createElement("header");
  const kind = document.createElement("span");
  const close = button("×", "Close properties", () => (inspector.hidden = true));
  const body = document.createElement("div");
  inspector.className = "td-inspector";
  inspector.hidden = true;
  inspector.setAttribute("data-td-interactive", "true");
  head.className = "td-inspector-head";
  kind.className = "td-inspector-kind";
  close.className = "td-icon-button td-inspector-close";
  close.replaceChildren(closeIcon());
  body.className = "td-inspector-body";
  head.append(kind, close);
  inspector.append(head, body);
  container.appendChild(inspector);
  return { inspector, body, kind };
};

const createToast = (container: HTMLElement) => {
  const toast = document.createElement("output");
  toast.className = "td-editor-toast";
  toast.hidden = true;
  toast.setAttribute("aria-live", "polite");
  container.appendChild(toast);
  return toast;
};

export const createCanvasChrome = (container: HTMLElement, actions: CanvasActions): CanvasChrome => {
  const creator = createNodeCreator(container, actions);
  const zoom = createToolbar(container, actions, creator);
  const { inspector, body, kind } = createInspector(container);
  const toast = createToast(container);
  createLegend(container);
  return {
    inspector,
    inspectorBody: body,
    inspectorKind: kind,
    toast,
    setZoom: (scale) => (zoom.textContent = `${String(Math.round(scale * 100))}%`),
  };
};
