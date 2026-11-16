// [VSCODE-VSIX-INTERACTIONS] Drives the real packaged webview through its user-facing DOM controls.
import type { VisualInteractionEvidence, VisualInteractionResult } from "./interaction-protocol.js";

export type VisualInteractionContext = {
  preview: HTMLElement;
  getSource: () => string;
  settle: () => Promise<void>;
  getState: () => unknown;
};

type Audit = { context: VisualInteractionContext; passed: string[]; evidence: VisualInteractionEvidence };
type Point = { x: number; y: number };
const mark = (audit: Audit, name: string, passed: boolean) => (passed ? audit.passed.push(name) : undefined);
const pointer = (type: string, point: Point, buttons: number) =>
  new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerId: 19,
    pointerType: "mouse",
    isPrimary: true,
    buttons,
    clientX: point.x,
    clientY: point.y,
  });
const button = (audit: Audit, label: string) => {
  const value = audit.context.preview.querySelector(`[aria-label="${label}"]`);
  return value instanceof HTMLButtonElement ? value : undefined;
};
const input = (audit: Audit, index: number) => {
  const value = audit.context.preview.querySelectorAll(".td-inspector input").item(index);
  return value instanceof HTMLInputElement ? value : undefined;
};
const declaration = (audit: Audit, name: string) => {
  const value = audit.context.preview.querySelector(`[data-decl="${name}"]`);
  return value instanceof SVGGElement ? value : undefined;
};
const selectDeclaration = (audit: Audit, name: string) => {
  const node = declaration(audit, name);
  const svg = node?.ownerSVGElement ?? undefined;
  const point = { x: node?.getBoundingClientRect().x ?? 20, y: node?.getBoundingClientRect().y ?? 20 };
  node?.dispatchEvent(pointer("pointerdown", point, 1));
  svg?.dispatchEvent(pointer("pointerup", point, 0));
  return node;
};
const changeInput = async (audit: Audit, index: number, value: string) => {
  const current = input(audit, index);
  current?.focus();
  Object.assign(current ?? {}, { value });
  current?.dispatchEvent(new Event("change", { bubbles: true }));
  await audit.context.settle();
  return current !== undefined;
};
const canvasChrome = (audit: Audit) => {
  const { preview } = audit.context;
  const toolbarButtons = preview.querySelectorAll(".td-canvas-toolbar .td-canvas-button").length;
  const legendItems = preview.querySelectorAll(".td-canvas-legend .td-legend-item").length;
  const grid = preview.querySelector("svg #td-grid") !== null;
  const shadow = preview.querySelector("svg #td-ambient-shadow") !== null;
  const nodeCount = preview.querySelectorAll("svg [data-decl]").length;
  const ports = preview.querySelectorAll("svg .td-port").length;
  const nodeKinds = ["record", "union", "alias"].every(
    (kind) => preview.querySelectorAll(`svg [data-kind="${kind}"]`).length > 0
  );
  const toolbarLabel = preview.querySelector(".td-canvas-toolbar")?.getAttribute("aria-label") === "Canvas controls";
  const legendText = preview.querySelector(".td-canvas-legend")?.textContent.replace(/\s/g, "") === "TypeUnionAlias";
  const chromeInitiallyClosed =
    preview.querySelector<HTMLElement>(".td-node-creator")?.hidden === true &&
    preview.querySelector<HTMLElement>(".td-inspector")?.hidden === true;
  Object.assign(audit.evidence, {
    toolbarButtons,
    legendItems,
    grid,
    shadow,
    nodeCount,
    ports,
    nodeKinds,
    toolbarLabel,
    legendText,
    chromeInitiallyClosed,
  });
  const toolbar = toolbarButtons === 8;
  const legend = legendItems === 3;
  const rendered = grid && shadow && nodeCount > 10 && ports > 30;
  mark(
    audit,
    "canvas-chrome",
    toolbar && legend && rendered && nodeKinds && toolbarLabel && legendText && chromeInitiallyClosed
  );
};
const recordEdits = async (audit: Audit) => {
  selectDeclaration(audit, "ChatRequest");
  const recordKind = audit.context.preview.querySelector(".td-inspector-kind")?.textContent === "record";
  const recordRows = audit.context.preview.querySelectorAll(".td-inspector-row").length;
  const recordSelected = audit.context.preview.querySelectorAll(".td-selected").length === 1;
  await changeInput(audit, 0, "ConversationRequest");
  const renamedNode = declaration(audit, "ConversationRequest") !== undefined;
  const oldNodeGone = declaration(audit, "ChatRequest") === undefined;
  selectDeclaration(audit, "ConversationRequest");
  await changeInput(audit, 1, "prompt");
  selectDeclaration(audit, "ConversationRequest");
  const beforeInvalid = audit.context.getSource();
  await changeInput(audit, 2, "List<");
  const invalid = audit.context.getSource() === beforeInvalid && !audit.context.getSource().includes("prompt: List<");
  const invalidToast = audit.context.preview.querySelector(".td-editor-toast:not([hidden])") !== null;
  Object.assign(audit.evidence, { invalidRejected: invalid, invalidToast, recordKind, recordRows, recordSelected });
  mark(audit, "invalid-edit", invalid && invalidToast);
  selectDeclaration(audit, "ConversationRequest");
  await changeInput(audit, 2, "Option<String>");
  const recordRenamed = audit.context.getSource().includes("type ConversationRequest");
  const recordFieldEdited = audit.context.getSource().includes("prompt: Option<String>");
  const recordRendered =
    declaration(audit, "ConversationRequest")?.textContent.includes("prompt: Option<String>") === true;
  const recordEdge =
    audit.context.preview.querySelector('[data-edge][data-source="ConversationRequest"][data-target="Option"]') !==
    null;
  Object.assign(audit.evidence, {
    recordRenamed,
    recordFieldEdited,
    renamedNode,
    oldNodeGone,
    recordRendered,
    recordEdge,
  });
  mark(
    audit,
    "record-edit",
    recordRenamed &&
      recordFieldEdited &&
      renamedNode &&
      oldNodeGone &&
      recordRendered &&
      recordEdge &&
      recordKind &&
      recordRows === 3 &&
      recordSelected
  );
};
const unionEdit = async (audit: Audit) => {
  selectDeclaration(audit, "ToolResultContent");
  const unionKind = audit.context.preview.querySelector(".td-inspector-kind")?.textContent === "union";
  const unionRows = audit.context.preview.querySelectorAll(".td-inspector-row").length;
  await changeInput(audit, 3, "ScalarValue");
  selectDeclaration(audit, "ToolResultContent");
  await changeInput(audit, 4, "TextPart");
  const unionVariantRenamed = audit.context.getSource().includes("ScalarValue {");
  const unionPayloadEdited = audit.context.getSource().includes("ScalarValue { value: TextPart }");
  const unionRendered = declaration(audit, "ToolResultContent")?.textContent.includes("ScalarValue") === true;
  const unionEdge =
    audit.context.preview.querySelector('[data-edge][data-source="ToolResultContent"][data-target="TextPart"]') !==
    null;
  Object.assign(audit.evidence, {
    unionVariantRenamed,
    unionPayloadEdited,
    unionKind,
    unionRows,
    unionRendered,
    unionEdge,
  });
  mark(
    audit,
    "union-edit",
    unionVariantRenamed && unionPayloadEdited && unionKind && unionRows === 4 && unionRendered && unionEdge
  );
};
const aliasEdit = async (audit: Audit) => {
  selectDeclaration(audit, "Email");
  const aliasKind = audit.context.preview.querySelector(".td-inspector-kind")?.textContent === "alias";
  const aliasRows = audit.context.preview.querySelectorAll(".td-inspector-row").length;
  const aliasHasNoRowControls =
    audit.context.preview.querySelector(".td-inspector-add") === null &&
    audit.context.preview.querySelector(".td-inspector-remove") === null;
  await changeInput(audit, 2, "Option<String>");
  const aliasTargetEdited = audit.context.getSource().includes("alias Email = Option<String>");
  const aliasRendered = declaration(audit, "Email")?.textContent.includes("Option<String>") === true;
  const aliasEdge =
    audit.context.preview.querySelector('[data-edge][data-source="Email"][data-target="Option"]') !== null;
  Object.assign(audit.evidence, {
    aliasTargetEdited,
    aliasKind,
    aliasRows,
    aliasHasNoRowControls,
    aliasRendered,
    aliasEdge,
  });
  mark(
    audit,
    "alias-edit",
    aliasTargetEdited && aliasKind && aliasRows === 1 && aliasHasNoRowControls && aliasRendered && aliasEdge
  );
};
const addRemove = async (audit: Audit) => {
  selectDeclaration(audit, "ConversationRequest");
  const add = audit.context.preview.querySelector(".td-inspector-add");
  const sourceBefore = audit.context.getSource();
  const beforeRows = audit.context.preview.querySelectorAll(".td-inspector-row").length;
  const beforePorts = declaration(audit, "ConversationRequest")?.querySelectorAll(".td-source-port").length ?? 0;
  (add instanceof HTMLButtonElement ? add : undefined)?.click();
  await audit.context.settle();
  const added = audit.context.getSource().includes("field: String");
  selectDeclaration(audit, "ConversationRequest");
  const afterAddRows = audit.context.preview.querySelectorAll(".td-inspector-row").length;
  const afterAddPorts = declaration(audit, "ConversationRequest")?.querySelectorAll(".td-source-port").length ?? 0;
  const lastInputs = audit.context.preview.querySelectorAll<HTMLInputElement>(".td-inspector-row:last-of-type input");
  const defaultRow = lastInputs.item(0).value === "field" && lastInputs.item(1).value === "String";
  const removes = audit.context.preview.querySelectorAll(".td-inspector-remove");
  const remove = removes.item(removes.length - 1);
  (remove instanceof HTMLButtonElement ? remove : undefined)?.click();
  await audit.context.settle();
  selectDeclaration(audit, "ConversationRequest");
  const afterRemoveRows = audit.context.preview.querySelectorAll(".td-inspector-row").length;
  const removed = !audit.context.getSource().includes("field: String");
  const afterRemovePorts = declaration(audit, "ConversationRequest")?.querySelectorAll(".td-source-port").length ?? 0;
  const sourceRestored = audit.context.getSource() === sourceBefore;
  Object.assign(audit.evidence, {
    beforeRows,
    afterAddRows,
    afterRemoveRows,
    rowAdded: added,
    rowRemoved: removed,
    beforePorts,
    afterAddPorts,
    afterRemovePorts,
    defaultRow,
    sourceRestored,
  });
  mark(
    audit,
    "add-remove",
    added &&
      removed &&
      defaultRow &&
      sourceRestored &&
      afterAddRows === beforeRows + 1 &&
      afterRemoveRows === beforeRows &&
      afterAddPorts === beforePorts + 1 &&
      afterRemovePorts === beforePorts
  );
};
const iconButtons = (audit: Audit) => {
  selectDeclaration(audit, "ConversationRequest");
  const close = button(audit, "Close properties");
  const removes = [...audit.context.preview.querySelectorAll<HTMLButtonElement>(".td-inspector-remove")];
  const closeIcon = close !== undefined && close.querySelector('svg[aria-hidden="true"]') !== null;
  const removeIconCount = removes.filter((current) => current.querySelector('svg[aria-hidden="true"]') !== null).length;
  const removeButtonsLabelled = removes.every((current) => current.getAttribute("aria-label") === "Remove row");
  Object.assign(audit.evidence, { closeIcon, removeIconCount, removeButtonsLabelled });
  mark(audit, "icon-buttons", closeIcon && removeIconCount === removes.length && removeButtonsLabelled);
};
const addNode = async (audit: Audit, label: string) => {
  button(audit, "Add type")?.click();
  button(audit, label)?.click();
  await audit.context.settle();
};
const addDeleteNodes = async (audit: Audit) => {
  button(audit, "Add type")?.click();
  const creatorButtons = audit.context.preview.querySelectorAll(".td-node-creator button").length;
  button(audit, "Add type")?.click();
  await addNode(audit, "Add record type");
  await addNode(audit, "Add union type");
  await addNode(audit, "Add alias type");
  const recordAdded = declaration(audit, "NewRecord") !== undefined;
  const unionAdded = declaration(audit, "NewUnion") !== undefined;
  const aliasAdded = declaration(audit, "NewAlias") !== undefined;
  selectDeclaration(audit, "NewRecord");
  button(audit, "Delete NewRecord")?.click();
  await audit.context.settle();
  const recordDeleted =
    declaration(audit, "NewRecord") === undefined && !audit.context.getSource().includes("type NewRecord");
  Object.assign(audit.evidence, { creatorButtons, recordAdded, unionAdded, aliasAdded, recordDeleted });
  mark(audit, "node-add-delete", creatorButtons === 3 && recordAdded && unionAdded && aliasAdded && recordDeleted);
};

const dragNode = (audit: Audit) => {
  const node = declaration(audit, "ConversationRequest");
  const svg = node?.ownerSVGElement ?? undefined;
  const box = node?.getBoundingClientRect();
  const start = { x: (box?.x ?? 20) + 8, y: (box?.y ?? 20) + 8 };
  const end = { x: start.x + 64, y: start.y + 40 };
  node?.dispatchEvent(pointer("pointerdown", start, 1));
  const inspector = audit.context.preview.querySelector<HTMLElement>(".td-inspector");
  const inspectorHiddenOnDragStart = inspector?.hidden === true;
  svg?.dispatchEvent(pointer("pointermove", end, 1));
  const inspectorHiddenOnDragMove = inspector?.hidden === true;
  svg?.dispatchEvent(pointer("pointerup", end, 0));
  const inspectorHiddenOnDragEnd = inspector?.hidden === true;
  const x = Number(node?.dataset.editorX);
  const y = Number(node?.dataset.editorY);
  const persisted = JSON.stringify(audit.context.getState()).includes("ConversationRequest");
  const dragSnapped = x > 0 && y > 0 && x % 8 === 0 && y % 8 === 0;
  Object.assign(audit.evidence, {
    dragX: x,
    dragY: y,
    dragSnapped,
    layoutPersisted: persisted,
    inspectorHiddenOnDragStart,
    inspectorHiddenOnDragMove,
    inspectorHiddenOnDragEnd,
  });
  mark(
    audit,
    "drag-snap-persist",
    dragSnapped && persisted && inspectorHiddenOnDragStart && inspectorHiddenOnDragMove && inspectorHiddenOnDragEnd
  );
};

const zoom = (audit: Audit) => {
  const wrapper = audit.context.preview.querySelector<HTMLElement>(".viewport-wrapper");
  const before = wrapper?.style.transform;
  button(audit, "Zoom in")?.click();
  const afterIn = wrapper?.style.transform;
  button(audit, "Zoom out")?.click();
  const afterOut = wrapper?.style.transform;
  Object.assign(audit.evidence, { zoomBefore: before ?? "", zoomAfterIn: afterIn ?? "", zoomAfterOut: afterOut ?? "" });
  mark(audit, "zoom-in-out", before !== afterIn && afterIn !== afterOut);
};

const scaleFrom = (transform: string) => Number(transform.match(/scale\(([^)]+)\)/)?.[1] ?? "0");

const trackpadZoom = (audit: Audit) => {
  button(audit, "Reset canvas")?.click();
  audit.context.preview.dispatchEvent(
    new WheelEvent("wheel", { bubbles: true, cancelable: true, clientX: 200, clientY: 200, deltaY: -1 })
  );
  const transform = audit.context.preview.querySelector<HTMLElement>(".viewport-wrapper")?.style.transform ?? "";
  const scale = scaleFrom(transform);
  button(audit, "Reset canvas")?.click();
  audit.evidence.trackpadScale = scale;
  mark(audit, "trackpad-zoom", scale > 1 && scale < 1.01);
};

const pan = (audit: Audit) => {
  const start = { x: 12, y: 18 };
  const end = { x: 62, y: 53 };
  audit.context.preview.dispatchEvent(pointer("pointerdown", start, 1));
  audit.context.preview.dispatchEvent(pointer("pointermove", end, 1));
  audit.context.preview.dispatchEvent(pointer("pointerup", end, 0));
  return audit.context.preview.querySelector<HTMLElement>(".viewport-wrapper")?.style.transform ?? "";
};

const fitResetPan = (audit: Audit) => {
  button(audit, "Fit diagram to view")?.click();
  const fit = audit.context.preview.querySelector<HTMLElement>(".viewport-wrapper")?.style.transform ?? "";
  button(audit, "Reset canvas")?.click();
  const reset = audit.context.preview.querySelector<HTMLElement>(".viewport-wrapper")?.style.transform ?? "";
  const panned = pan(audit);
  button(audit, "Reset canvas")?.click();
  Object.assign(audit.evidence, { fitTransform: fit, resetTransform: reset, panTransform: panned });
  mark(
    audit,
    "fit-reset-pan",
    fit.includes("scale(") && reset.includes("translate(0px, 0px) scale(1)") && panned.includes("translate(50px, 35px)")
  );
};

const dragConnection = async (audit: Audit, sourceName: string, rowIndex: number, targetName: string) => {
  const port = audit.context.preview.querySelector(
    `[data-decl="${sourceName}"] .td-source-port[data-row-index="${String(rowIndex)}"]`
  );
  const target = audit.context.preview.querySelector(`[data-decl="${targetName}"] .td-target-port`);
  const svg = port instanceof SVGCircleElement ? port.ownerSVGElement : undefined;
  const sourceBox = port?.getBoundingClientRect();
  const targetBox = target?.getBoundingClientRect();
  const start = { x: (sourceBox?.x ?? 0) + 2, y: (sourceBox?.y ?? 0) + 2 };
  const end = { x: (targetBox?.x ?? 0) + 2, y: (targetBox?.y ?? 0) + 2 };
  port?.dispatchEvent(pointer("pointerdown", start, 1));
  svg?.dispatchEvent(pointer("pointermove", end, 1));
  const connectionPreview =
    audit.context.preview.querySelector(".td-connection-preview")?.getAttribute("d")?.includes(" C ") === true;
  target?.dispatchEvent(pointer("pointerup", end, 0));
  await audit.context.settle();
  return connectionPreview;
};

const drawRelationship = async (audit: Audit) => {
  selectDeclaration(audit, "ConversationRequest");
  const connectionPreview = await dragConnection(audit, "ConversationRequest", 0, "TextPart");
  const relationshipSource = audit.context.getSource().includes("prompt: TextPart");
  const relationshipRendered =
    declaration(audit, "ConversationRequest")?.textContent.includes("prompt: TextPart") === true;
  const relationshipEdge =
    audit.context.preview.querySelector('[data-edge][data-source="ConversationRequest"][data-target="TextPart"]') !==
    null;
  const relationshipClosed = audit.context.preview.querySelector(".td-connection-preview") === null;
  Object.assign(audit.evidence, {
    connectionPreview,
    relationshipSource,
    relationshipRendered,
    relationshipEdge,
    relationshipClosed,
  });
  mark(
    audit,
    "draw-relationship",
    connectionPreview && relationshipSource && relationshipRendered && relationshipEdge && relationshipClosed
  );
};

const genericRelationshipRecovery = async (audit: Audit) => {
  const connectionPreview = await dragConnection(audit, "ToolResult", -1, "Option");
  const genericSource = audit.context.getSource().includes("option: Option<Any>");
  const genericTargetRendered = declaration(audit, "Option") !== undefined;
  const genericEdge =
    audit.context.preview.querySelector('[data-edge][data-source="ToolResult"][data-target="Option"]') !== null;
  const genericRendered = declaration(audit, "ToolResult")?.textContent.includes("option: Option<Any>") === true;
  const fatalErrorHidden = audit.context.preview.ownerDocument.getElementById("error-panel")?.hidden === true;
  const recoveryActions = audit.context.preview.ownerDocument.querySelectorAll("#error-panel .error-action").length;
  Object.assign(audit.evidence, {
    genericSource,
    genericTargetRendered,
    genericEdge,
    genericRendered,
    fatalErrorHidden,
    recoveryActions,
  });
  mark(
    audit,
    "generic-relationship-recovery",
    connectionPreview &&
      genericSource &&
      genericTargetRendered &&
      genericEdge &&
      genericRendered &&
      fatalErrorHidden &&
      recoveryActions === 2
  );
};

const autoLayout = (audit: Audit) => {
  button(audit, "Restore automatic layout")?.click();
  const node = declaration(audit, "ConversationRequest");
  const emptyState = JSON.stringify(audit.context.getState()).includes('"positions":{}');
  const autoX = Number(node?.dataset.editorX);
  const autoY = Number(node?.dataset.editorY);
  Object.assign(audit.evidence, { autoX, autoY, autoStateEmpty: emptyState });
  mark(audit, "auto-layout", autoX === 0 && autoY === 0 && emptyState);
};

const exportSvg = (audit: Audit) => {
  let download = "";
  const capture = (event: Event) => {
    download = event.target instanceof HTMLAnchorElement ? event.target.download : download;
    event.preventDefault();
  };
  document.addEventListener("click", capture, true);
  button(audit, "Export SVG")?.click();
  document.removeEventListener("click", capture, true);
  audit.evidence.exportFilename = download;
  mark(audit, "export-svg", download === "type-diagram.svg");
};

const closeAndEscape = (audit: Audit) => {
  selectDeclaration(audit, "ConversationRequest");
  button(audit, "Close properties")?.click();
  const inspector = audit.context.preview.querySelector<HTMLElement>(".td-inspector");
  const closed = inspector?.hidden === true;
  selectDeclaration(audit, "ConversationRequest");
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  const escaped = inspector?.hidden === true;
  Object.assign(audit.evidence, { inspectorClosed: closed, inspectorEscaped: escaped });
  mark(audit, "close-and-escape", closed && escaped);
};

const editingInteractions = async (audit: Audit) => {
  await recordEdits(audit);
  await unionEdit(audit);
  await aliasEdit(audit);
  await addRemove(audit);
  iconButtons(audit);
  await addDeleteNodes(audit);
};

const canvasInteractions = async (audit: Audit) => {
  dragNode(audit);
  zoom(audit);
  trackpadZoom(audit);
  fitResetPan(audit);
  await drawRelationship(audit);
  await genericRelationshipRecovery(audit);
  autoLayout(audit);
  exportSvg(audit);
  closeAndEscape(audit);
};

export const runVisualEditorInteractions = async (
  context: VisualInteractionContext
): Promise<VisualInteractionResult> => {
  const audit: Audit = { context, passed: [], evidence: {} };
  canvasChrome(audit);
  await editingInteractions(audit);
  await canvasInteractions(audit);
  const source = context.getSource();
  return {
    passed: audit.passed,
    sourceUpdated:
      source.includes("ConversationRequest") && source.includes("prompt: TextPart") && source.includes("Option<Any>"),
    evidence: audit.evidence,
  };
};
