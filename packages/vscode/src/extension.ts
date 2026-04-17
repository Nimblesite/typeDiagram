// [VSCODE-EXT] Extension entry point — registers preview command, wires editor events.
import * as vscode from "vscode";
import { warmupSyncRender } from "typediagram-core";
import { openPreview } from "./preview-panel.js";
import { typediagramMarkdownItPlugin, type MarkdownIt } from "./markdown-it-plugin.js";

// [VSCODE-MD-EXTEND] Required export for VS Code's markdown preview plugin API.
// VS Code calls this with its markdown-it instance so we can augment it.
// See: https://code.visualstudio.com/api/extension-guides/markdown-extension
export const extendMarkdownIt = (md: MarkdownIt): MarkdownIt => {
  // Kick off warmup (fire-and-forget). First preview render may show the placeholder;
  // once warmup resolves we trigger a preview refresh so the SVG replaces it.
  void warmupSyncRender().then(() => {
    // [VSCODE-MD-REFRESH] After warmup, refresh any open markdown previews so placeholders
    // become real SVGs. `markdown.preview.refresh` is a built-in VS Code command.
    void vscode.commands.executeCommand("markdown.preview.refresh");
  });
  return typediagramMarkdownItPlugin(md);
};

export const activate = (context: vscode.ExtensionContext) => {
  const panels = new Map<string, vscode.WebviewPanel>();
  const diagramOnly = new Set<string>();

  const openFor = (doc: vscode.TextDocument) => {
    if (doc.languageId !== "typediagram") {
      return;
    }
    openPreview(context, doc, panels);
  };

  const cmd = vscode.commands.registerCommand("typediagram.preview", () => {
    const doc = vscode.window.activeTextEditor?.document;
    if (doc) {
      openFor(doc);
    }
  });

  // [VSCODE-OPEN-AS-DIAGRAM] Open a .td file directly as a diagram from the explorer context menu — no source editor.
  const openAsDiagram = vscode.commands.registerCommand("typediagram.openAsDiagram", async (uri?: vscode.Uri) => {
    const target = uri ?? vscode.window.activeTextEditor?.document.uri;
    if (!target) {
      return;
    }
    const key = target.toString();
    diagramOnly.add(key);
    const doc = await vscode.workspace.openTextDocument(target);
    const sourceTabs = vscode.window.tabGroups.all.flatMap((g) =>
      g.tabs.filter((t) => t.input instanceof vscode.TabInputText && t.input.uri.toString() === key)
    );
    if (sourceTabs.length > 0) {
      await vscode.window.tabGroups.close(sourceTabs, false);
    }
    openPreview(context, doc, panels, vscode.ViewColumn.Active);
  });

  // [VSCODE-AUTOPREVIEW] Auto-open preview beside the editor whenever a .td doc is shown without one.
  const maybeAutoOpen = (doc: vscode.TextDocument | undefined) => {
    if (doc?.languageId !== "typediagram" || doc.uri.scheme !== "file") {
      return;
    }
    const cfg = vscode.workspace.getConfiguration("typediagram");
    if (!cfg.get<boolean>("autoOpenPreview", true)) {
      return;
    }
    const key = doc.uri.toString();
    if (diagramOnly.has(key)) {
      return;
    }
    if (panels.has(key)) {
      return;
    }
    openFor(doc);
  };

  vscode.workspace.textDocuments.forEach(maybeAutoOpen);
  vscode.window.visibleTextEditors.forEach((e) => {
    maybeAutoOpen(e.document);
  });
  maybeAutoOpen(vscode.window.activeTextEditor?.document);

  const onOpen = vscode.workspace.onDidOpenTextDocument(maybeAutoOpen);
  const onActive = vscode.window.onDidChangeActiveTextEditor((e) => {
    maybeAutoOpen(e?.document);
  });
  const onVisible = vscode.window.onDidChangeVisibleTextEditors((editors) => {
    editors.forEach((e) => {
      maybeAutoOpen(e.document);
    });
  });

  const onChange = vscode.workspace.onDidChangeTextDocument((e) => {
    const doc = e.document;
    if (doc.languageId !== "typediagram") {
      return;
    }
    const panel = panels.get(doc.uri.toString());
    panel?.webview.postMessage({ kind: "update", source: doc.getText() });
  });

  const onClose = vscode.workspace.onDidCloseTextDocument((doc) => {
    const key = doc.uri.toString();
    panels.delete(key);
    diagramOnly.delete(key);
  });

  context.subscriptions.push(cmd, openAsDiagram, onOpen, onActive, onVisible, onChange, onClose);
};

export const deactivate = () => {};
