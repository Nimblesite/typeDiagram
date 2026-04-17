// [PDF] Markdown → PDF export with embedded vector typeDiagrams.
// Spec: docs/specs/pdf-export.md. Plan: docs/plans/pdf-export.md.
import type * as vscode from "vscode";
import MarkdownIt from "markdown-it";
import { renderMarkdownSync } from "typediagram-core/markdown";
import { getLogger } from "./logger.js";

type Theme = "light" | "dark";

// [PDF-COMPOSE] Public shape so tests can swap deps cleanly.
export interface ExportPdfDeps {
  readonly readFile: (uri: vscode.Uri) => Promise<Uint8Array>;
  readonly writeFile: (uri: vscode.Uri, data: Uint8Array) => Promise<void>;
  readonly createWebviewPanel: (
    viewType: string,
    title: string,
    showOptions: { viewColumn: number; preserveFocus: boolean },
    options: { enableScripts: boolean; retainContextWhenHidden: boolean }
  ) => WebviewPanelLike;
  readonly uriWithPath: (base: vscode.Uri, newPath: string) => vscode.Uri;
  readonly showInformationMessage: (msg: string, ...actions: string[]) => Promise<string | undefined>;
  readonly showErrorMessage: (msg: string) => void;
  readonly openExternal: (uri: vscode.Uri) => Promise<boolean>;
  readonly executeCommand: (cmd: string, ...args: unknown[]) => Promise<unknown>;
}

// [PDF-PRINT] Minimal panel shape we actually use.
export interface WebviewPanelLike {
  readonly webview: {
    html: string;
    readonly printToPDF?: (options?: Record<string, unknown>) => Promise<Uint8Array>;
    readonly onDidReceiveMessage: (handler: (msg: unknown) => void) => { dispose: () => void };
  };
  dispose: () => void;
}

// ---------------------------------------------------------------------------
// [PDF-READ]
// ---------------------------------------------------------------------------

export async function readMarkdown(uri: vscode.Uri, deps: Pick<ExportPdfDeps, "readFile">): Promise<string> {
  const bytes = await deps.readFile(uri);
  return new TextDecoder("utf-8").decode(bytes);
}

// ---------------------------------------------------------------------------
// [PDF-COMPOSE] Sentinel swap prevents markdown-it from HTML-escaping inline SVG.
// ---------------------------------------------------------------------------

const SENTINEL_PREFIX = "<!--TD-SVG-";
const SENTINEL_SUFFIX = "-->";
const SVG_BLOCK_RE = /<svg\b[\s\S]*?<\/svg>/gi;

interface SentinelSwap {
  skeleton: string;
  svgs: string[];
}

export function extractSvgs(mdWithSvgs: string): SentinelSwap {
  const svgs: string[] = [];
  const skeleton = mdWithSvgs.replace(SVG_BLOCK_RE, (match) => {
    const i = svgs.length;
    svgs.push(match);
    return `${SENTINEL_PREFIX}${String(i)}${SENTINEL_SUFFIX}`;
  });
  return { skeleton, svgs };
}

export function reinjectSvgs(html: string, svgs: string[]): string {
  return html.replace(/<!--TD-SVG-(\d+)-->/g, (_m, idx: string) => {
    const n = Number(idx);
    const svg = svgs[n];
    if (svg === undefined) {
      throw new Error(`[PDF-COMPOSE] unmatched sentinel index ${idx}`);
    }
    return svg;
  });
}

// [PDF-SHELL] Self-contained printable HTML. No external resources. A4 + 20mm margins.
export function buildShell(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
@page { size: A4; margin: 20mm; }
html, body { background: #fff; color: #111; }
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; font-size: 11pt; line-height: 1.5; margin: 0; }
h1, h2, h3, h4, h5, h6 { line-height: 1.2; margin-top: 1.2em; }
code, pre { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: 10pt; }
pre { background: #f4f4f6; padding: 0.75em 1em; border-radius: 4px; overflow-x: auto; }
pre code { background: none; padding: 0; }
code { background: #f4f4f6; padding: 0.1em 0.3em; border-radius: 3px; }
.typediagram { page-break-inside: avoid; margin: 1em 0; }
.typediagram svg { max-width: 100%; height: auto; }
a { color: #0366d6; }
table { border-collapse: collapse; }
th, td { border: 1px solid #ddd; padding: 0.4em 0.6em; }
</style>
</head>
<body>
${bodyHtml}
<script>window.addEventListener('load', () => { /* marker for print */ });</script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export interface ComposeResult {
  html: string;
  fenceCount: number;
  diagnostics: ReadonlyArray<{ line: number; col: number; severity: string; message: string }>;
}

export function composeHtml(mdSource: string, opts: { theme: Theme; title: string }): ComposeResult {
  // Step 1: fence → SVG (reuses core, already case-insensitive). renderMarkdownSync returns
  // Result.err when ANY fence fails to render, but the success path returns the full
  // transformed markdown (fences replaced with SVG or error-comment). We only care about
  // separating diagnostics from the transformed text — we want the text in BOTH cases.
  const rendered = renderMarkdownSync(mdSource, { theme: opts.theme });
  // eslint-disable-next-line no-console
  console.error("[DBG composeHtml] rendered.ok=", rendered.ok, "srcLen=", mdSource.length);
  // The integration helper doesn't give us the transformed-with-errors text when ok=false,
  // so on hard failure we fall back to the raw source + surface the diagnostics.
  const mdWithSvgs = rendered.ok ? rendered.value : mdSource;
  const diagnostics = rendered.ok ? [] : rendered.error;
  // eslint-disable-next-line no-console
  console.error("[DBG composeHtml] mdWithSvgs has <svg:", mdWithSvgs.includes("<svg"));

  // Step 2: sentinel swap so markdown-it never sees raw <svg>.
  const { skeleton, svgs } = extractSvgs(mdWithSvgs);
  // eslint-disable-next-line no-console
  console.error("[DBG composeHtml] svgs extracted:", svgs.length, "skel preview:", skeleton.slice(0, 100));

  // Step 3: markdown → HTML.
  const md = new MarkdownIt({ html: false, linkify: true, typographer: false });
  const bodyHtml = md.render(skeleton);
  // eslint-disable-next-line no-console
  console.error("[DBG composeHtml] bodyHtml has sentinel:", bodyHtml.includes("TD-SVG-"), "preview:", bodyHtml.slice(0, 200));

  // Step 4: put the SVGs back.
  const finalBody = reinjectSvgs(bodyHtml, svgs);
  // eslint-disable-next-line no-console
  console.error("[DBG composeHtml] finalBody has <svg:", finalBody.includes("<svg"));

  // Step 5: wrap in the shell.
  const html = buildShell(opts.title, finalBody);
  return { html, fenceCount: svgs.length, diagnostics };
}

// ---------------------------------------------------------------------------
// [PDF-PRINT]
// ---------------------------------------------------------------------------

const PRINT_LOAD_TIMEOUT_MS = 10_000;

export async function renderHtmlToPdf(
  html: string,
  deps: Pick<ExportPdfDeps, "createWebviewPanel">
): Promise<Uint8Array> {
  // 2 = ViewColumn.Beside; we avoid importing vscode here so deps is the only surface.
  const panel = deps.createWebviewPanel(
    "typediagram.pdfExport",
    "TypeDiagram PDF Export",
    { viewColumn: 2, preserveFocus: true },
    { enableScripts: true, retainContextWhenHidden: true }
  );

  try {
    const loaded = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("[PDF-PRINT] webview load timeout"));
      }, PRINT_LOAD_TIMEOUT_MS);
      const sub = panel.webview.onDidReceiveMessage(() => {
        clearTimeout(timer);
        sub.dispose();
        resolve();
      });
      // The shell emits one load marker via window.addEventListener('load')
      // and then posts to the extension host. We inject that bridge here:
      panel.webview.html = html.replace(
        "/* marker for print */",
        "const vs = acquireVsCodeApi(); vs.postMessage({ kind: 'td-print-ready' });"
      );
    });
    await loaded;

    const print = panel.webview.printToPDF;
    if (typeof print !== "function") {
      throw new Error("[PDF-PRINT] webview.printToPDF is not available in this VS Code runtime");
    }
    const buf = await print({
      marginsType: 0,
      pageSize: "A4",
      printBackground: true,
      printSelectionOnly: false,
      landscape: false,
    });
    return buf;
  } finally {
    panel.dispose();
  }
}

// ---------------------------------------------------------------------------
// [PDF-SAVE]
// ---------------------------------------------------------------------------

const MD_EXT_RE = /\.(md|markdown)$/i;

export function siblingPdfPath(sourcePath: string): string {
  if (MD_EXT_RE.test(sourcePath)) {
    return sourcePath.replace(MD_EXT_RE, ".pdf");
  }
  return `${sourcePath}.pdf`;
}

export async function writeNextToSource(
  buf: Uint8Array,
  sourceUri: vscode.Uri,
  deps: Pick<ExportPdfDeps, "writeFile" | "uriWithPath">
): Promise<vscode.Uri> {
  const target = deps.uriWithPath(sourceUri, siblingPdfPath(sourceUri.path));
  await deps.writeFile(target, buf);
  return target;
}

// ---------------------------------------------------------------------------
// Composer + per-URI concurrency lock
// ---------------------------------------------------------------------------

const inFlight = new Map<string, Promise<void>>();

export async function exportPdf(
  sourceUri: vscode.Uri,
  opts: { theme: Theme },
  deps: ExportPdfDeps
): Promise<void> {
  const log = getLogger().child({ scope: "export-pdf" });
  const key = sourceUri.toString();
  const existing = inFlight.get(key);
  if (existing) {
    log.warn("export-pdf already in progress for URI, awaiting existing", { uri: key });
    await existing;
    return;
  }
  const run = runExport(sourceUri, opts, deps, log);
  inFlight.set(key, run);
  try {
    await run;
  } finally {
    inFlight.delete(key);
  }
}

async function runExport(
  sourceUri: vscode.Uri,
  opts: { theme: Theme },
  deps: ExportPdfDeps,
  log: ReturnType<typeof getLogger>
): Promise<void> {
  log.info("export-pdf invoked", { uri: sourceUri.toString() });
  try {
    const t0 = Date.now();
    const src = await readMarkdown(sourceUri, deps);
    const title = titleFromPath(sourceUri.path);
    const composed = composeHtml(src, { theme: opts.theme, title });
    log.info("composed HTML", {
      fenceCount: composed.fenceCount,
      htmlLength: composed.html.length,
      elapsedMs: Date.now() - t0,
      diagnostics: composed.diagnostics.length,
    });

    const t1 = Date.now();
    const buf = await renderHtmlToPdf(composed.html, deps);
    log.info("rendered PDF", { bufferLength: buf.length, elapsedMs: Date.now() - t1 });

    const saved = await writeNextToSource(buf, sourceUri, deps);
    log.info("saved PDF", { savedUri: saved.toString() });

    notifySaved(saved, deps, log);
  } catch (err) {
    log.error("export-pdf failed", { err: String(err) });
    deps.showErrorMessage(`TypeDiagram: PDF export failed — ${String(err)}`);
  }
}

function titleFromPath(path: string): string {
  const basename = path.split("/").pop() ?? "document.md";
  return basename.replace(MD_EXT_RE, "");
}

function notifySaved(saved: vscode.Uri, deps: ExportPdfDeps, log: ReturnType<typeof getLogger>): void {
  // Fire-and-forget — the command itself has completed by this point.
  void deps.showInformationMessage(`TypeDiagram PDF written: ${saved.path}`, "Open PDF", "Reveal in File Explorer").then(
    (choice) => {
      if (choice === "Open PDF") {
        void deps.openExternal(saved);
      } else if (choice === "Reveal in File Explorer") {
        void deps.executeCommand("revealFileInOS", saved);
      }
      log.info("notification dismissed", { choice: choice ?? "(none)" });
    },
    (err: unknown) => {
      log.error("notification failed", { err: String(err) });
    }
  );
}
