# Spec — Markdown-to-PDF Export with Embedded typeDiagrams

**ID prefix:** `[PDF]` (all ID references in code/tests use `[PDF-*]` so `grep [PDF-` finds spec↔code↔tests.)

## Context

Users author documentation in markdown files containing ` ```typediagram ` fenced code blocks. They need a one-click way to produce a **PDF** of the markdown document with all typeDiagram fences rendered as **vector images** — not rasterised screenshots, not flattened bitmaps, not placeholder code.

The sync render path already exists (`renderToStringSync` in `typediagram-core`). The VS Code preview integration exists. What's missing is a command that:

1. Reads a `.md` file.
2. Resolves every typeDiagram fence to inline SVG.
3. Produces a printable HTML document.
4. Renders that HTML to PDF with the SVGs preserved as vector paths.
5. Prompts the user for a save location and writes the PDF.

This spec pins down the exact pipeline, the dependency footprint, and the verification contract.

## Design principles

1. **Reuse, don't duplicate.** The fence → SVG replacement is `renderMarkdownSync` from `typediagram-core`. The PDF command composes that with a markdown-to-HTML step and a webview-based print step. Zero parsing, layout, or render logic lives in the VS Code package.
2. **No new runtime binaries.** The extension must NOT ship or download Chromium, `puppeteer`, `playwright`, or `wkhtmltopdf`. VS Code is already an Electron app — we use the Electron that ships with VS Code via the built-in webview API.
3. **SVGs stay vector.** The produced PDF must embed each diagram as a vector element; zooming the PDF must never show pixels. No `<img src="data:image/png">` fallback, no canvas rasterisation.
4. **Deterministic output.** Same markdown + same version of typeDiagram = byte-identical PDF (modulo the PDF's own timestamp metadata). Tests assert this.
5. **Black-box testable.** The command must be reachable via `vscode.commands.executeCommand('typediagram.exportMarkdownPdf', uri)`; the non-trivial parts are unit-testable against a mock webview.

## Dependencies

| Dependency         | Kind    | New?                                                | Role                                                                          |
| ------------------ | ------- | --------------------------------------------------- | ----------------------------------------------------------------------------- |
| `vscode`           | runtime | no                                                  | `WebviewPanel` + `webview.printToPDF` (stable since VS Code 1.76)             |
| `typediagram-core` | runtime | no                                                  | `renderMarkdownSync` produces fence-replaced markdown (prose + inline SVG)    |
| `markdown-it`      | runtime | **yes — move from devDependencies to dependencies** | Convert non-fence markdown (headings, paragraphs, lists, inline code) to HTML |

**Explicitly NOT added:**

- Chromium / puppeteer / playwright / wkhtmltopdf — VS Code already ships Electron.
- `highlight.js` / `prismjs` — out of scope; non-typediagram code blocks render as plain `<pre><code>`.
- `markdown-it-anchor` / any plugin — out of scope.

## Command surface

### `typediagram.exportMarkdownPdf`

- **Registered in:** `packages/vscode/src/extension.ts` via `vscode.commands.registerCommand`.
- **Argument:** optional `vscode.Uri`. If omitted, falls back to `vscode.window.activeTextEditor.document.uri`.
- **Valid when:** `resourceLangId == markdown`. No-op otherwise.
- **UI surfaces:**
  - Explorer context menu on `.md` files (`menus.explorer/context`, group `navigation@2`, label `"Export to PDF with typeDiagrams"`).
  - Editor title context menu (`menus.editor/title/context`, same label) for the active markdown file.
  - Command Palette (`menus.commandPalette`, filtered by `resourceLangId == markdown`).
- **Flow:** read file → `renderMarkdownSync` → wrap in HTML shell → render to PDF in hidden webview → write buffer to `<markdown-basename>.pdf` **next to the source** (overwriting any existing file with that name) → `showInformationMessage` with "Open PDF" / "Reveal in Finder/Explorer" buttons. **No save dialog. No prompts. Just generate and write.**

### Settings

Single config key (added to the existing `configuration.properties` block in `package.json`):

- `typediagram.pdfExport.theme` — `"light" | "dark"` (default `"light"`). Passed through to `renderMarkdownSync` so diagrams use the same theme family as the printed page. (The page background is always white regardless of theme — PDFs are for printing.)

No page-size/margin settings in MVP. Use `@page { size: A4; margin: 20mm }` in the HTML shell.

## Architecture

Four steps, each a pure function where possible. IDs are the source of truth — code and tests reference them.

### `[PDF-READ]` Read markdown source

`readMarkdown(uri: vscode.Uri): Promise<string>` — reads the file via `vscode.workspace.fs.readFile` + `TextDecoder`. No VS Code editor document required; must work from the explorer on a file that isn't open.

### `[PDF-COMPOSE]` Compose the printable HTML

`composeHtml(mdSource: string, opts: { theme: "light" | "dark" }): Result<string, Diagnostic[]>`

1. Run `renderMarkdownSync(mdSource, { theme })` from `typediagram-core` → markdown with every ` ```typediagram ` fence replaced by inline `<svg>...`.
2. Run `markdown-it`'s `render()` on the result. **Crucial:** markdown-it must NOT re-escape the inline SVG. We do this by replacing SVGs with opaque sentinel tokens before markdown-it runs, then substituting them back into the rendered HTML. Sentinels use Unicode private-use-area brackets (`\uE000TDSVG${i}\uE001`) so they can't collide with real user content and can't be misinterpreted as HTML, markdown, or URL content by any renderer. This preserves the inline SVG as literal HTML in the output.
3. Wrap the HTML fragment in a shell (see `[PDF-SHELL]`).
4. If `renderMarkdownSync` returned diagnostics for any fence, they're in the Result's error list; the composed HTML still ships with the failed fences rendered as `<!-- typediagram error ... -->` comments (consistent with the async path).

### `[PDF-SHELL]` HTML shell

A tiny static HTML template:

- `<!DOCTYPE html><html><head>` with `<meta charset="utf-8">`, `<title>` (markdown basename), `<style>` containing ~30 LOC of CSS (body font, `@page`, code-block styling, `.typediagram svg { max-width: 100%; height: auto }`).
- `<body>` contains the rendered markdown HTML directly.

No external resources (CDN fonts, external CSS). Self-contained. Works offline.

### `[PDF-PRINT]` Render to PDF

`renderHtmlToPdf(html: string): Promise<Uint8Array>`

1. Create a hidden `vscode.window.createWebviewPanel` with `retainContextWhenHidden: true`, `enableScripts: false`, in a non-visible view column (or immediately `.dispose()`'d after capture).
2. Set `panel.webview.html = html`.
3. Await the webview's content-load event (a dispatched `message` from a tiny inline script that fires `window.onload`).
4. Call `panel.webview.printToPDF({ ... })` and await the buffer.
5. Dispose the panel.

**Fallback:** if `webview.printToPDF` is unavailable in the runtime (e.g. a future VS Code Web variant without Electron), the command surfaces a `Diagnostic` error and aborts with a user-visible message. No silent degradation.

### `[PDF-SAVE]` Write next to source

`writeNextToSource(buf: Uint8Array, sourceUri: vscode.Uri): Promise<vscode.Uri>` — computes the sibling URI by replacing `.md` with `.pdf` (case-insensitive on the extension), writes via `vscode.workspace.fs.writeFile`, returns the written URI. **No save dialog. No user questions. Overwrites existing PDF silently.** If the source filename doesn't end in `.md`/`.markdown`, appends `.pdf`.

## Verification

A task is done when ALL of the following pass:

### `[PDF-READ]`

- Reads a `.md` file from disk that is not currently open in an editor.
- Rejects (returns Result.err) on unreadable / nonexistent URIs with a Diagnostic carrying the path.

### `[PDF-COMPOSE]`

- On a markdown doc with 0 typeDiagram fences, output HTML contains every heading, paragraph, and code fence exactly once, in order.
- On a markdown doc with N typeDiagram fences (N ≥ 1), output HTML contains exactly N `<svg` substrings and zero ` ```typediagram ` substrings.
- Inline SVG is NOT html-escaped. `<svg xmlns="http://www.w3.org/2000/svg"` appears literally, not as `&lt;svg...`.
- Sentinel replacement is reversible: the text "TD-SVG-" does NOT leak into the final HTML.
- `composeHtml(src, { theme: "dark" })` ≠ `composeHtml(src, { theme: "light" })` when `src` contains at least one typeDiagram fence.
- Diagnostics from bad fences surface in the Result; HTML still renders with error comments.

### `[PDF-SHELL]`

- Shell is fully self-contained: no `<link rel="stylesheet" href="http">`, no `<script src="http">`, no `@import url(http`.
- `@page` rule present with A4 size and 20mm margin.
- Body font resolves without external font files (system stack).

### `[PDF-PRINT]`

- `renderHtmlToPdf` returns a `Uint8Array` whose first 5 bytes are `%PDF-` (0x25 0x50 0x44 0x46 0x2D).
- The PDF buffer is non-trivial (> 1 KB for any non-empty document).
- Vector preservation: when the input HTML contains `<svg>`, the resulting PDF (decoded as text) contains at least one of: `/Type /Pattern` stream, `re` (rectangle) / `m` + `l` (moveto/lineto) path operators, or an embedded `/Subtype /Form`. NO `/Subtype /Image` with a raster stream for the diagram regions.
- Disposes the webview panel after capture; no leaked panels.

### `[PDF-SAVE]`

- **Never calls `showSaveDialog`.** Test asserts that `vscode.window.showSaveDialog` is NEVER invoked during the command flow.
- Writes `<basename>.pdf` sibling to the source `.md` file via a single `workspace.fs.writeFile` call; first 5 bytes are `%PDF-`.
- Overwrites any existing PDF at that path without prompting.
- For `foo.md` → `foo.pdf`. For `foo.MARKDOWN` → `foo.pdf`. For `notes.txt` → `notes.txt.pdf`.
- A post-save notification offers "Open PDF" and "Reveal in File Explorer" actions (non-blocking; command returns before these are clicked).

### Integration (black-box)

- Invoking `vscode.commands.executeCommand('typediagram.exportMarkdownPdf', uri)` on [`packages/vscode/examples/doc.md`](../../packages/vscode/examples/doc.md) produces a PDF whose byte size is within ±10% of a golden snapshot (seed PDF checked in, regenerated when the golden changes intentionally).
- The generated PDF can be opened by `open` (macOS), `xdg-open` (Linux), `start` (Windows) — we assert it's readable by reading back the first 1024 bytes.
- All existing markdown-preview behaviour (fence highlighting, live preview rendering) continues to work — no regressions.

### Logging

Every step logs via the existing `Logger` infrastructure (Output Channel `TypeDiagram` + JSONL file). Log entries:

- `info` `"export-pdf invoked"` with `{ uri }`.
- `info` `"composed HTML"` with `{ fenceCount, htmlLength, elapsedMs }`.
- `info` `"rendered PDF"` with `{ bufferLength, elapsedMs }`.
- `info` `"saved PDF"` with `{ savedUri }` or `"user cancelled save"`.
- `error` `"export-pdf failed"` with `{ stage, err }` on any failure, before aborting.

All log lines must appear in the JSONL log file; tests assert this.

## Non-goals

- **Printing non-typeDiagram code blocks with syntax highlighting.** Out of scope; renders as plain `<pre><code>`.
- **TOC, page numbers, headers/footers.** Out of scope; can ship later as CSS additions.
- **Multi-file export / book mode.** Single file in, single file out.
- **Export from the preview pane.** MVP is explorer / editor context menu. A "share" button in the preview is a possible follow-up.
- **Web VS Code support.** The `printToPDF` API is Electron-only. We document and skip on non-Electron hosts.

## Roadmap placement

Inserts into `docs/specs/spec.md` §Roadmap between items 3 and 4 as a new Phase: **"PDF export with embedded vector diagrams."** Depends on the markdown preview plugin already landed.
