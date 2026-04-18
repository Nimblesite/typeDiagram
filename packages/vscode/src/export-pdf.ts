// [PDF] Markdown → PDF export with embedded vector typeDiagrams.
// Spec: docs/specs/pdf-export.md. Plan: docs/plans/pdf-export.md.
import type * as vscode from "vscode";
import MarkdownIt from "markdown-it";
import PDFDocument from "pdfkit";
import SVGtoPDF from "svg-to-pdfkit";
import { renderMarkdownSync } from "typediagram-core/markdown";
import { getLogger } from "./logger.js";

type Theme = "light" | "dark";

// [PDF-COMPOSE] Public shape so tests can swap deps cleanly.
export interface ExportPdfDeps {
  readonly readFile: (uri: vscode.Uri) => Promise<Uint8Array>;
  readonly writeFile: (uri: vscode.Uri, data: Uint8Array) => Promise<void>;
  readonly uriWithPath: (base: vscode.Uri, newPath: string) => vscode.Uri;
  readonly showInformationMessage: (msg: string, ...actions: string[]) => Promise<string | undefined>;
  readonly showErrorMessage: (msg: string) => void;
  readonly openExternal: (uri: vscode.Uri) => Promise<boolean>;
  readonly executeCommand: (cmd: string, ...args: unknown[]) => Promise<unknown>;
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

// [PDF-COMPOSE-SENTINEL] A non-HTML, non-markdown-significant token. markdown-it never
// transforms identifier-like strings. We use a Unicode private-use-area bracket to make
// accidental collision with user content impossibly rare.
const SENTINEL_PREFIX = "\uE000TDSVG";
const SENTINEL_SUFFIX = "\uE001";
const SENTINEL_RE = /\uE000TDSVG(\d+)\uE001/g;
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
  return html.replace(SENTINEL_RE, (_m, idx: string) => {
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
  // The integration helper doesn't give us the transformed-with-errors text when ok=false,
  // so on hard failure we fall back to the raw source + surface the diagnostics.
  const mdWithSvgs = rendered.ok ? rendered.value : mdSource;
  const diagnostics = rendered.ok ? [] : rendered.error;

  // Step 2: sentinel swap so markdown-it never sees raw <svg>.
  const { skeleton, svgs } = extractSvgs(mdWithSvgs);

  // Step 3: markdown → HTML.
  const md = new MarkdownIt({ html: false, linkify: true, typographer: false });
  const bodyHtml = md.render(skeleton);

  // Step 4: put the SVGs back.
  const finalBody = reinjectSvgs(bodyHtml, svgs);

  // Step 5: wrap in the shell.
  const html = buildShell(opts.title, finalBody);
  return { html, fenceCount: svgs.length, diagnostics };
}

// ---------------------------------------------------------------------------
// [PDF-PRINT] Pure-Node pdfkit + svg-to-pdfkit pipeline. Produces a real PDF
// with every typeDiagram embedded as true vector paths (no rasterisation).
// ---------------------------------------------------------------------------

const A4_MARGIN = 40;
const SVG_RENDER_WIDTH = 500;

// Split mdWithSvgs into an ordered list of prose and svg chunks so pdfkit can
// emit them sequentially — prose as text, SVGs as vectors.
interface Chunk {
  kind: "prose" | "svg";
  value: string;
}
export function chunkMarkdown(mdWithSvgs: string): Chunk[] {
  const chunks: Chunk[] = [];
  let cursor = 0;
  for (const m of mdWithSvgs.matchAll(SVG_BLOCK_RE)) {
    if (m.index > cursor) {
      chunks.push({ kind: "prose", value: mdWithSvgs.slice(cursor, m.index) });
    }
    chunks.push({ kind: "svg", value: m[0] });
    cursor = m.index + m[0].length;
  }
  if (cursor < mdWithSvgs.length) {
    chunks.push({ kind: "prose", value: mdWithSvgs.slice(cursor) });
  }
  return chunks;
}

function renderProseToPdf(doc: PDFKit.PDFDocument, prose: string): void {
  // Very light markdown → PDF: headings on their own lines, code fences rendered
  // as indented monospace. Full fidelity is NOT a goal — the diagrams are the
  // point; the prose is context.
  const lines = prose.split("\n");
  let inFence = false;
  for (const line of lines) {
    if (/^```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      doc.font("Courier").fontSize(10).text(line);
      continue;
    }
    const hMatch = /^(#{1,6})\s+(.*)$/.exec(line);
    if (hMatch) {
      // Regex groups 1 and 2 are required — both are always present when hMatch is non-null.
      const hashes = hMatch[1] as string;
      const text = hMatch[2] as string;
      const level = hashes.length;
      const size = level === 1 ? 20 : level === 2 ? 16 : level === 3 ? 13 : 11;
      doc.moveDown(0.5);
      doc.font("Helvetica-Bold").fontSize(size).text(text);
      doc.moveDown(0.3);
      continue;
    }
    if (line.trim().length === 0) {
      doc.moveDown(0.5);
      continue;
    }
    doc.font("Helvetica").fontSize(11).text(line);
  }
}

export async function renderToPdf(mdWithSvgs: string, title: string): Promise<Uint8Array> {
  return new Promise<Uint8Array>((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: A4_MARGIN, info: { Title: title } });
    const buffers: Buffer[] = [];
    doc.on("data", (b: Buffer) => buffers.push(b));
    doc.on("end", () => {
      resolve(new Uint8Array(Buffer.concat(buffers)));
    });
    doc.on("error", reject);

    doc.font("Helvetica-Bold").fontSize(22).text(title);
    doc.moveDown();

    for (const chunk of chunkMarkdown(mdWithSvgs)) {
      if (chunk.kind === "prose") {
        renderProseToPdf(doc, chunk.value);
      } else {
        // Vector-embed the SVG. svg-to-pdfkit streams path ops directly.
        doc.moveDown(0.5);
        SVGtoPDF(doc, chunk.value, A4_MARGIN, doc.y, { width: SVG_RENDER_WIDTH, assumePt: false });
        // Advance the cursor past the rendered SVG region. pdfkit doesn't know
        // svg-to-pdfkit drew; we conservatively add a fixed gap then let natural
        // text flow push subsequent content onto a new page if needed.
        doc.moveDown(12);
      }
    }

    doc.end();
  });
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

export async function exportPdf(sourceUri: vscode.Uri, opts: { theme: Theme }, deps: ExportPdfDeps): Promise<void> {
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
    const rendered = renderMarkdownSync(src, { theme: opts.theme });
    const mdWithSvgs = rendered.ok ? rendered.value : src;
    log.info("composed markdown+svgs", {
      ok: rendered.ok,
      diagnostics: rendered.ok ? 0 : rendered.error.length,
      bytes: mdWithSvgs.length,
      elapsedMs: Date.now() - t0,
    });

    const t1 = Date.now();
    const buf = await renderToPdf(mdWithSvgs, title);
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
  // `String.prototype.split` always returns ≥ 1 element, so `parts[last]` is always defined.
  const parts = path.split("/");
  const basename = parts[parts.length - 1] as string;
  return basename.replace(MD_EXT_RE, "");
}

function notifySaved(saved: vscode.Uri, deps: ExportPdfDeps, log: ReturnType<typeof getLogger>): void {
  // Fire-and-forget — the command itself has completed by this point.
  void deps
    .showInformationMessage(`TypeDiagram PDF written: ${saved.path}`, "Open PDF", "Reveal in File Explorer")
    .then(
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
