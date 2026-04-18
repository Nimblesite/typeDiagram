// [VSCODE-TEST-MOCK] Minimal vscode module mock for unit testing extension host code.
import { vi } from "vitest";

export const ViewColumn = { Beside: 2, Active: -1 } as const;

const FAKE_PDF = new TextEncoder().encode("%PDF-1.7\n" + "x".repeat(2048) + "\n%%EOF\n");

export const mockPanel = {
  webview: {
    html: "",
    postMessage: vi.fn(),
    asWebviewUri: vi.fn((uri: { path: string }) => ({
      toString: () => uri.path,
    })),
    cspSource: "https://mock.csp",
    // [PDF-PRINT-MOCK] printToPDF returns a minimal PDF-shaped buffer so
    // renderHtmlToPdf succeeds in tests.
    printToPDF: vi.fn(() => Promise.resolve(FAKE_PDF)),
    onDidReceiveMessage: vi.fn((handler: (msg: unknown) => void) => {
      // Fire a synthetic load-ready message so the extension's awaited promise resolves.
      queueMicrotask(() => {
        handler({ kind: "td-print-ready" });
      });
      return { dispose: vi.fn() };
    }),
  },
  reveal: vi.fn(),
  onDidDispose: vi.fn((cb: () => void) => {
    mockPanel._disposeCb = cb;
    return { dispose: vi.fn() };
  }),
  dispose: vi.fn(),
  _disposeCb: undefined as (() => void) | undefined,
  // Set to true by the extension when it wants createWebviewPanel to NOT steal focus.
  // Tests inspect this to model VS Code's real focus behavior.
  _preserveFocus: false,
};

export class TabInputText {
  constructor(public uri: { toString: () => string }) {}
}

type Tab = { input: unknown };
type TabGroup = { tabs: Tab[] };

export const mockOutputChannel = {
  appendLine: vi.fn(),
  append: vi.fn(),
  show: vi.fn(),
  hide: vi.fn(),
  clear: vi.fn(),
  dispose: vi.fn(),
  name: "TypeDiagram",
};

export const window = {
  activeTextEditor: undefined as { document: unknown } | undefined,
  visibleTextEditors: [] as { document: unknown }[],
  createWebviewPanel: vi.fn(() => mockPanel),
  createOutputChannel: vi.fn(() => mockOutputChannel),
  showInformationMessage: vi.fn((..._args: unknown[]) => Promise.resolve(undefined)),
  showErrorMessage: vi.fn((_msg: string) => Promise.resolve(undefined)),
  tabGroups: {
    all: [] as TabGroup[],
    close: vi.fn((_tabs: Tab[], _preserveFocus?: boolean) => Promise.resolve(true)),
  },
  onDidChangeActiveTextEditor: vi.fn((cb: (e: unknown) => void) => {
    window._activeEditorCb = cb;
    return { dispose: vi.fn() };
  }),
  onDidChangeVisibleTextEditors: vi.fn((cb: (editors: unknown[]) => void) => {
    window._visibleEditorsCb = cb;
    return { dispose: vi.fn() };
  }),
  _activeEditorCb: undefined as ((e: unknown) => void) | undefined,
  _visibleEditorsCb: undefined as ((editors: unknown[]) => void) | undefined,
};

export const commands = {
  registerCommand: vi.fn((cmd: string, cb: (...args: unknown[]) => unknown) => {
    commands._handlers.set(cmd, cb);
    if (cmd === "typediagram.preview") {
      commands._handler = cb as () => void;
    }
    return { dispose: vi.fn() };
  }),
  executeCommand: vi.fn((_cmd: string, ..._args: unknown[]) => Promise.resolve(undefined)),
  _handler: undefined as (() => void) | undefined,
  _handlers: new Map<string, (...args: unknown[]) => unknown>(),
};

export const workspace = {
  textDocuments: [] as unknown[],
  fs: {
    readFile: vi.fn((_u: unknown) => Promise.resolve(new Uint8Array())),
    writeFile: vi.fn((_u: unknown, _data: Uint8Array) => Promise.resolve()),
  },
  getConfiguration: vi.fn(() => ({
    get: <T>(_key: string, defaultValue?: T) => defaultValue,
  })),
  openTextDocument: vi.fn((_uri: unknown) => Promise.resolve(workspace._openTextDocResult)),
  _openTextDocResult: undefined as unknown,
  onDidOpenTextDocument: vi.fn((cb: (doc: unknown) => void) => {
    workspace._openCb = cb;
    return { dispose: vi.fn() };
  }),
  onDidChangeTextDocument: vi.fn((_cb: (e: unknown) => void) => {
    workspace._changeCb = _cb;
    return { dispose: vi.fn() };
  }),
  onDidCloseTextDocument: vi.fn((_cb: (doc: unknown) => void) => {
    workspace._closeCb = _cb;
    return { dispose: vi.fn() };
  }),
  _openCb: undefined as ((doc: unknown) => void) | undefined,
  _changeCb: undefined as ((e: unknown) => void) | undefined,
  _closeCb: undefined as ((doc: unknown) => void) | undefined,
};

export const Uri = {
  joinPath: vi.fn((_base: unknown, ...parts: string[]) => ({
    path: parts.join("/"),
  })),
};

export const env = {
  openExternal: vi.fn((_u: unknown) => Promise.resolve(true)),
};
