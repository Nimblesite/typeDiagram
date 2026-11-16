// [VSCODE-WEBVIEW-HTML] Generates the HTML shell for the preview webview.
import type * as vscode from "vscode";

export const webviewHtml = (cspSource: string, scriptUri: vscode.Uri, initialSource: string) => {
  const escaped = initialSource
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; script-src ${cspSource}; style-src 'unsafe-inline';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    html, body { width: 100%; height: 100%; }
    body { margin: 0; background: #0b1326; overflow: hidden; }
    #preview { width: 100%; height: 100%; }
    #error-panel { position: absolute; z-index: 20; top: 16px; left: 16px; right: 16px; display: grid; grid-template-columns: minmax(0,1fr) auto auto; gap: 8px; align-items: center; padding: 12px; border-radius: 3px; background: rgba(49,57,77,.94); box-shadow: 0 20px 40px rgba(0,0,0,.4); }
    #error-panel[hidden] { display: none; }
    #error { min-width: 0; margin: 0; color: var(--vscode-errorForeground); font-family: var(--vscode-editor-font-family); white-space: pre-wrap; }
    .error-action { height: 34px; padding: 0 12px; border: 0; border-radius: 3px; background: #174966; color: #8ed5ff; font: 700 12px/1 var(--vscode-editor-font-family); cursor: pointer; }
    .error-action:hover { background: #205c7d; }
    .error-action:disabled { opacity: .45; cursor: not-allowed; }
  </style>
</head>
<body>
  <main id="preview" aria-label="Visual type editor"></main>
  <section id="error-panel" hidden>
    <pre id="error" role="alert"></pre>
    <button id="restore-valid-source" class="error-action" type="button" aria-label="Undo invalid edit">Undo invalid edit</button>
    <button id="open-source" class="error-action" type="button">Open source</button>
  </section>
  <script data-source="${escaped}" src="${scriptUri.toString()}"></script>
</body>
</html>`;
};
