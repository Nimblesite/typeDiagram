import type { Result } from "../result.js";
import {
  addRow,
  editRow,
  removeDeclaration,
  removeRow,
  renameDeclaration,
  type EditorFailure,
} from "./source-editor.js";
import { closeIcon, type CanvasChrome } from "./controls.js";
import { runWhen, runWhenDefined } from "./effects.js";
import type { VisualEditorOptions } from "./visual-editor.js";

export type EditorRow = { name: string; type: string };
export type EditorNode = { name: string; kind: "record" | "union" | "alias"; rows: EditorRow[] };
type RowContext = {
  node: EditorNode;
  getSource: () => string;
  mutate: (result: Result<string, EditorFailure>) => void;
};

const showFailure = (chrome: CanvasChrome, failure: EditorFailure) => {
  chrome.toast.textContent = failure.message;
  chrome.toast.hidden = false;
  globalThis.setTimeout(() => {
    chrome.toast.hidden = true;
  }, 2600);
};

export const applyMutation = (
  result: Result<string, EditorFailure>,
  options: VisualEditorOptions,
  chrome: CanvasChrome
) => {
  switch (result.ok) {
    case true:
      options.onSourceChange(result.value);
      break;
    case false:
      showFailure(chrome, result.error);
  }
};

const field = (labelText: string, value: string, onChange: (value: string) => void) => {
  const wrap = document.createElement("label");
  const label = document.createElement("span");
  const input = document.createElement("input");
  label.textContent = labelText;
  // defaultValue = the rendered model value, so `value !== defaultValue` marks
  // uncommitted or rejected text ([EDITOR-INSPECTOR-PENDING]).
  input.defaultValue = value;
  input.setAttribute("data-td-interactive", "true");
  input.addEventListener("change", () => {
    onChange(input.value);
  });
  wrap.append(label, input);
  return wrap;
};

const removeButton = (action: () => void) => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "td-icon-button td-inspector-remove";
  button.title = "Remove row";
  button.setAttribute("aria-label", "Remove row");
  button.setAttribute("data-td-interactive", "true");
  button.appendChild(closeIcon());
  button.addEventListener("click", action);
  return button;
};

const removeControls = (
  node: EditorNode,
  index: number,
  getSource: () => string,
  mutate: (result: Result<string, EditorFailure>) => void
) =>
  node.kind === "alias"
    ? []
    : [
        removeButton(() => {
          mutate(removeRow(getSource(), node.name, index));
        }),
      ];

const inspectorRow = (row: EditorRow, index: number, context: RowContext) => {
  const { node, getSource, mutate } = context;
  const element = document.createElement("div");
  element.className = `td-inspector-row${node.kind === "union" ? " td-inspector-row--union" : ""}`;
  element.append(
    field(node.kind === "union" ? "Variant" : "Field", row.name, (name) => {
      mutate(editRow(getSource(), node.name, index, { name }));
    }),
    field(node.kind === "union" ? "Payload" : "Type", row.type, (type) => {
      mutate(editRow(getSource(), node.name, index, { type }));
    }),
    ...removeControls(node, index, getSource, mutate)
  );
  return element;
};

const addButton = (action: () => void) => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "td-inspector-add";
  button.textContent = "+ Add row";
  button.addEventListener("click", action);
  return button;
};

const appendAddButton = (
  node: EditorNode,
  chrome: CanvasChrome,
  options: VisualEditorOptions,
  mutate: (result: Result<string, EditorFailure>) => void
) => {
  runWhen(node.kind !== "alias", () => {
    chrome.inspectorBody.appendChild(
      addButton(() => {
        mutate(addRow(options.getSource(), node.name));
      })
    );
  });
};

const appendDeleteButton = (
  node: EditorNode,
  chrome: CanvasChrome,
  options: VisualEditorOptions,
  mutate: (result: Result<string, EditorFailure>) => void
) => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "td-inspector-delete";
  button.textContent = "Delete type";
  button.setAttribute("aria-label", `Delete ${node.name}`);
  button.addEventListener("click", () => {
    const result = removeDeclaration(options.getSource(), node.name);
    mutate(result);
    runWhen(result.ok, () => {
      chrome.inspector.hidden = true;
    });
  });
  chrome.inspectorBody.appendChild(button);
};

type PendingInput = { index: number; value: string; focused: boolean };

const inspectorInputs = (chrome: CanvasChrome) => [...chrome.inspectorBody.querySelectorAll("input")];

/** [EDITOR-INSPECTOR-PENDING] Inputs of the shown node holding text the model does not
 *  (typed, rejected, or awaiting an async re-render), so a refresh never wipes them. */
const pendingInputs = (chrome: CanvasChrome, nodeName: string): PendingInput[] =>
  chrome.inspectorBody.dataset["tdNode"] === nodeName
    ? inspectorInputs(chrome).flatMap((input, index) =>
        input.value !== input.defaultValue
          ? [{ index, value: input.value, focused: document.activeElement === input }]
          : []
      )
    : [];

const restorePending = (chrome: CanvasChrome, pending: PendingInput[]) => {
  const inputs = inspectorInputs(chrome);
  pending.forEach(({ index, value, focused }) => {
    runWhenDefined(inputs[index], (input) => {
      input.value = value;
      runWhen(focused, () => {
        input.focus();
      });
    });
  });
};

export const renderInspector = (node: EditorNode, chrome: CanvasChrome, options: VisualEditorOptions) => {
  const pending = pendingInputs(chrome, node.name);
  const mutate = (result: Result<string, EditorFailure>) => {
    applyMutation(result, options, chrome);
  };
  const context = { node, getSource: options.getSource, mutate };
  chrome.inspectorKind.textContent = node.kind;
  chrome.inspectorBody.replaceChildren(
    field("Declaration", node.name, (name) => {
      mutate(renameDeclaration(options.getSource(), node.name, name));
    }),
    ...node.rows.map((row, index) => inspectorRow(row, index, context))
  );
  appendAddButton(node, chrome, options, mutate);
  appendDeleteButton(node, chrome, options, mutate);
  chrome.inspectorBody.dataset["tdNode"] = node.name;
  restorePending(chrome, pending);
  chrome.inspector.hidden = false;
};
