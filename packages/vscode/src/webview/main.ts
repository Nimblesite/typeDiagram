// [VSCODE-WEBVIEW] Webview script — renders .td source to SVG using typediagram.
// Reuses the same renderToString API as the web playground and CLI.
import { parser, renderToString } from "typediagram-core";

type UpdateMessage = { kind: "update"; source: string };

acquireVsCodeApi();
const previewEl = document.getElementById("preview");
const errorEl = document.getElementById("error");
if (previewEl === null || errorEl === null) {
  throw new Error("[VSCODE-WEBVIEW] missing preview or error element");
}

const detectTheme = (): "light" | "dark" =>
  document.body.getAttribute("data-vscode-theme-kind")?.includes("dark") === true ? "dark" : "light";

const renderSource = async (source: string) => {
  const result = await renderToString(source, { theme: detectTheme() });
  previewEl.innerHTML = result.ok ? result.value : "";
  errorEl.textContent = result.ok ? "" : parser.formatDiagnostics([...result.error]);
};

// Initial render from data attribute
const scriptTag = document.querySelector("script[data-source]");
const initial =
  scriptTag
    ?.getAttribute("data-source")
    ?.replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&") ?? "";

void renderSource(initial);

// Live updates from extension host
window.addEventListener("message", (e: MessageEvent<UpdateMessage>) => {
  void renderSource(e.data.source);
});
