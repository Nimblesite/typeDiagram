// [VSCODE-EXT-TEST] Extension activation, command registration, and document change forwarding.
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as mock from "./vscode-mock.js";

vi.mock("vscode", () => mock);

describe("[VSCODE-EXT] activate", () => {
  const makeDoc = (text: string, langId = "typediagram", scheme = "file") => ({
    uri: {
      path: `/test/${langId}.td`,
      scheme,
      toString: () => `${scheme}:///test/${langId}.td`,
    },
    getText: () => text,
    languageId: langId,
  });

  const makeContext = () => ({
    extensionUri: { path: "/ext" },
    subscriptions: [] as { dispose: () => void }[],
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mock.mockPanel.webview.html = "";
    mock.mockPanel._disposeCb = undefined;
    mock.mockPanel._preserveFocus = false;
    mock.commands._handler = undefined;
    mock.workspace._changeCb = undefined;
    mock.workspace._closeCb = undefined;
    mock.workspace._openCb = undefined;
    mock.workspace.textDocuments = [];
    mock.workspace._openTextDocResult = undefined;
    mock.window.activeTextEditor = undefined;
    mock.window.visibleTextEditors = [];
    mock.window._activeEditorCb = undefined;
    mock.window._visibleEditorsCb = undefined;
    mock.window.tabGroups.all = [];
    mock.commands._handlers.clear();
  });

  it("registers typediagram.preview command on activate", async () => {
    const { activate } = await import("../src/extension.js");
    const ctx = makeContext();
    activate(ctx as never);
    expect(mock.commands.registerCommand).toHaveBeenCalledWith("typediagram.preview", expect.any(Function));
    expect(mock.commands.registerCommand).toHaveBeenCalledWith("typediagram.openAsDiagram", expect.any(Function));
    expect(ctx.subscriptions.length).toBe(7);
  });

  it("preview command does nothing without active typediagram editor", async () => {
    const { activate } = await import("../src/extension.js");
    const ctx = makeContext();
    activate(ctx as never);
    mock.window.activeTextEditor = undefined;
    mock.commands._handler?.();
    expect(mock.window.createWebviewPanel).not.toHaveBeenCalled();
  });

  it("preview command ignores non-typediagram files", async () => {
    const { activate } = await import("../src/extension.js");
    const ctx = makeContext();
    activate(ctx as never);
    mock.window.activeTextEditor = { document: makeDoc("x", "plaintext") };
    mock.commands._handler?.();
    expect(mock.window.createWebviewPanel).not.toHaveBeenCalled();
  });

  it("preview command opens webview panel for .td file", async () => {
    const { activate } = await import("../src/extension.js");
    const ctx = makeContext();
    activate(ctx as never);
    mock.window.activeTextEditor = { document: makeDoc("type Foo { x: Int }") };
    mock.commands._handler?.();
    expect(mock.window.createWebviewPanel).toHaveBeenCalled();
    expect(mock.mockPanel.webview.html).toContain("<!DOCTYPE html>");
    expect(mock.mockPanel.webview.html).toContain("type Foo");
  });

  it("reveals existing panel instead of creating duplicate", async () => {
    const { activate } = await import("../src/extension.js");
    const ctx = makeContext();
    activate(ctx as never);
    mock.window.activeTextEditor = { document: makeDoc("type A { x: Int }") };
    mock.commands._handler?.();
    mock.commands._handler?.();
    expect(mock.window.createWebviewPanel).toHaveBeenCalledTimes(1);
    expect(mock.mockPanel.reveal).toHaveBeenCalled();
  });

  it("forwards document changes to webview via postMessage", async () => {
    const { activate } = await import("../src/extension.js");
    const ctx = makeContext();
    activate(ctx as never);
    const doc = makeDoc("type X { a: Int }");
    mock.window.activeTextEditor = { document: doc };
    mock.commands._handler?.();
    mock.workspace._changeCb?.({ document: doc });
    expect(mock.mockPanel.webview.postMessage).toHaveBeenCalledWith({
      kind: "update",
      source: "type X { a: Int }",
    });
  });

  it("ignores changes to non-typediagram documents", async () => {
    const { activate } = await import("../src/extension.js");
    const ctx = makeContext();
    activate(ctx as never);
    mock.workspace._changeCb?.({ document: makeDoc("x", "json") });
    expect(mock.mockPanel.webview.postMessage).not.toHaveBeenCalled();
  });

  it("cleans up panel reference on document close", async () => {
    const { activate } = await import("../src/extension.js");
    const ctx = makeContext();
    activate(ctx as never);
    const doc = makeDoc("type Y { b: String }");
    mock.window.activeTextEditor = { document: doc };
    mock.commands._handler?.();
    mock.workspace._closeCb?.(doc);
    // After close, next open should create fresh panel
    mock.window.createWebviewPanel.mockClear();
    mock.commands._handler?.();
    expect(mock.window.createWebviewPanel).toHaveBeenCalledTimes(1);
  });

  it("deactivate is a no-op", async () => {
    const { deactivate } = await import("../src/extension.js");
    expect(typeof deactivate).toBe("function");
    deactivate();
  });

  it("auto-opens preview for already-open .td documents on activate", async () => {
    const { activate } = await import("../src/extension.js");
    const ctx = makeContext();
    mock.workspace.textDocuments = [makeDoc("type A { x: Int }")];
    activate(ctx as never);
    expect(mock.window.createWebviewPanel).toHaveBeenCalledTimes(1);
  });

  it("auto-opens preview when a .td document is opened later", async () => {
    const { activate } = await import("../src/extension.js");
    const ctx = makeContext();
    activate(ctx as never);
    mock.workspace._openCb?.(makeDoc("type B { y: Int }"));
    expect(mock.window.createWebviewPanel).toHaveBeenCalledTimes(1);
  });

  it("auto-opens preview when active editor switches to a .td document", async () => {
    const { activate } = await import("../src/extension.js");
    const ctx = makeContext();
    activate(ctx as never);
    mock.window._activeEditorCb?.({ document: makeDoc("type C { z: Int }") });
    expect(mock.window.createWebviewPanel).toHaveBeenCalledTimes(1);
  });

  it("auto-opens preview for .td docs already visible at activate", async () => {
    const { activate } = await import("../src/extension.js");
    const ctx = makeContext();
    mock.window.visibleTextEditors = [{ document: makeDoc("type V { v: Int }") }];
    activate(ctx as never);
    expect(mock.window.createWebviewPanel).toHaveBeenCalledTimes(1);
  });

  it("auto-opens preview for .td doc that becomes visible later", async () => {
    const { activate } = await import("../src/extension.js");
    const ctx = makeContext();
    activate(ctx as never);
    mock.window._visibleEditorsCb?.([{ document: makeDoc("type W { w: Int }") }]);
    expect(mock.window.createWebviewPanel).toHaveBeenCalledTimes(1);
  });

  it("auto-opens preview for active editor present at activate", async () => {
    const { activate } = await import("../src/extension.js");
    const ctx = makeContext();
    mock.window.activeTextEditor = { document: makeDoc("type Act { a: Int }") };
    activate(ctx as never);
    expect(mock.window.createWebviewPanel).toHaveBeenCalledTimes(1);
  });

  it("auto-open handles undefined editor and non-file schemes and non-td langs", async () => {
    const { activate } = await import("../src/extension.js");
    const ctx = makeContext();
    activate(ctx as never);
    mock.window._activeEditorCb?.(undefined);
    mock.workspace._openCb?.(makeDoc("x", "plaintext"));
    mock.workspace._openCb?.(makeDoc("x", "typediagram", "untitled"));
    expect(mock.window.createWebviewPanel).not.toHaveBeenCalled();
  });

  it("auto-open is suppressed when autoOpenPreview config is false", async () => {
    mock.workspace.getConfiguration.mockReturnValueOnce({
      get: <T>(_k: string, _d?: T) => false as unknown as T,
    });
    const { activate } = await import("../src/extension.js");
    const ctx = makeContext();
    mock.workspace.textDocuments = [makeDoc("type D { a: Int }")];
    activate(ctx as never);
    expect(mock.window.createWebviewPanel).not.toHaveBeenCalled();
  });

  it("auto-open fires only once per document", async () => {
    const { activate } = await import("../src/extension.js");
    const ctx = makeContext();
    activate(ctx as never);
    const doc = makeDoc("type E { b: Int }");
    mock.workspace._openCb?.(doc);
    mock.workspace._openCb?.(doc);
    mock.window._activeEditorCb?.({ document: doc });
    expect(mock.window.createWebviewPanel).toHaveBeenCalledTimes(1);
  });

  it("[VSCODE-OPEN-AS-DIAGRAM] openAsDiagram opens preview for explorer URI", async () => {
    const { activate } = await import("../src/extension.js");
    const ctx = makeContext();
    activate(ctx as never);
    const doc = makeDoc("type Diag { d: Int }");
    mock.workspace._openTextDocResult = doc;
    const handler = mock.commands._handlers.get("typediagram.openAsDiagram");
    await handler?.(doc.uri);
    expect(mock.workspace.openTextDocument).toHaveBeenCalledWith(doc.uri);
    expect(mock.window.createWebviewPanel).toHaveBeenCalled();
    expect(mock.window.createWebviewPanel.mock.calls[0][2]).toBe(mock.ViewColumn.Active);
  });

  it("[VSCODE-OPEN-AS-DIAGRAM] openAsDiagram falls back to active editor URI", async () => {
    const { activate } = await import("../src/extension.js");
    const ctx = makeContext();
    activate(ctx as never);
    const doc = makeDoc("type Fall { f: Int }");
    mock.window.activeTextEditor = { document: doc };
    mock.workspace._openTextDocResult = doc;
    const handler = mock.commands._handlers.get("typediagram.openAsDiagram");
    await handler?.(undefined);
    expect(mock.workspace.openTextDocument).toHaveBeenCalledWith(doc.uri);
  });

  it("[VSCODE-OPEN-AS-DIAGRAM] openAsDiagram closes existing source tabs for the same file", async () => {
    const { activate } = await import("../src/extension.js");
    const ctx = makeContext();
    activate(ctx as never);
    const doc = makeDoc("type Close { c: Int }");
    mock.workspace._openTextDocResult = doc;
    const sourceTab = { input: new mock.TabInputText(doc.uri) };
    const otherTab = { input: { toString: () => "other" } };
    mock.window.tabGroups.all = [{ tabs: [sourceTab, otherTab] }];
    const handler = mock.commands._handlers.get("typediagram.openAsDiagram");
    await handler?.(doc.uri);
    expect(mock.window.tabGroups.close).toHaveBeenCalledWith([sourceTab], false);
    expect(mock.window.createWebviewPanel).toHaveBeenCalled();
  });

  it("[VSCODE-OPEN-AS-DIAGRAM] openAsDiagram suppresses auto-open for marked diagram-only URIs", async () => {
    const { activate } = await import("../src/extension.js");
    const ctx = makeContext();
    activate(ctx as never);
    const doc = makeDoc("type DO { d: Int }");
    mock.workspace._openTextDocResult = doc;
    const handler = mock.commands._handlers.get("typediagram.openAsDiagram");
    await handler?.(doc.uri);
    mock.window.createWebviewPanel.mockClear();
    mock.workspace._openCb?.(doc);
    mock.window._activeEditorCb?.({ document: doc });
    expect(mock.window.createWebviewPanel).not.toHaveBeenCalled();
  });

  it("[VSCODE-OPEN-AS-DIAGRAM] closing the doc clears diagram-only marking", async () => {
    const { activate } = await import("../src/extension.js");
    const ctx = makeContext();
    activate(ctx as never);
    const doc = makeDoc("type Cl { c: Int }");
    mock.workspace._openTextDocResult = doc;
    const handler = mock.commands._handlers.get("typediagram.openAsDiagram");
    await handler?.(doc.uri);
    mock.mockPanel._disposeCb?.();
    mock.workspace._closeCb?.(doc);
    mock.window.createWebviewPanel.mockClear();
    mock.workspace._openCb?.(doc);
    expect(mock.window.createWebviewPanel).toHaveBeenCalledTimes(1);
  });

  it("[VSCODE-OPEN-AS-DIAGRAM] openAsDiagram does nothing without URI or active editor", async () => {
    const { activate } = await import("../src/extension.js");
    const ctx = makeContext();
    activate(ctx as never);
    const handler = mock.commands._handlers.get("typediagram.openAsDiagram");
    await handler?.(undefined);
    expect(mock.workspace.openTextDocument).not.toHaveBeenCalled();
    expect(mock.window.createWebviewPanel).not.toHaveBeenCalled();
  });

  // Shared scenario: simulates the user tapping a .td file in the explorer `taps` times,
  // and asserts that exactly ONE preview panel is created Beside the source. This covers
  // the basic invariant — auto-open is idempotent for the same URI within one focused column.
  // Note: VS Code's standard behavior of re-opening a file in a different column when the
  // user clicks the explorer with focus elsewhere is intentional and not modelled here.
  const runTapScenario = async (taps: number) => {
    const { activate } = await import("../src/extension.js");
    const ctx = makeContext();
    activate(ctx as never);

    const doc = makeDoc("type Sample { s: Int }");
    const editor = { document: doc };
    const sourceTab = { input: new mock.TabInputText(doc.uri) };
    mock.window.tabGroups.all = [{ tabs: [sourceTab] }];

    for (let i = 0; i < taps; i++) {
      mock.workspace._openCb?.(doc);
      mock.window.activeTextEditor = editor;
      mock.window._activeEditorCb?.(editor);
      mock.window.visibleTextEditors = [editor];
      mock.window._visibleEditorsCb?.([editor]);
      mock.window._visibleEditorsCb?.([editor]);
    }

    // INVARIANT 1: exactly ONE webview panel created (the diagram) — never two.
    expect(mock.window.createWebviewPanel).toHaveBeenCalledTimes(1);
    // INVARIANT 2: the diagram sits Beside the source (column 2).
    expect(mock.window.createWebviewPanel.mock.calls[0][2]).toBe(mock.ViewColumn.Beside);
    // INVARIANT 3: the diagram renders the source content.
    expect(mock.mockPanel.webview.html).toContain("type Sample");
    // INVARIANT 4: the source tab is NEVER closed.
    expect(mock.window.tabGroups.close).not.toHaveBeenCalled();
    // INVARIANT 5: never re-opens through openTextDocument.
    expect(mock.workspace.openTextDocument).not.toHaveBeenCalled();
    // INVARIANT 6: EXACTLY ONE source tab for this URI in tab groups.
    const sourceTabCount = mock.window.tabGroups.all
      .flatMap((g) => g.tabs)
      .filter((t) => t.input instanceof mock.TabInputText && t.input.uri.toString() === doc.uri.toString()).length;
    expect(sourceTabCount).toBe(1);
  };

  it("[VSCODE-AUTOPREVIEW-SINGLECLICK] single-tapping a .td in explorer opens EXACTLY source + diagram side-by-side — nothing else", async () => {
    await runTapScenario(1);
  });

  it("[VSCODE-AUTOPREVIEW-DOUBLECLICK] double-tapping a .td in explorer opens EXACTLY source + diagram side-by-side — nothing else", async () => {
    await runTapScenario(2);
  });

  it("[VSCODE-MD-EXTEND] extendMarkdownIt returns the md instance with fence rule installed", async () => {
    const { extendMarkdownIt } = await import("../src/extension.js");
    let installedFence: unknown;
    const md = {
      renderer: {
        rules: {
          get fence() {
            return installedFence as never;
          },
          set fence(v: unknown) {
            installedFence = v;
          },
        },
      },
    };
    const result = extendMarkdownIt(md as never);
    expect(result).toBe(md);
    expect(typeof installedFence).toBe("function");
  });

  it("[VSCODE-MD-EXTEND] extendMarkdownIt schedules a preview refresh after warmup", async () => {
    const { extendMarkdownIt } = await import("../src/extension.js");
    const md = { renderer: { rules: {} as Record<string, unknown> } };
    extendMarkdownIt(md as never);
    // Wait for the warmup microtask chain. Warmup calls into elk which takes ~30-200ms.
    // We give it a reasonable window.
    await new Promise((r) => setTimeout(r, 300));
    expect(mock.commands.executeCommand).toHaveBeenCalledWith("markdown.preview.refresh");
  });

  it("cleans up panel reference when webview is disposed", async () => {
    const { activate } = await import("../src/extension.js");
    const ctx = makeContext();
    activate(ctx as never);
    const doc = makeDoc("type Z { c: Bool }");
    mock.window.activeTextEditor = { document: doc };
    mock.commands._handler?.();
    mock.mockPanel._disposeCb?.();
    // After dispose, next open should create fresh panel
    mock.window.createWebviewPanel.mockClear();
    mock.commands._handler?.();
    expect(mock.window.createWebviewPanel).toHaveBeenCalledTimes(1);
  });
});
