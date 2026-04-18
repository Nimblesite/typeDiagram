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
    extensionPath: "/ext",
    extension: { packageJSON: { version: "0.3.0-test" } },
    logUri: { fsPath: "/tmp/td-log-test" },
    globalStorageUri: { fsPath: "/tmp/td-log-test" },
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
    // 7 original disposables + 1 Output Channel added by initLogger.
    // The Output Channel may already have been added in a prior test (lazy ensureChannel),
    // so we assert >= 7. Either way, both commands must be present.
    expect(ctx.subscriptions.length).toBeGreaterThanOrEqual(7);
    expect(mock.window.createOutputChannel).toHaveBeenCalledWith("TypeDiagram");
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
    await new Promise((r) => setTimeout(r, 400));
    expect(mock.commands.executeCommand).toHaveBeenCalledWith("markdown.preview.refresh");
  });

  it("[VSCODE-MD-EXTEND-LOG] extendMarkdownIt writes lifecycle logs to the Output Channel", async () => {
    mock.mockOutputChannel.appendLine.mockClear();
    const { extendMarkdownIt } = await import("../src/extension.js");
    const md = { renderer: { rules: {} as Record<string, unknown> } };
    extendMarkdownIt(md as never);
    const initialLines = mock.mockOutputChannel.appendLine.mock.calls.map((c) => c[0] as string);
    // Must have logged that VS Code called us
    expect(initialLines.some((l) => l.includes("called by VS Code markdown preview"))).toBe(true);
    // Must include scope binding
    expect(initialLines.some((l) => l.includes('"scope":"extendMarkdownIt"'))).toBe(true);
    await new Promise((r) => setTimeout(r, 400));
    const allLines = mock.mockOutputChannel.appendLine.mock.calls.map((c) => c[0] as string);
    // Must have logged warmup completion OR (if warm already) at least one call
    const sawWarmupDone = allLines.some((l) => l.includes("warmup complete"));
    const sawAlreadyWarm = initialLines.some((l) => l.includes('"alreadyWarm":true'));
    expect(sawWarmupDone || sawAlreadyWarm).toBe(true);
  });

  it("[VSCODE-MD-EXTEND-REFRESH-ERR] extendMarkdownIt logs when markdown.preview.refresh fails", async () => {
    // Reset modules + stub core so warmup is un-warm, resolves immediately.
    vi.resetModules();
    vi.doMock("typediagram-core", () => ({
      warmupSyncRender: async () => {
        await Promise.resolve();
      },
      isSyncRenderReady: () => false,
      renderToStringSync: () => ({ ok: false, error: [] }),
    }));
    mock.mockOutputChannel.appendLine.mockClear();
    mock.commands.executeCommand.mockRejectedValueOnce(new Error("refresh boom"));
    const { extendMarkdownIt } = await import("../src/extension.js");
    const md = { renderer: { rules: {} as Record<string, unknown> } };
    extendMarkdownIt(md as never);
    await new Promise((r) => setTimeout(r, 400));
    const lines = mock.mockOutputChannel.appendLine.mock.calls.map((c) => c[0] as string);
    expect(lines.some((l) => l.includes("markdown.preview.refresh failed") && l.includes("refresh boom"))).toBe(true);
    vi.doUnmock("typediagram-core");
  });

  it("[VSCODE-MD-EXTEND-WARMUP-ERR] extendMarkdownIt logs when warmup rejects", async () => {
    // Mock the core to reject warmup just for this test
    vi.resetModules();
    mock.mockOutputChannel.appendLine.mockClear();
    vi.doMock("typediagram-core", () => ({
      warmupSyncRender: async () => {
        await Promise.resolve();
        throw new Error("elk blew up");
      },
      isSyncRenderReady: () => false,
      renderToStringSync: () => ({ ok: false, error: [] }),
    }));
    const { extendMarkdownIt } = await import("../src/extension.js");
    const md = { renderer: { rules: {} as Record<string, unknown> } };
    extendMarkdownIt(md as never);
    await new Promise((r) => setTimeout(r, 300));
    const lines = mock.mockOutputChannel.appendLine.mock.calls.map((c) => c[0] as string);
    expect(lines.some((l) => l.includes("warmup failed") && l.includes("elk blew up"))).toBe(true);
    vi.doUnmock("typediagram-core");
  });

  it("[VSCODE-MD-EXTEND-RETURN] activate returns an object containing extendMarkdownIt (the canonical Mermaid pattern)", async () => {
    const { activate, extendMarkdownIt } = await import("../src/extension.js");
    const ctx = makeContext();
    const api = activate(ctx as never);
    expect(api).toBeDefined();
    expect(api).toHaveProperty("extendMarkdownIt");
    // Must be the SAME function reference as the named export (double-wired intentionally)
    expect(api.extendMarkdownIt).toBe(extendMarkdownIt);
    // Invoking what VS Code will receive must actually plug into markdown-it
    const md = { renderer: { rules: {} as Record<string, unknown> } };
    const returned = api.extendMarkdownIt(md as never);
    expect(returned).toBe(md);
    expect(typeof md.renderer.rules["fence"]).toBe("function");
  });

  it("[PDF-COMMAND] exportMarkdownPdf command handler reads, exports, writes next to source", async () => {
    const { activate } = await import("../src/extension.js");
    const ctx = makeContext();
    activate(ctx as never);
    const exportHandler = mock.commands._handlers.get("typediagram.exportMarkdownPdf");
    expect(exportHandler).toBeDefined();

    // Set up fs mocks
    mock.workspace.fs.readFile = vi.fn(() =>
      Promise.resolve(new TextEncoder().encode("# hi\n\n```typediagram\ntype X { a: Int }\n```\n"))
    );
    mock.workspace.fs.writeFile = vi.fn(() => Promise.resolve());
    const targetUri = {
      path: "/tmp/example.md",
      scheme: "file",
      toString: () => "file:///tmp/example.md",
      with: (changes: { path: string }) => ({
        path: changes.path,
        scheme: "file",
        toString: () => `file://${changes.path}`,
      }),
    };
    await exportHandler?.(targetUri);
    expect(mock.workspace.fs.readFile).toHaveBeenCalledWith(targetUri);
    expect(mock.workspace.fs.writeFile).toHaveBeenCalledTimes(1);
    const writeCall = mock.workspace.fs.writeFile.mock.calls[0] as [unknown, Uint8Array];
    expect((writeCall[0] as { path: string }).path).toBe("/tmp/example.pdf");
    // Real PDF bytes in the write buffer
    expect(new TextDecoder().decode(writeCall[1].slice(0, 5))).toBe("%PDF-");
  });

  it("[PDF-COMMAND] exportMarkdownPdf falls back to active editor URI when none passed", async () => {
    const { activate } = await import("../src/extension.js");
    const ctx = makeContext();
    activate(ctx as never);
    const exportHandler = mock.commands._handlers.get("typediagram.exportMarkdownPdf");
    const activeUri = {
      path: "/tmp/active.md",
      scheme: "file",
      toString: () => "file:///tmp/active.md",
      with: (changes: { path: string }) => ({
        path: changes.path,
        scheme: "file",
        toString: () => `file://${changes.path}`,
      }),
    };
    mock.window.activeTextEditor = { document: { uri: activeUri } as never };
    mock.workspace.fs.readFile = vi.fn(() => Promise.resolve(new TextEncoder().encode("# hi")));
    mock.workspace.fs.writeFile = vi.fn(() => Promise.resolve());
    await exportHandler?.();
    expect(mock.workspace.fs.readFile).toHaveBeenCalledWith(activeUri);
  });

  it("[PDF-COMMAND] Open PDF action wires openExternal on the saved URI", async () => {
    const { activate } = await import("../src/extension.js");
    const ctx = makeContext();
    activate(ctx as never);
    const exportHandler = mock.commands._handlers.get("typediagram.exportMarkdownPdf");
    mock.workspace.fs.readFile = vi.fn(() => Promise.resolve(new TextEncoder().encode("# hi")));
    mock.workspace.fs.writeFile = vi.fn(() => Promise.resolve());
    mock.window.showInformationMessage.mockImplementationOnce(() => Promise.resolve("Open PDF"));
    mock.env.openExternal.mockClear();
    const targetUri = {
      path: "/tmp/openpdf.md",
      scheme: "file",
      toString: () => "file:///tmp/openpdf.md",
      with: (changes: { path: string }) => ({
        path: changes.path,
        scheme: "file",
        toString: () => `file://${changes.path}`,
      }),
    };
    await exportHandler?.(targetUri);
    await new Promise((r) => setTimeout(r, 10));
    expect(mock.env.openExternal).toHaveBeenCalledTimes(1);
  });

  it("[PDF-COMMAND] Reveal action wires revealFileInOS via executeCommand", async () => {
    const { activate } = await import("../src/extension.js");
    const ctx = makeContext();
    activate(ctx as never);
    const exportHandler = mock.commands._handlers.get("typediagram.exportMarkdownPdf");
    mock.workspace.fs.readFile = vi.fn(() => Promise.resolve(new TextEncoder().encode("# hi")));
    mock.workspace.fs.writeFile = vi.fn(() => Promise.resolve());
    mock.window.showInformationMessage.mockImplementationOnce(() => Promise.resolve("Reveal in File Explorer"));
    const execSpy = vi.spyOn(mock.commands, "executeCommand");
    execSpy.mockClear();
    const targetUri = {
      path: "/tmp/reveal.md",
      scheme: "file",
      toString: () => "file:///tmp/reveal.md",
      with: (changes: { path: string }) => ({
        path: changes.path,
        scheme: "file",
        toString: () => `file://${changes.path}`,
      }),
    };
    await exportHandler?.(targetUri);
    await new Promise((r) => setTimeout(r, 10));
    expect(execSpy).toHaveBeenCalledWith("revealFileInOS", expect.anything());
  });

  it("[PDF-COMMAND] exportMarkdownPdf surfaces showErrorMessage on readFile failure", async () => {
    const { activate } = await import("../src/extension.js");
    const ctx = makeContext();
    activate(ctx as never);
    const exportHandler = mock.commands._handlers.get("typediagram.exportMarkdownPdf");
    mock.workspace.fs.readFile = vi.fn(() => Promise.reject(new Error("ENOENT fake")));
    mock.workspace.fs.writeFile = vi.fn();
    mock.window.showErrorMessage.mockClear();
    const targetUri = {
      path: "/tmp/missing.md",
      scheme: "file",
      toString: () => "file:///tmp/missing.md",
      with: (changes: { path: string }) => ({
        path: changes.path,
        scheme: "file",
        toString: () => `file://${changes.path}`,
      }),
    };
    await exportHandler?.(targetUri);
    expect(mock.window.showErrorMessage).toHaveBeenCalledTimes(1);
    const errMsg = mock.window.showErrorMessage.mock.calls[0]?.[0] as string;
    expect(errMsg).toContain("ENOENT fake");
  });

  it("[PDF-COMMAND] exportMarkdownPdf no-ops without URI or active editor", async () => {
    const { activate } = await import("../src/extension.js");
    const ctx = makeContext();
    activate(ctx as never);
    const exportHandler = mock.commands._handlers.get("typediagram.exportMarkdownPdf");
    mock.window.activeTextEditor = undefined;
    mock.workspace.fs.readFile = vi.fn();
    mock.workspace.fs.writeFile = vi.fn();
    await exportHandler?.();
    expect(mock.workspace.fs.readFile).not.toHaveBeenCalled();
    expect(mock.workspace.fs.writeFile).not.toHaveBeenCalled();
  });

  it("[VSCODE-ACTIVATE-LOG] activate logs version + path", async () => {
    mock.mockOutputChannel.appendLine.mockClear();
    const { activate } = await import("../src/extension.js");
    const ctx = makeContext();
    activate(ctx as never);
    const lines = mock.mockOutputChannel.appendLine.mock.calls.map((c) => c[0] as string);
    expect(lines.some((l) => l.includes("extension activating"))).toBe(true);
    expect(lines.some((l) => l.includes('"version":"0.3.0-test"'))).toBe(true);
    expect(lines.some((l) => l.includes('"extensionPath":"/ext"'))).toBe(true);
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
