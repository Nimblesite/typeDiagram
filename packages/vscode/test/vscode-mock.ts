// [VSCODE-TEST-MOCK] Minimal vscode module mock for unit testing extension host code.
import { vi } from "vitest";

export const ViewColumn = { Beside: 2, Active: -1 } as const;

export const mockPanel = {
  webview: {
    html: "",
    postMessage: vi.fn(),
    asWebviewUri: vi.fn((uri: { path: string }) => ({
      toString: () => uri.path,
    })),
    cspSource: "https://mock.csp",
  },
  reveal: vi.fn(),
  onDidDispose: vi.fn((cb: () => void) => {
    mockPanel._disposeCb = cb;
    return { dispose: vi.fn() };
  }),
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

export const window = {
  activeTextEditor: undefined as { document: unknown } | undefined,
  visibleTextEditors: [] as { document: unknown }[],
  createWebviewPanel: vi.fn(() => mockPanel),
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
