# Plan — Markdown-to-PDF Export with Embedded typeDiagrams

Spec: [docs/specs/pdf-export.md](../specs/pdf-export.md).

## Summary

Add `typediagram.exportMarkdownPdf` command to the VS Code extension. Right-click a `.md` file → generate `<basename>.pdf` next to it, with every typeDiagram fence embedded as a vector SVG inside the PDF. No save dialog, no prompts — just generate and write.

## Key decisions (from spec, copied here so this plan is self-contained)

| Concern             | Decision                                                                                   | Why                                                                                                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PDF engine          | VS Code's bundled Electron via `webview.printToPDF`                                        | Zero new runtime binaries. Chromium preserves inline SVG as vector paths in the output PDF. Used by `shd101wyy.markdown-preview-enhanced` and similar extensions.           |
| Markdown → HTML     | `markdown-it` (already a devDep; promote to `dependencies`)                                | We already ship it for the preview plugin tests. ~90 KB, pure JS, zero transitive deps. Alternatives (`marked`, `remark`) add more weight for no gain at our feature scope. |
| Fence → SVG         | Reuse `renderMarkdownSync` from `typediagram-core`                                         | Already exists, already tested, already case-insensitive. Zero duplication.                                                                                                 |
| SVG-in-HTML safety  | Replace SVGs with sentinels `<!--TD-SVG-${i}-->` before markdown-it, substitute back after | markdown-it html-escapes inline HTML by default unless `html: true`. Sentinel swap is safer than trusting the `html` flag — we control what gets through.                   |
| User prompts        | NONE. Write `<basename>.pdf` next to the source, overwrite silently                        | User directive: "just fucking generate it". No `showSaveDialog`, no overwrite confirmations.                                                                                |
| Page size / margins | Hard-coded A4, 20mm all-around, in the HTML shell's `@page` rule                           | MVP. Config added later only if users ask.                                                                                                                                  |
| Theme               | Single setting: `typediagram.pdfExport.theme` = light \| dark (default light)              | Passes through to `renderMarkdownSync`. Page background is always white — PDFs are for printing.                                                                            |
| Non-goals           | Syntax highlighting for non-TD code blocks, TOC, page numbers, multi-file, Web VS Code     | Each adds scope. Defer.                                                                                                                                                     |

## Dependencies to add

- **`markdown-it`** — move from `devDependencies` to `dependencies` in `packages/vscode/package.json`. No version bump. Must also bundle it into `dist/extension.js` via esbuild (already does this since the preview plugin uses it at test time; need to verify it's pulled into the extension bundle for runtime use too).

No other runtime deps.

## Critical files

### New

```
packages/vscode/
  src/
    export-pdf.ts           # [PDF-*] Command handler: compose HTML, print to PDF, write next to source.
  test/
    export-pdf.test.ts      # [PDF-*] Unit tests: readMarkdown, composeHtml, sentinel round-trip,
                            # writeNextToSource path logic, mocked printToPDF returns %PDF- buffer.
    export-pdf-e2e.test.ts  # [PDF-E2E] Black-box: invoke the command via executeCommand against
                            # examples/doc.md, assert PDF is written next to source, assert first
                            # 5 bytes are %PDF-, assert buffer size > 1 KB, assert vector markers
                            # present in PDF stream.
```

### Modified

```
packages/vscode/
  src/
    extension.ts            # Register typediagram.exportMarkdownPdf command in activate().
                            # Route to export-pdf.ts. Add to subscriptions.
  package.json              # Promote markdown-it to dependencies.
                            # Add command contribution: typediagram.exportMarkdownPdf.
                            # Add menus:
                            #   explorer/context when resourceLangId == markdown (or .md ext)
                            #   editor/title/context when resourceLangId == markdown
                            #   commandPalette when resourceLangId == markdown
                            # Add configuration: typediagram.pdfExport.theme.
  test/vscode-mock.ts       # Add mockPrintToPDF spy on webview panel.
                            # Add workspace.fs { readFile, writeFile } spies.
                            # Add window.showInformationMessage spy.
docs/specs/spec.md          # Already updated: roadmap item 5 links to pdf-export spec.
```

## Architecture — how the pieces fit

Command handler in `export-pdf.ts` is one ~80 LOC exported function that composes four pure (or near-pure) helpers, each with its own spec ID so tests map 1:1 to code:

```
typediagram.exportMarkdownPdf(uri)
  └─ exportPdf(uri, deps)
     ├─ [PDF-READ]    readMarkdown(uri)            → string
     ├─ [PDF-COMPOSE] composeHtml(src, { theme })   → Result<string, Diagnostic[]>
     │   └─ (inside) renderMarkdownSync + sentinel swap + markdown-it.render
     ├─ [PDF-PRINT]   renderHtmlToPdf(html)         → Promise<Uint8Array>
     └─ [PDF-SAVE]    writeNextToSource(buf, uri)   → Promise<vscode.Uri>
```

`deps` is a struct of the vscode-surface functions the handler uses — `readFile`, `writeFile`, `createWebviewPanel`, `showInformationMessage`. The test harness passes mocks; real code passes the real `vscode` namespace. This makes the top-level command trivially unit-testable without mocking the whole `vscode` module.

Logging via the existing `Logger`: every stage entry + exit + elapsedMs.

## Sequencing

Strict order. Each step ends with its tests passing before moving on — per CLAUDE.md `make test` enforces this.

### Phase A — Composition pipeline (pure, no vscode API)

Write the stage that has no vscode dependency first. Max unit-testability, fastest feedback.

1. Create `src/export-pdf.ts` with `composeHtml(src, opts)` only.
2. Write `test/export-pdf.test.ts` with `[PDF-COMPOSE]` assertions from spec.
3. Run `make test` — typediagram-vscode coverage must stay ≥ threshold.

### Phase B — Webview print wrapper

4. Add `renderHtmlToPdf(html, deps)` using `deps.createWebviewPanel` + `panel.webview.printToPDF`.
5. Extend `test/vscode-mock.ts` with a `printToPDF` spy that returns a fake `%PDF-1.7\n...` buffer sized > 1 KB.
6. Unit test `renderHtmlToPdf`: asserts `printToPDF` called once, panel disposed, returned buffer starts with `%PDF-`.

### Phase C — Save + command glue

7. `readMarkdown`, `writeNextToSource`, and the top-level `exportPdf` composer.
8. Unit tests for each `[PDF-READ]`, `[PDF-SAVE]`, and the composer (mocking all four stages).
9. Assertion that `showSaveDialog` is NEVER called (per user directive + spec `[PDF-SAVE]`).

### Phase D — Command registration + menus

10. Register `typediagram.exportMarkdownPdf` in `activate()`. Add menu contributions in `package.json`.
11. Extension activation test: command is registered, subscriptions grow by 1.
12. Run `make lint` + `make test` — all green.

### Phase E — E2E (real `renderMarkdownSync`, real `printToPDF` mocked)

13. `test/export-pdf-e2e.test.ts`: invoke the command against `examples/doc.md` with the real core sync renderer, mocked `printToPDF`. Assert:
    - Log lines appear in the JSONL file in order.
    - Composed HTML contains inline SVG (not html-escaped).
    - `writeFile` called with URI == `doc.pdf` sibling of `doc.md`.
    - Notification shown with "Open PDF" / "Reveal" actions.

### Phase F — Real-Electron E2E (opt-in, TYPEDIAGRAM_E2E_ELECTRON=1)

14. Add a test case to the existing electron harness (`test/electron/suite/`) that:
    - Opens `examples/doc.md`.
    - Invokes the command.
    - Waits for the PDF to appear at `examples/doc.pdf`.
    - Asserts first 5 bytes are `%PDF-` and buffer > 1 KB.
    - Asserts vector-marker heuristic (`/Pattern` or path operators) is present in the PDF bytes.
    - Cleans up the PDF.

Skipped on darwin-arm64 for the same reason the existing electron tests are skipped there.

### Phase G — Docs + finalise

15. Update `packages/vscode/README.md` with the new command.
16. Run `make ci` one last time — format, lint, test, build, bundle-size all green.
17. Coverage ratcheted via `scripts/ratchet-coverage.mjs`.

## Risk register

| Risk                                                               | Mitigation                                                                                                                                                                        |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `webview.printToPDF` doesn't exist on older VS Codes / Web VS Code | Feature-detect at runtime; show error notification with version hint, log and abort. Engines in `package.json` already requires 1.75+; raise to 1.76+ (which ships `printToPDF`). |
| markdown-it escapes our inline SVG                                 | Sentinel swap strategy (see spec `[PDF-COMPOSE]`). Tests assert the string `TD-SVG-` does NOT leak into output.                                                                   |
| SVG not preserved as vector in PDF (rasterised)                    | Test `[PDF-PRINT]` decodes PDF bytes and asserts vector-op markers. If it fails, investigate Electron print options (`printSelectionOnly`, `preferCSSPageSize`, `scale`).         |
| Bundle size regression                                             | `make bundle-size` already enforced. markdown-it is ~90KB; acceptable.                                                                                                            |
| Two commands on the same file fire concurrently                    | Command handler captures a per-uri lock in module scope; second invocation waits for first to finish. Logged `warn` "export-pdf already in progress for URI".                     |
| Extension bundle doesn't include markdown-it at runtime            | esbuild must bundle it. Verify by grepping bundled `dist/extension.js` for the `markdown-it` module preamble. Add to VSIX-package.test.ts.                                        |

## TODO (execution checklist)

Check items off as each lands with its tests passing.

### Spec alignment

- [ ] Spec file exists: [docs/specs/pdf-export.md](../specs/pdf-export.md). ✅ committed.
- [ ] Roadmap updated in [docs/specs/spec.md](../specs/spec.md) with item 5 linking to pdf-export spec. ✅ committed.

### Phase A — Composition pipeline (pure functions, no vscode API)

- [ ] **`[PDF-READ]` `readMarkdown(uri, { readFile })`** — reads via injected `readFile`, decodes UTF-8, returns string. Rejects on nonexistent path.
- [ ] **`[PDF-COMPOSE]` sentinel swap** — `extractSvgs(md)` → `{ skeleton, svgs[] }`. Replaces every `<svg ...>...</svg>` block with `<!--TD-SVG-${i}-->`.
- [ ] **`[PDF-COMPOSE]` re-injection** — `reinjectSvgs(html, svgs)` substitutes sentinels back.
- [ ] **`[PDF-COMPOSE]` `composeHtml(src, { theme })`** — calls `renderMarkdownSync` → sentinel swap → `md.render` → re-inject → wrap in shell.
- [ ] **`[PDF-SHELL]`** — `buildShell(title, bodyHtml)` returns self-contained HTML with `@page A4` and 20mm margin. No external refs.
- [ ] **Tests — `[PDF-COMPOSE]`** — markdown with 0 fences passes through; with N fences, exactly N `<svg`, zero ` `typediagram ```, no html-escaped SVG, no sentinel leak, light ≠ dark output, diagnostics surface for bad fences.
- [ ] **Tests — `[PDF-SHELL]`** — no external URLs, `@page` present, system font stack present.

### Phase B — Webview print wrapper

- [ ] **`[PDF-PRINT]` `renderHtmlToPdf(html, { createWebviewPanel })`** — creates hidden panel, sets html, awaits load message, calls `printToPDF`, disposes.
- [ ] **Mock printToPDF** — extend `test/vscode-mock.ts` with `mockWebviewPrintToPdf` returning `Buffer.from("%PDF-1.7\n" + "x".repeat(2048))`.
- [ ] **Test — `[PDF-PRINT]`** — returned buffer starts with `%PDF-`, length > 1024, `createWebviewPanel` called once, `dispose` called.
- [ ] **Test — `[PDF-PRINT]` load handshake** — if the webview never signals loaded, the promise rejects after a 10s timeout (don't hang the command indefinitely).
- [ ] **Test — `[PDF-PRINT]` fallback** — if `printToPDF` isn't a function (older VS Code), returns Result.err with a clear message.

### Phase C — Save and top-level composer

- [ ] **`[PDF-SAVE]` `writeNextToSource(buf, sourceUri, { writeFile })`** — sibling path with `.md`/`.markdown` → `.pdf`; else appends `.pdf`.
- [ ] **Test — `[PDF-SAVE]` path mapping** — `foo.md` → `foo.pdf`, `foo.MARKDOWN` → `foo.pdf`, `notes.txt` → `notes.txt.pdf`, subfolder URIs preserved.
- [ ] **Test — `[PDF-SAVE]` NEVER calls showSaveDialog** — hard assertion `expect(window.showSaveDialog).not.toHaveBeenCalled()`.
- [ ] **Test — `[PDF-SAVE]` overwrites silently** — `writeFile` called even when the sibling already exists; no confirmation asked.
- [ ] **`exportPdf(uri, deps)`** — composes all four stages; logs at each transition; emits user notification on success with Open/Reveal actions.
- [ ] **Per-uri lock** — concurrent invocation on the same URI waits for the first to finish; logged `warn`.
- [ ] **Test — composer happy path** — readFile returns markdown, composeHtml → renderHtmlToPdf → writeFile → notification. Order asserted via logger capture.
- [ ] **Test — composer error propagation** — any stage's Result.err surfaces as `showErrorMessage` + `error` log entry.

### Phase D — Command registration + menus

- [ ] **`activate()` registers `typediagram.exportMarkdownPdf`** — wired to `exportPdf(uri, realDeps)`. Added to `context.subscriptions`.
- [ ] **`package.json`** — command contribution, explorer/context menu, editor/title/context menu, commandPalette filter.
- [ ] **`package.json`** — configuration `typediagram.pdfExport.theme` (enum light/dark, default light).
- [ ] **`package.json`** — promote `markdown-it` to `dependencies`.
- [ ] **Test — registration** — `commands.registerCommand` called with `"typediagram.exportMarkdownPdf"`; subscriptions length bumped by 1.
- [ ] **Test — activation log entry** — `"extension activating"` log line references the new command count.

### Phase E — Unit E2E (real core, mocked print)

- [ ] **Test — against `examples/doc.md`** — real `renderMarkdownSync`, mocked `printToPDF`. Composed HTML has 1 inline `<svg>`; `writeFile` called with `doc.pdf` URI; notification shown.
- [ ] **Test — log order** — JSONL log contains `export-pdf invoked` → `composed HTML` → `rendered PDF` → `saved PDF` in order.

### Phase F — Electron E2E (opt-in)

- [ ] **`test/electron/suite/export-pdf.spec.cjs`** — opens `examples/doc.md`, invokes command, polls for `examples/doc.pdf`, asserts `%PDF-` + size > 1024 + vector markers. Cleans up. Skipped on darwin-arm64.
- [ ] **Test — bundled markdown-it** — VSIX-package.test.ts asserts `dist/extension.js` contains the markdown-it module (grep for a stable string from markdown-it's preamble).

### Phase G — Docs + finalise

- [ ] **`packages/vscode/README.md`** — new section documenting the export command + context menu entry + default output location.
- [ ] **`make ci`** — format, lint, test, build, bundle-size all green.
- [ ] **Coverage ratchet** — `scripts/ratchet-coverage.mjs` bumps vscode package thresholds upward.
- [ ] **Manual smoke** — right-click `examples/doc.md` in the real VS Code → confirm `doc.pdf` appears next to source with the ChatRequest/ToolResult diagram as a zoomable vector.
