// [VSCODE-PREVIEW-PANEL] Creates/reveals a webview panel for a .td document.
import * as vscode from "vscode";
import { webviewHtml } from "./webview-html.js";
import {
  visualEditorReady,
  visualInteractionResponse,
  type VisualInteractionResult,
} from "./webview/interaction-protocol.js";

type EditorMessage = { kind: "edit"; source: string };
type OpenSourceMessage = { kind: "open-source" };
const pendingEdits = new WeakMap<vscode.WebviewPanel, Promise<void>>();
const panelReady = new WeakMap<vscode.WebviewPanel, Promise<void>>();
let interactionRequestId = 0;

const readySignal = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((current) => {
    resolve = current;
  });
  return { promise, resolve };
};

const webviewMessage = (message: unknown): EditorMessage | OpenSourceMessage | undefined => {
  // Safe: the webview payload is narrowed before either property is consumed.
  const value = typeof message === "object" && message !== null ? (message as Record<string, unknown>) : {};
  switch (value.kind) {
    case "edit":
      return typeof value.source === "string" ? { kind: "edit", source: value.source } : undefined;
    case "open-source":
      return { kind: "open-source" };
    default:
      return undefined;
  }
};

const applyEditorSource = async (doc: vscode.TextDocument, source: string) => {
  const edit = new vscode.WorkspaceEdit();
  const end = doc.positionAt(doc.getText().length);
  edit.replace(doc.uri, new vscode.Range(new vscode.Position(0, 0), end), source);
  await vscode.workspace.applyEdit(edit);
};

const queueEditorSource = (panel: vscode.WebviewPanel, doc: vscode.TextDocument, source: string) => {
  const previous = pendingEdits.get(panel) ?? Promise.resolve();
  const next = previous.then(() => applyEditorSource(doc, source));
  pendingEdits.set(panel, next);
};

const requestPanelInteractions = async (panel: vscode.WebviewPanel, requestId: string) => {
  await panelReady.get(panel);
  return new Promise<VisualInteractionResult>((resolve) => {
    const subscription = panel.webview.onDidReceiveMessage((message: unknown) => {
      const result = visualInteractionResponse(message, requestId);
      switch (result) {
        case undefined:
          break;
        default:
          subscription.dispose();
          void (pendingEdits.get(panel) ?? Promise.resolve()).then(() => {
            resolve(result);
          });
      }
    });
    void panel.webview.postMessage({ kind: "test-visual-interactions", requestId });
  });
};

export const requestVisualEditorInteractions = (panels: Map<string, vscode.WebviewPanel>) => {
  const panel = [...panels.values()][0];
  interactionRequestId += 1;
  return panel === undefined
    ? Promise.resolve({ passed: [], sourceUpdated: false, evidence: {} })
    : requestPanelInteractions(panel, String(interactionRequestId));
};

export const openPreview = (
  context: vscode.ExtensionContext,
  doc: vscode.TextDocument,
  panels: Map<string, vscode.WebviewPanel>,
  column: vscode.ViewColumn,
  onDispose: () => void
) => {
  const key = doc.uri.toString();
  const existing = panels.get(key);
  switch (existing) {
    case undefined:
      break;
    default:
      existing.reveal(column);
      return;
  }

  const panel = vscode.window.createWebviewPanel("typediagram.preview", `Preview: ${fileName(doc)}`, column, {
    enableScripts: true,
    retainContextWhenHidden: true,
    localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "dist", "webview")],
  });

  const scriptUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, "dist", "webview", "main.js"));
  const ready = readySignal();
  panelReady.set(panel, ready.promise);

  panel.webview.onDidReceiveMessage((message: unknown) => {
    switch (visualEditorReady(message)) {
      case true:
        ready.resolve();
        break;
    }
    const editor = webviewMessage(message);
    switch (editor?.kind) {
      case "edit":
        queueEditorSource(panel, doc, editor.source);
        break;
      case "open-source":
        void vscode.window.showTextDocument(doc, { preview: false });
        break;
    }
  });

  panel.webview.html = webviewHtml(panel.webview.cspSource, scriptUri, doc.getText());

  panel.onDidDispose(() => {
    panels.delete(key);
    onDispose();
  });
  panels.set(key, panel);
};

const fileName = (doc: vscode.TextDocument) => {
  const name = doc.uri.path.split("/").pop();
  return name === undefined || name === "" ? "untitled.td" : name;
};
