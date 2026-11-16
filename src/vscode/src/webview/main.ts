// [VSCODE-WEBVIEW] Shared visual editor with a real workspace-edit bridge.
import { parser, renderToString } from "typediagram-core";
import { createVisualEditor, type NodePosition } from "typediagram-core/editor";
import { runVisualEditorInteractions } from "./interaction-test.js";
import { visualInteractionRequest } from "./interaction-protocol.js";

type UpdateMessage = { kind: "update"; source: string };
type WebviewState = { positions?: Readonly<Record<string, NodePosition>> };
type RecoveryElements = {
  errorPanel: HTMLElement;
  error: HTMLElement;
  restore: HTMLButtonElement;
  openSource: HTMLButtonElement;
};
type RenderResult = Awaited<ReturnType<typeof renderToString>>;
type VisualEditor = ReturnType<typeof createVisualEditor>;

const vscode = acquireVsCodeApi();

const detectTheme = () => (document.body.classList.contains("vscode-light") ? ("light" as const) : ("dark" as const));

const initialSource = () => document.querySelector("script[data-source]")?.getAttribute("data-source") ?? "";

const persistedState = (): WebviewState => {
  const state = vscode.getState();
  // Safe: VS Code owns this state object and positions are used only for numeric transforms.
  return typeof state === "object" && state !== null ? state : {};
};

const isUpdate = (message: unknown): message is UpdateMessage => {
  // Safe: message properties are narrowed before use.
  const value = typeof message === "object" && message !== null ? (message as Record<string, unknown>) : {};
  return value.kind === "update" && typeof value.source === "string";
};

const applyRenderResult = (
  result: RenderResult,
  source: string,
  visual: VisualEditor,
  elements: RecoveryElements,
  previous: string | undefined
) => {
  elements.errorPanel.hidden = result.ok;
  elements.error.textContent = result.ok ? "" : parser.formatDiagnostics([...result.error]);
  elements.restore.disabled = !result.ok && previous === undefined;
  switch (result.ok) {
    case true:
      visual.setContent(result.value);
      break;
  }
  return result.ok ? source : previous;
};

const recoveryElements = () => {
  const errorPanel = document.getElementById("error-panel");
  const error = document.getElementById("error");
  const restore = document.getElementById("restore-valid-source");
  const openSource = document.getElementById("open-source");
  const complete =
    errorPanel !== null &&
    error !== null &&
    restore instanceof HTMLButtonElement &&
    openSource instanceof HTMLButtonElement;
  return complete ? { errorPanel, error, restore, openSource } : undefined;
};

const boot = (preview: HTMLElement, elements: RecoveryElements) => {
  let source = initialSource();
  let lastValidSource: string | undefined;
  let version = 0;
  let settled = Promise.resolve();
  const visual = createVisualEditor(preview, {
    getSource: () => source,
    onSourceChange: (next) => {
      source = next;
      vscode.postMessage({ kind: "edit", source: next });
      void render();
    },
    initialPositions: persistedState().positions ?? {},
    onPositionsChange: (positions) => {
      vscode.setState({ positions });
    },
  });
  const render = () => {
    const current = ++version;
    settled = renderToString(source, { theme: detectTheme() }).then((result) => {
      switch (current === version) {
        case true:
          lastValidSource = applyRenderResult(result, source, visual, elements, lastValidSource);
          break;
      }
    });
    return settled;
  };
  window.addEventListener("message", (event: MessageEvent<unknown>) => {
    switch (event.origin === window.location.origin) {
      case false:
        return;
    }
    const update = isUpdate(event.data) ? event.data : undefined;
    switch (update) {
      case undefined:
        break;
      default:
        source = update.source;
        void render();
    }
    const request = visualInteractionRequest(event.data);
    switch (request) {
      case undefined:
        break;
      default:
        void runVisualEditorInteractions({
          preview,
          getSource: () => source,
          settle: () => settled,
          getState: persistedState,
        }).then((result) => {
          vscode.postMessage({ kind: "visual-interactions-result", requestId: request.requestId, result });
        });
    }
  });
  elements.restore.addEventListener("click", () => {
    switch (lastValidSource) {
      case undefined:
        break;
      default:
        source = lastValidSource;
        vscode.postMessage({ kind: "edit", source });
        void render();
    }
  });
  elements.openSource.addEventListener("click", () => {
    vscode.postMessage({ kind: "open-source" });
  });
  void render().then(() => {
    vscode.postMessage({ kind: "visual-editor-ready" });
  });
};

const preview = document.getElementById("preview");
const elements = recoveryElements();
switch (preview) {
  case null:
    break;
  default:
    switch (elements) {
      case undefined:
        break;
      default:
        boot(preview, elements);
    }
}
