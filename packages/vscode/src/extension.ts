// [VSCODE-EXT] Extension entry point — registers preview command, wires editor events.
import * as vscode from "vscode";
import { warmupSyncRender, isSyncRenderReady } from "typediagram-core";
import { openPreview } from "./preview-panel.js";
import { typediagramMarkdownItPlugin, type MarkdownIt, setPluginLogger } from "./markdown-it-plugin.js";
import { getLogger, initLogger } from "./logger.js";

let extendCallCount = 0;

// [VSCODE-MD-EXTEND] Canonical pattern from mjbvz/vscode-markdown-mermaid: VS Code
// reads `extendMarkdownIt` off the OBJECT RETURNED BY `activate()`, not from top-level
// module exports. Previously we exported a named `extendMarkdownIt` — VS Code ignored it,
// which is why the preview kept showing plain fenced code.
// https://github.com/mjbvz/vscode-markdown-mermaid/blob/master/src/vscode-extension/index.ts
export const extendMarkdownIt = (md: MarkdownIt): MarkdownIt => {
  const log = getLogger().child({ scope: "extendMarkdownIt" });
  extendCallCount += 1;
  const alreadyWarm = isSyncRenderReady();
  log.info("called by VS Code markdown preview", { callCount: extendCallCount, alreadyWarm });
  setPluginLogger(getLogger());

  if (!alreadyWarm) {
    const startedAt = Date.now();
    void warmupSyncRender().then(
      () => {
        log.info("warmup complete, triggering markdown.preview.refresh", {
          elapsedMs: Date.now() - startedAt,
        });
        void vscode.commands.executeCommand("markdown.preview.refresh").then(
          () => {
            log.info("markdown.preview.refresh resolved");
          },
          (err: unknown) => {
            log.error("markdown.preview.refresh failed", { err: String(err) });
          }
        );
      },
      (err: unknown) => {
        log.error("warmup failed", { err: String(err) });
      }
    );
  }
  return typediagramMarkdownItPlugin(md);
};

interface ExtensionPackageJson {
  version: string;
}

export const activate = (context: vscode.ExtensionContext) => {
  const log = initLogger(context).child({ scope: "activate" });
  const pkg = context.extension.packageJSON as ExtensionPackageJson;
  log.info("extension activating", {
    version: pkg.version,
    extensionPath: context.extensionPath,
  });
  setPluginLogger(getLogger());
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

  // [VSCODE-MD-EXTEND-RETURN] VS Code reads extendMarkdownIt off THIS return value —
  // NOT off the top-level module exports. This is the critical wiring per the official
  // Markdown Preview Mermaid Support extension (bierner.markdown-mermaid).
  log.info("activate returning extendMarkdownIt contribution");
  return { extendMarkdownIt };
};

export const deactivate = () => {};
