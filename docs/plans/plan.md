# typeDiagram — Plan

The full spec lives in [/Users/christianfindlay/Documents/Code/type_model/spec.md](../../Documents/Code/type_model/spec.md). This plan file summarizes the implementation calls and the verification gates.

## Context

UML class diagrams are wrong-shape for modern data modeling — they bake in OO baggage and have no honest way to express tagged unions. This project ships `typeDiagram`: a tiny, language-neutral DSL for records + unions + generics (no methods, no language flags), rendering to SVG. It targets markdown embedding (mermaid-style) with a VS Code extension to follow.

## Decisions (researched, not optional)

| Concern       | Decision                                                                                                 | Why                                                                                                                                                                           |
| ------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Parser        | Hand-written recursive descent in TS                                                                     | Grammar is ~6 productions, LL(1). Generators (Chevrotain ~150KB, Lezer ~40KB+tables, Langium) waste bundle weight. Hand-written gives best error messages and zero deps.      |
| Parser tokens | Lexer tags every token with `{line, col, offset}`; parser threads `Diagnostic[]`                         | LSP later reuses the same AST.                                                                                                                                                |
| Layout        | `elkjs`, `layered` algorithm, `NETWORK_SIMPLEX` placement, `ORTHOGONAL` routing, `RIGHT` direction       | Dagre is abandoned + only knows node-center anchors. Union nodes are tall with multiple variant rows that each need port-aware edge attachment. ELK runs in Node with no DOM. |
| SVG output    | Hand-written strings via `svg\`...\`` tagged template                                                    | We're generating not mutating; d3/snap/vdom buys nothing. Same as nomnoml/D2.                                                                                                 |
| Text measure  | Monospace stack + char-width table (`charCount * charWidthEm * fontSize`); wide-char table for CJK/emoji | The single decision that avoids jsdom and keeps browser + Node on one code path. Same trick as Graphviz `-Tsvg`.                                                              |
| VS Code       | TextMate grammar for highlighting (~80 lines JSON) + LSP backed by our TS parser                         | VS Code tokenizes per-keystroke and requires TextMate or tree-sitter; our JS parser cannot drive it. Tree-sitter only if LSP perf later demands it.                           |
| Banned deps   | `jsdom`, `dagre`, `d3`                                                                                   | Verified by absence in `package.json` as a CI check.                                                                                                                          |

## Layered framework architecture

Each layer is independently importable. A consumer can stop at any layer and supply their own implementation downstream. Example: a codegen tool uses Layer 2; a tree-sitter port uses Layer 1; a custom renderer (canvas, React, Mermaid-compat) uses Layer 3 and writes its own Layer 4. We ship a default Layer 4 (SVG) and Layer 5 (markdown helper, sugar APIs) — but they are optional.

| Layer          | Input           | Output                                            | Module                                        |
| -------------- | --------------- | ------------------------------------------------- | --------------------------------------------- |
| 1 Parser       | `string`        | `Token[]`, `Diagram` (AST), `Diagnostic[]`        | `typediagram/parser`                          |
| 2 Model        | AST             | `Model` (resolved decls, edges)                   | `typediagram/model`                           |
| 3 Layout       | Model           | `LaidOutGraph` (geometry only, renderer-agnostic) | `typediagram/layout`                          |
| 4 Render       | LaidOutGraph    | `string` (SVG) or `SVGElement`                    | `typediagram/render-svg`                      |
| 5 Integrations | source/markdown | rendered output                                   | `typediagram` (sugar), `typediagram/markdown` |

## Critical files (to be created)

````
src/typediagram/
  src/
    parser/
      lexer.ts          # token stream
      parser.ts         # recursive-descent → AST
      diagnostics.ts
      ast.ts            # AST node types (separate so layers above can import without parser)
      index.ts          # parser layer barrel
    model/
      types.ts          # Model + edge types
      build.ts          # AST → Model
      index.ts          # model layer barrel
    layout/
      measure.ts        # monospace text width (renderer-agnostic)
      types.ts          # LaidOutGraph + geometry types
      elk.ts            # Model → LaidOutGraph via elkjs
      index.ts          # layout layer barrel
    render-svg/
      svg-tag.ts        # tagged template + escaping
      theme.ts          # theme tokens
      render.ts         # LaidOutGraph → SVG string
      index.ts          # render layer barrel
    integrations/
      markdown.ts       # ```typeDiagram fence → SVG
    index.ts            # sugar: parse(), renderToString(), render() that compose layers
    markdown.ts         # re-export of integrations/markdown
  test/
    parser.test.ts
    model.test.ts
    layout.test.ts
    render.test.ts
    integration.test.ts # snapshot SVG for both examples
    markdown.test.ts
  package.json
  README.md
````

Each layer's `index.ts` is its public surface. The top-level `src/index.ts` only re-exports sugar + the per-layer barrels — it never adds capability that the layer itself doesn't have.

## Public API

```ts
export function parse(source: string): Diagram;
export function renderToString(d: Diagram, opts?: RenderOpts): Promise<string>;
export function render(d: Diagram, opts?: RenderOpts): Promise<SVGElement>; // browser only
export interface RenderOpts {
  theme?: "light" | "dark";
  fontSize?: number;
}
```

## Implementation order

1. Lexer + parser + AST + diagnostics, tested against both examples in spec.md.
2. Semantic model: resolve type references (declared in diagram vs. external), normalize generics.
3. `measure.ts`: monospace width helper.
4. `layout.ts`: build ELK graph with **per-row ports** on union nodes (so edges land on the variant row, not the header). Pre-compute node dimensions from `measure.ts` before calling `elk.layout()`.
5. `svg.ts`: walk laid-out graph, emit SVG via tagged template. Render record/union/alias node templates; render orthogonal edges with arrowheads and field-name labels.
6. Snapshot tests on both examples.

## Verification

- `parse()` round-trips the small example: 2 records, 2 unions (one generic), 1 alias, `email: Option<Email>` resolves to the `Option` union. Diagnostics carry `{line, col}`.
- `parse()` on the chat-model example: 5 records + 4 unions; `ToolResultContent.List.items` resolves to `List<ContentItem>` and `ContentItem` resolves correctly.
- `renderToString()` SVG contains every type name + every field; edges into union nodes attach at the correct **variant row** (proves ELK port routing is wired).
- Byte-for-byte identical SVG output in browser and Node for the same input.
- No code path branches on a language name. No `jsdom` / `dagre` / `d3` in `package.json`.
- Manual: open rendered SVG in a browser — nodes don't overlap, edges orthogonal, arrowheads land on node borders.
- Snapshot tests lock both example SVGs.

## TODO

### 0. Project scaffold

- [x] `npm init` at `src/typediagram/`; set `"type": "module"`, `"main"`, `"types"`, `"exports"` (`.` and `./markdown`).
- [x] Install: `typescript`, `vitest`, `@types/node`. Runtime dep: `elkjs` only. Dev-time only: nothing else.
- [x] `tsconfig.json`: `strict`, `target: ES2022`, `module: ESNext`, `moduleResolution: bundler`, `declaration: true`.
- [x] `vitest.config.ts` with snapshot dir `test/__snapshots__/`.
- [x] CI guard script `scripts/check-banned-deps.mjs`: fails if `jsdom` / `dagre` / `d3` appear in `package.json` or lockfile.
- [x] `.gitignore`, `LICENSE`, empty `README.md` placeholder.

### 1. Lexer (`src/parser/lexer.ts`)

- [x] `Token` type: `{ kind, value, line, col, offset, length }`.
- [x] `TokenKind`: `Type | Union | Alias | Ident | LBrace | RBrace | LAngle | RAngle | Comma | Colon | Equals | Newline | EOF`.
- [x] Skip whitespace, skip `# line comments`, track line/col precisely (handle `\r\n` and `\n`).
- [x] Recognize keywords (`type`, `union`, `alias`) as distinct kinds, not `Ident`.
- [x] Identifier rule: `[A-Za-z_][A-Za-z0-9_]*`.
- [x] Reject unexpected chars with a `Diagnostic` instead of throwing.
- [x] Unit tests: each token kind, position tracking across multi-line input, comments, CRLF.

### 2. Diagnostics (`src/parser/diagnostics.ts`)

- [x] `Diagnostic` type: `{ severity: "error" | "warning", message, line, col, length }`.
- [x] `DiagnosticBag` collector with `error()` / `warning()` helpers.
- [x] Pretty-printer: ` 7:12  error  expected '{', got Ident "User"`.

### 3. Parser (`src/parser/parser.ts`)

- [x] AST node types: `Diagram`, `RecordDecl`, `UnionDecl`, `AliasDecl`, `Field`, `Variant`, `TypeRef`, `Generics`. Every node carries a `span`.
- [x] `parseDiagram()` consumes optional leading `typeDiagram` header then `parseDeclaration*`.
- [x] `parseDeclaration()` dispatches on keyword.
- [x] `parseRecord()`, `parseUnion()`, `parseAlias()`, `parseField()`, `parseVariant()`, `parseTypeRef()`, `parseGenerics()`.
- [x] `expect(kind)` helper: emits diagnostic + recovers by skipping to next newline / closing brace.
- [x] Trailing-comma + newline-as-separator handling inside `{ ... }` blocks.
- [x] Public `parse(source) → Result<Diagram, Diagnostic[]>` + `parsePartial` for IDE use cases.
- [x] Tests: both examples from spec.md parse cleanly; bad-input fixtures produce diagnostics with correct `{line, col}`.

### 4. Semantic model (`src/model/`) — canonical machine-readable core

This layer is the framework's programmatic API. Importers (JSON Schema, OpenAPI, Protobuf, Pydantic, TS reflection) target this layer directly; they must never have to round-trip through DSL text.

- [x] `types.ts`: `Model`, `ResolvedDecl` (RecordDecl | UnionDecl | AliasDecl), `ResolvedRef` (`Declared | Primitive | TypeParam | External`), `Edge { sourceDeclId, sourceRowIndex, targetDeclId, label, kind }`.
- [x] `build.ts`: `buildModel(ast): Result<Model, Diagnostic[]>` + `buildModelPartial`. Resolve refs, dedup-detect, generic-arity-check, build edge list.
- [x] `builder.ts`: programmatic constructors `record()`, `union()`, `alias()`, `ref()` and `ModelBuilder` class. Pure data, no parsing.
- [x] `validate.ts`: `validate(model): Diagnostic[]` — runs duplicate + arity checks on a hand-built Model.
- [x] `json.ts`: `toJSON(model)` / `fromJSON(json)` — stable versioned schema (`{ version: 1, decls: [...] }`). Round-trip tested.
- [x] `print.ts`: `printSource(model): string` — Model → typeDiagram DSL; round-trips through the parser.
- [x] `index.ts`: layer barrel exporting all of the above.
- [x] Tests (18 passing):
  - [x] small + chat-model examples produce expected decl counts (small: 2 records, 2 unions, 1 alias; chat: 5 records, 4 unions).
  - [x] `ToolResultContent.List.items` resolves to `List<ContentItem>`; `ContentItem` resolves declared.
  - [x] Programmatic build: construct via `ModelBuilder`, assert resolution + edges correct.
  - [x] JSON round-trip: `fromJSON(toJSON(m))` deep-equals `m` for both examples.
  - [x] Source round-trip: `parse(printSource(m))` deep-equals `m`.
  - [x] `validate()` flags duplicate decls and generic-arity mismatches on hand-built Models.

### 5. Text measurement (`src/layout/measure.ts`)

- [x] `CHAR_WIDTH_EM = 0.6` for ASCII; wide-char table (CJK Unified Ideographs, Hiragana, Katakana, Hangul, common emoji ranges) → `1.0`.
- [x] `measureText(text, fontSize): { w, h }` returns pixel size; `measureBlock` for multi-line.
- [x] Tests: ASCII width matches `chars * 0.6 * fontSize`; mixed CJK string sums correctly.

### 6. Layout (`src/layout/elk.ts`)

- [x] Build ELK graph from `Model`:
  - One ELK node per decl, dimensions pre-computed via `measure`.
  - Per-row source ports (EAST) + header target port (WEST) so edges attach at the correct row.
  - ELK options: `algorithm: layered`, `direction: RIGHT`, `nodePlacement.strategy: NETWORK_SIMPLEX`, `edgeRouting: ORTHOGONAL`, `portConstraints: FIXED_SIDE`.
- [x] `await elk.layout(graph)` returns laid-out graph; project to renderer-agnostic `LaidOutGraph` (NodeBox + EdgeRoute).
- [x] Tests (8 passing): non-overlapping bounding boxes; every edge has ≥2 points; edge from union node attaches inside the node's vertical bounds (proves port routing wired up).

### 7. SVG renderer (`src/render-svg/`)

- [x] `svg-tag.ts`: tagged template with attribute escaping (`"` `<` `>` `&` `'`); separate text-escape helper.
- [x] Node templates: unified `renderNode` covering record / union / alias with kind-coloured accent strip on the left edge.
- [x] **[RENDER-UNION-ONEOF] Union nodes MUST be visually distinct from records.** Unions now have:
  - Distinct header fill (`unionHeaderFill` theme token: light `#f3eefa`, dark `#2d2640`).
  - Prominent **"ONE OF"** badge below the header (italic, centered, union accent color).
  - Dashed dividers between variant rows (`stroke-dasharray="4 3"`).
  - Diamond glyph (`◇`) prefix on each variant row.
  - 16px extra layout space for the badge via `UNION_BADGE_H` in both `elk.ts` and `render.ts`.
- [x] Edge renderer: orthogonal polyline from layout points, `<marker>` arrowhead def, label at midpoint, dashed for genericArg.
- [x] Theme tokens (`light` | `dark`): full Theme interface with bg/node/header/edge/accent fields.
- [x] `renderSvg(graph, opts)` returns full `<svg xmlns=...>` string. Pure function — works in browser and Node.
- [x] Browser `render()` lives in sugar layer (`src/index.ts`) — parses SVG string via DOMParser into SVGElement.

### 8. Public API (`src/index.ts`) — sugar layer

- [x] Export `parse`, `renderToString`, `render`, all option types.
- [x] All async APIs return `Result<T, Diagnostic[]>` — never throw on expected failures.
- [x] Re-export per-layer barrels (`parser`, `model`, `layoutLayer`, `renderSvgLayer`) so consumers can drop down a layer at any point.
- [x] Re-export `Result` helpers (`ok`, `err`, `isOk`, `isErr`, `map`, `mapErr`, `andThen`, `andThenAsync`, `unwrap`).
- [x] Browser `render()` falls back to a clear error if `DOMParser` is missing instead of crashing.

### 9. Markdown helper (`src/markdown.ts`)

- [x] `renderMarkdown(md: string): Promise<string>` — find ` ```typeDiagram ` fences, replace with rendered SVG inline.
- [x] Leave non-`typeDiagram` fences untouched.
- [x] Tests: a markdown fixture with one fence renders; multiple fences in one doc all render.

### 10. Snapshot tests (`test/render.test.ts`)

- [x] Snapshot SVG for the small example.
- [x] Snapshot SVG for the chat-model example.
- [x] Run snapshot test in **both** node and a browser-like env (vitest `environment: happy-dom` for the second run); assert byte-equality between runs. Achieved via shared `run-scenarios.ts` running identical 16-scenario suite in CLI (Node) and web (happy-dom); snapshots byte-identical.

### 11. CI / quality gates

- [x] GitHub Actions: install, `npm run check-banned-deps`, `tsc --noEmit`, `vitest run`. Matrix on Node 20/22.
- [x] Bundle-size budget check (esbuild-based `scripts/bundle-size.mjs`): fail if main bundle > 50KB excluding `elkjs`. Currently 23.54 KB.

### 12. Documentation

- [x] `README.md`: trimmed user-facing version of spec.md (grammar, both examples, install, basic usage).
- [x] One screenshot of the chat-model example rendered. (`docs/design/chat-model-example.svg`)

### 13. CLI app (`src/cli/`)

Validates the framework works headless in Node. Pure consumer of the layered API — does not duplicate any framework logic.

- [x] `src/cli/package.json` with `"bin": { "typediagram": "./dist/cli.js" }`. Depend on `typediagram` via workspace.
- [x] `src/cli.ts`: read `argv[2]` (file path) or stdin → call `typediagram` `parse` + `renderToString` → write SVG to stdout, errors to stderr with exit code 1.
- [x] Flag: `--theme light|dark` (default light), `--font-size N`.
- [x] Test: pipe both spec examples through the CLI → SVG starts with `<svg`. Plus 16 shared snapshot scenarios.
- [x] Test: parse error fixture → stderr contains formatted diagnostic, exit code 1.
- [x] Public-API smoke test: imports all subpath exports (`typediagram/parser`, `typediagram/model`, etc.) and verifies resolution.

### 14. Web playground (`src/web/`)

Validates the framework works in a browser bundle (the same environment a VS Code webview will use).

- [x] `src/web/package.json`. Use `vite` for dev/build. Depend on `typediagram` via workspace.
- [x] `index.html` with a split-pane layout: textarea (editor) on left, `<div id="preview">` on right.
- [x] `src/main.ts`: on textarea input (debounced), `parse(src)` → if ok, `renderToString` → set `preview.innerHTML`; if err, render the formatted diagnostic list in the preview pane.
- [x] No framework logic in the web app — only glue.
- [x] Bundle inspected for size; framework + ELK lazy-loaded chunk separate from app chunk (2.54KB shell + 1.45MB framework).
- [x] Manual smoke: load page, paste each spec example, see live diagram. Verified via Playwright.

### 15. Result type (`src/result.ts`) — added during build (originally missed)

The original plan said "throw on parse error, expose .diagnostics". User direction changed mid-build to **never throw for expected failures**. Added a real Result module so this is consistent across every layer.

- [x] `Result<T, E>` discriminated union; constructors `ok` / `err`; predicates `isOk` / `isErr`; combinators `map` / `mapErr` / `andThen` / `andThenAsync`; escape hatch `unwrap`.
- [x] Every layer's public API returns `Result<…, Diagnostic[]>`; `*Partial` variants kept for IDE/LSP use cases that want both the partial output and diagnostics together.
- [x] Re-exported from top-level package so consumers don't need a separate import.

### 16. Snapshot tests (originally Section 11; folded into §7 work)

- [x] Snapshot SVG for the small example.
- [x] Snapshot SVG for the chat-model example.
- [x] Run snapshot test in **both** node and a browser-like env (vitest `environment: happy-dom`); assert byte-equality between runs. Shared 16-scenario suite via `run-scenarios.ts`.

### 17. Things originally missed — must add before MVP ships

- [x] **Workspace root setup.** Top-level `package.json` with `"workspaces": ["src/*"]`, top-level lockfile, top-level scripts.
- [x] **AST → typeRef span fidelity.** TypeRef interface carries full `span: Span` with line, col, offset, length.
- [x] **Cycle detection in resolution.** `[EDGE-CYCLE]` tests in `edge-cases.test.ts`: self-ref types parse, build model, render without crash.
- [x] **Self-referential edges.** Same test suite confirms self-loop edges (e.g. `Tree → Tree`). ELK routes them.
- [x] **Empty diagram.** `[EDGE-EMPTY]` tests: `parse("")` and `parse("typeDiagram\n")` produce valid empty Model and empty SVG (no NaN).
- [x] **Single-node diagram.** `[EDGE-SINGLE]` tests: single record, union, alias all layout/render without crash.
- [x] **Long type names.** `[EDGE-LONGNAME]` tests + shared snapshot scenario: 200-char field/type names don't blow up.
- [x] **Comments preserved as a token kind?** Decision: drop (current). Comments stripped during lex, not preserved. LSP folding ranges will need revisiting.
- [x] **Trailing-newline tolerance.** `[EDGE-TRAILING]` tests: no trailing newline, multiple trailing newlines, CRLF all parse cleanly.
- [x] **Position info on Diagnostic from validate/json/builder paths.** Diagnostics carry line/col/length; spans at AST level.
- [x] **Public-API smoke test.** `src/cli/test/public-api-smoke.test.ts` imports from `"typediagram"` package name — 8 tests covering all subpath exports.
- [x] **`exports` map verification.** `package.json` has subpaths for `./parser`, `./model`, `./layout`, `./render-svg`, `./markdown`. Smoke test verifies resolution.
- [x] **Markdown integration (Section 9).** Fully implemented in `src/integrations/markdown.ts` with tests.
- [x] **CI workflow.** `.github/workflows/ci.yml`: matrix Node 20/22, check-banned-deps, typecheck, test, bundle-size.
- [x] **Bundle size budget.** `scripts/bundle-size.mjs` via esbuild: fail if > 50KB excl. elkjs. Currently 23.54 KB.
- [x] **Stable edge IDs.** Content-based `${sourceDeclName}:${sourceRowIndex}:${targetDeclName}:${kind}` in `elk.ts`.

### 18. VS Code syntax highlighting (`src/vscode/`)

- [x] TextMate grammar (`src/vscode/syntaxes/typediagram.tmLanguage.json`): keywords (`type|union|alias|typeDiagram`), PascalCase type names, field names before `:`, builtins (`Bool|Int|Float|String|Bytes|Unit|List|Map|Option`), `#` comments, punctuation.
- [x] Language configuration: bracket matching, auto-close `{}` `<>`, `#` line comments, indentation rules.
- [x] Extension manifest: `.td` and `.typediagram` file extensions.
- [x] Grammar test: 16/16 tokenization assertions pass via `vscode-textmate` + `vscode-oniguruma`.

### 19. Web playground UX (`src/web/`)

- [x] **Preview zoom.** SVG preview supports scroll-wheel zoom. Preserve center point on zoom. (`src/viewport.ts`, 12 tests)
- [x] **Preview pan.** Click-drag to pan the SVG preview. Cursor changes to grab/grabbing. (`src/viewport.ts`)
- [x] **Vertical splitter.** Draggable splitter dividing editor (left) and preview (right). Persists position to `localStorage`. (`src/splitter.ts`, 8 tests)
- [x] **Syntax highlighting.** Regex-based highlighter mirroring the TextMate grammar. Overlay technique: transparent textarea over highlighted `<pre>`. (`src/highlight.ts`, 17 tests)
- [x] **Editor zoom.** Ctrl+scroll-wheel zooms the editor font size. Persists to `localStorage`. (`src/editor-zoom.ts`, 10 tests)
- [x] **Editor pan.** Editor pane scrolls naturally (textarea native scroll).
- [x] **Export to SVG button.** Button (`⤓`) in the zoom controls toolbar downloads the current diagram as `diagram.svg`. Uses `XMLSerializer` + `Blob` + anchor click. Available in both playground and converter pages.

### 20. Bidirectional language converters (`src/converters/`)

- [x] **Converter interface.** `Converter { fromSource(src) → Result<Model>, toSource(model) → string }`. (`converters/types.ts`)
- [x] **TypeScript.** `interface` → record, `type X = A | B` → union, `type X = Y` → alias. Emits `export interface`, discriminated unions with `kind` field. (`converters/typescript.ts`)
- [x] **Python.** `@dataclass` → record, `Enum` → union, TypedDict → record. Emits `@dataclass`, `str, Enum`, type aliases. (`converters/python.ts`)
- [x] **Rust.** `struct` → record, `enum` → union (struct/tuple/unit variants), `type` → alias. Emits `pub struct`, `pub enum`, `pub type`. (`converters/rust.ts`)
- [x] **Go.** `struct` → record, `interface` → union, `type X = Y` → alias. Emits `type X struct`, `type X interface` + marker method, variant structs. (`converters/go.ts`)
- [x] **Shared helpers.** `parseTypeRef` / `printTypeRef` for parsing generic type strings. (`converters/parse-typeref.ts`)
- [x] **37 converter tests** covering fromSource, toSource, round-trips, error cases, edge cases (generics, tuple variants, map fields, TypedDict).

### Phase 2+ (not MVP, leave as TODO stubs)

- [ ] VS Code extension: preview pane (re-uses the web playground's renderer code), LSP wired to existing TS parser.
- [ ] Tree-sitter port — only if LSP perf demands it.
- [ ] Additional converters: Kotlin, Swift, C#, Protobuf, JSON Schema, OpenAPI.
