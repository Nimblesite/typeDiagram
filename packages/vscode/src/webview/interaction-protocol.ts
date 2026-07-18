// [VSCODE-VSIX-INTERACTION-PROTOCOL] Command-only black-box bridge used by the packaged VSIX E2E suite.
export const VISUAL_EDITOR_INTERACTION_COMMAND = "typediagram.testVisualEditorInteractions";

export const VISUAL_INTERACTION_PASSES = [
  "canvas-chrome",
  "invalid-edit",
  "record-edit",
  "union-edit",
  "alias-edit",
  "add-remove",
  "icon-buttons",
  "node-add-delete",
  "drag-snap-persist",
  "zoom-in-out",
  "trackpad-zoom",
  "fit-reset-pan",
  "draw-relationship",
  "generic-relationship-recovery",
  "auto-layout",
  "export-svg",
  "close-and-escape",
] as const;

export type VisualInteractionEvidence = Record<string, string | number | boolean>;
export type VisualInteractionResult = {
  passed: string[];
  sourceUpdated: boolean;
  evidence: VisualInteractionEvidence;
};
export type VisualInteractionRequest = { kind: "test-visual-interactions"; requestId: string };
export type VisualEditorReady = { kind: "visual-editor-ready" };
export type VisualInteractionResponse = {
  kind: "visual-interactions-result";
  requestId: string;
  result: VisualInteractionResult;
};

const messageRecord = (message: unknown) => {
  // Safe: message properties are read only after the object/null check.
  return typeof message === "object" && message !== null ? (message as Record<string, unknown>) : {};
};

const evidenceRecord = (message: unknown) => {
  const raw = messageRecord(message);
  const evidence: VisualInteractionEvidence = {};
  Object.entries(raw).forEach(([key, value]) => {
    switch (typeof value) {
      case "string":
      case "number":
      case "boolean":
        evidence[key] = value;
        break;
    }
  });
  return evidence;
};

export const visualInteractionRequest = (message: unknown): VisualInteractionRequest | undefined => {
  const value = messageRecord(message);
  return value.kind === "test-visual-interactions" && typeof value.requestId === "string"
    ? { kind: "test-visual-interactions", requestId: value.requestId }
    : undefined;
};

export const visualEditorReady = (message: unknown): message is VisualEditorReady =>
  messageRecord(message).kind === "visual-editor-ready";

export const visualInteractionResponse = (message: unknown, requestId: string): VisualInteractionResult | undefined => {
  const value = messageRecord(message);
  const raw = messageRecord(value.result);
  const evidence = evidenceRecord(raw.evidence);
  const passed = Array.isArray(raw.passed)
    ? raw.passed.filter((item): item is string => typeof item === "string")
    : undefined;
  const valid =
    value.kind === "visual-interactions-result" &&
    value.requestId === requestId &&
    passed !== undefined &&
    typeof raw.sourceUpdated === "boolean";
  return valid ? { passed, sourceUpdated: raw.sourceUpdated === true, evidence } : undefined;
};
