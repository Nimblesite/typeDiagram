# typeDiagram — Spec

## Context

UML class diagrams are a poor fit for modern data modeling. They drag in OO baggage (visibility, methods, inheritance) and have no honest way to express **tagged unions** — the single most important shape in any non-trivial data model. Mermaid's `classDiagram` inherits the same flaws.

This spec defines `typeDiagram`: a small DSL that describes data types — and only data types — in an **abstract, language-neutral** form. It targets embedded rendering inside markdown (mirroring the mermaid workflow), with a VS Code extension to follow.

## Design principles

1. **Types only.** Fields, no methods. No visibility modifiers. No inheritance.
2. **Unions are first-class.** Sums must be as ergonomic as products.
3. **Language-neutral.** The notation describes the _shape_ of data, not any particular programming language. There are no language flags, no language-specific keywords, no "render as C# / Rust / TS" modes. A `typeDiagram` is the abstract truth; mappings to source languages live outside this spec.
4. **Tight.** If a feature isn't needed to express a type or a relationship, leave it out.

## Language

### Grammar (informal)

```
typeDiagram
  [declaration]*

declaration := type | union | alias

type       := "type" Ident [generics] "{" field* "}"
union      := "union" Ident [generics] "{" variant* "}"
alias      := "alias" Ident [generics] "=" typeRef

generics   := "<" Ident ("," Ident)* ">"
field      := Ident ":" typeRef
variant    := Ident [ "{" field* "}" ]    // payload optional
typeRef    := Ident [ "<" typeRef ("," typeRef)* ">" ]
```

- Indentation is not significant; newlines separate fields/variants. Trailing commas allowed.
- Comments: `# line comment`.
- Identifiers: `[A-Za-z_][A-Za-z0-9_]*`.

### Optionality

There is **no `?` shorthand** and no nullable concept. Optional values are expressed the only way that's true to an abstract data model: as a union.

```
union Option<T> {
  Some { value: T }
  None
}

type User {
  email: Option<Email>
}
```

`Option` is not a built-in. It's just a union the user can declare (or import — see "Imports" below) like any other. The spec does not privilege it, because privileging it would smuggle a language opinion back in.

### Built-in primitives

A small, fixed set of abstract primitives. These exist purely so diagrams can reference common scalars without forcing the author to declare them:

`Bool` `Int` `Float` `String` `Bytes` `Unit`

Anything else (`UUID`, `Email`, `DateTime`, `List<T>`, `Map<K,V>`, `Set<T>`, `Result<T,E>`, …) is just a type the diagram either declares, imports, or references as an external name. The renderer treats unknown names as opaque external types.

### Example — small

```
typeDiagram

  type User {
    id: UUID
    name: String
    email: Option<Email>
    roles: List<Role>
    address: Address
  }

  type Address {
    line1: String
    city: String
    country: CountryCode
  }

  union Shape {
    Circle   { radius: Float }
    Square   { side: Float }
    Triangle { a: Float, b: Float, c: Float }
  }

  union Option<T> {
    Some { value: T }
    None
  }

  alias Email = String
```

### Example — real model (replaces a UML class diagram)

The diagram below is the same model as a real UML class diagram lifted from a chat / tool-call system. The UML version uses stereotypes (`«wire / pydantic»`, `«DTO / dataclass»`, `«enum»`, `«type alias»`, `«adapter»`) to fake what the type system actually wants to say, and writes unions as text inside a class body (`None | scalar | dict[str,str] | list[ContentItem]`). In `typeDiagram` the unions are real:

```
typeDiagram

  type ChatRequest {
    message:      String
    session_id:   String
    tool_results: Option<List<ToolResult>>
  }

  type ChatTurnInput {
    config:       AgentConfig
    user_message: String
    tool_results: Option<List<ToolResult>>
    session_id:   String
  }

  type ToolResult {
    tool_call_id: String
    name:         String
    content:      ToolResultContent
    ok:           Bool
  }

  union ToolResultContent {
    None
    Scalar { value: String }
    Dict   { entries: Map<String, String> }
    List   { items: List<ContentItem> }
  }

  union ContentItem {
    Text   { value: TextPart }
    Uri    { value: UriPart }
    Scalar { value: String }
  }

  type TextPart {
    text: String
  }

  type UriPart {
    url:        String
    kind:       UriKind
    media_type: Option<String>
  }

  union UriKind {
    Image
    Audio
    Video
    Document
    Web
    Api
  }

  union Option<T> {
    Some { value: T }
    None
  }
```

The original diagram also contained a `PydanticAIMapper` "adapter" class with methods like `dto_to_pydantic_ai(ToolResultContent) : ToolReturnContent` and a `URI kind → URL` lookup. Those are **behavior**, not data — out of scope for `typeDiagram` by design. They belong in code or in a separate behavior diagram.

### What's deliberately out

- Methods, constructors, visibility, inheritance, interfaces.
- Nullable shorthand (`?`) — use a union.
- Built-in `Option` / `List` / `Map` / `Result` — declare or import them.
- Constraints (`T: Ord`), default values, annotations.
- Any directive that selects a target language or language-flavored display.

## Visual model

Each declaration is a node:

- **Record** — header with name + generics, list of `field: Type` rows.
- **Union** — header with name + generics, **prominent "one of" subheader** below the header row, list of variants. Unions MUST be visually distinct from records at a glance: variant rows use **dashed dividers** (not solid), each variant is prefixed with a **`|` pipe glyph**, and the header uses a **distinct visual treatment** (e.g. different fill pattern). Variants with payloads render as nested mini-records inside the union node. A viewer must INSTANTLY know whether a box is a record or a union without reading the header text.
- **Alias** — small node: `Email = String`.

Edges:

| Source                       | Target          | Style                                |
| ---------------------------- | --------------- | ------------------------------------ |
| Field references type        | Referenced type | Solid arrow, labeled with field name |
| Union → variant payload type | Payload type    | Solid arrow from variant row         |
| Generic argument             | Type argument   | Thin solid arrow, labeled with param |

Edges only draw when the target is a type declared in the same diagram. References to unknown / external types render inline as text only (no dangling edges).

The renderer has no language modes. Names are drawn exactly as written in the source.

## Architecture — layered framework

`typediagram` is **not** a single `string → svg` function. It is a **layered framework** where every layer is independently importable, replaceable, and useful on its own. Consumers compose only the layers they need: a codegen tool stops at the model layer; a custom renderer (canvas, React, PNG) replaces the SVG layer; a tree-sitter port replaces the parser layer. The top-level package exports a thin sugar API that composes all layers, but it adds no capability the layers don't already have.

Browser and Node share **identical code paths** in every layer (no conditional imports, no DOM shim, no jsdom).

| Layer               | Input → Output                                              | Module                                                  |
| ------------------- | ----------------------------------------------------------- | ------------------------------------------------------- |
| **1. Parser**       | `string` → `Token[]`, `Diagram` AST, `Diagnostic[]`         | `typediagram-core/parser`                               |
| **2. Model**        | AST → resolved `Model` (decls + edges + diagnostics)        | `typediagram-core/model`                                |
| **3. Layout**       | `Model` → `LaidOutGraph` (geometry only, renderer-agnostic) | `typediagram-core/layout`                               |
| **4. Render**       | `LaidOutGraph` → SVG string / `SVGElement`                  | `typediagram-core/render-svg`                           |
| **5. Integrations** | source / markdown → rendered output                         | `typediagram-core` (sugar), `typediagram-core/markdown` |

### Source layout

````
packages/typediagram/
  src/
    parser/
      lexer.ts           # token stream with {line, col, offset}
      parser.ts          # recursive-descent → AST
      ast.ts             # AST node types (importable without invoking parser)
      diagnostics.ts
      index.ts           # layer barrel
    model/
      types.ts           # Model, ResolvedDecl, Edge
      build.ts           # AST → Model
      index.ts
    layout/
      measure.ts         # monospace char-width text measurement
      types.ts           # LaidOutGraph, NodeBox, EdgeRoute
      elk.ts             # Model → LaidOutGraph via elkjs
      index.ts
    render-svg/
      svg-tag.ts         # tagged template + attribute escaping
      theme.ts           # light/dark theme tokens
      render.ts          # LaidOutGraph → SVG string
      index.ts
    integrations/
      markdown.ts        # ```typeDiagram fence → SVG
    index.ts             # sugar API composing layers
    markdown.ts          # re-export of integrations/markdown
  test/
````

### Public API per layer

All fallible operations return `Result<T, Diagnostic[]>` — the framework **never throws** for expected failures (parse errors, validation errors, layout failures). Throwing is reserved for genuine bugs (programmer errors, contract violations). This makes the framework safe to embed in long-running hosts (LSP servers, VS Code extensions) without try/catch noise at every call site.

```ts
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };
```

**Layer 1 — `typediagram-core/parser`**

```ts
export function tokenize(source: string): Result<Token[], Diagnostic[]>;
export function parse(source: string): Result<Diagram, Diagnostic[]>;
// Variants that always return both AST and diagnostics (for IDE use cases that want partial trees + warnings):
export function tokenizePartial(source: string): { tokens: Token[]; diagnostics: Diagnostic[] };
export function parsePartial(source: string): { ast: Diagram; diagnostics: Diagnostic[] };
export type { Token, TokenKind, Diagnostic, Diagram, RecordDecl, UnionDecl, AliasDecl, Field, Variant, TypeRef };
```

**Layer 2 — `typediagram-core/model`** _(canonical programmatic form — the framework's machine-facing core)_

```ts
// From AST (parser path)
export function buildModel(ast: Diagram): Result<Model, Diagnostic[]>;
export function buildModelPartial(ast: Diagram): { model: Model; diagnostics: Diagnostic[] };

// Direct programmatic construction (no source code required)
export function record(name: string, fields: FieldSpec[], generics?: string[]): RecordDecl;
export function union(name: string, variants: VariantSpec[], generics?: string[]): UnionDecl;
export function alias(name: string, target: TypeRef, generics?: string[]): AliasDecl;
export function ref(name: string, args?: TypeRef[]): TypeRef;

export class ModelBuilder {
  add(decl: RecordDecl | UnionDecl | AliasDecl): this;
  build(): { model: Model; diagnostics: Diagnostic[] };
}

// Validation (independent of parser)
export function validate(model: Model): Diagnostic[];

// Round-trip
export function toJSON(model: Model): unknown; // stable, versioned
export function fromJSON(json: unknown): Result<Model, Diagnostic[]>;
export function printSource(model: Model): string; // Model → typeDiagram DSL text

export type { Model, ResolvedDecl, Edge, EdgeKind, ResolvedRef, FieldSpec, VariantSpec };
```

This layer is the **canonical machine-readable core** of the framework. Every other layer is built on it. Importers (JSON Schema → Model, OpenAPI → Model, Protobuf → Model, Pydantic → Model, TS reflection → Model) all target this layer; they never have to emit source text and re-parse it. Exporters do the inverse: codegen tools consume a `Model` directly; `printSource` exists for the case where DSL text is the desired output. The JSON form is stable and versioned so a Model can cross process boundaries (CI build pipelines, LSP, VS Code webview ↔ extension host).

**Layer 3 — `typediagram-core/layout`**

```ts
export function layout(model: Model, opts?: LayoutOpts): Promise<Result<LaidOutGraph, Diagnostic[]>>;
export function measureText(text: string, fontSize: number): { w: number; h: number };
export type { LaidOutGraph, NodeBox, EdgeRoute, LayoutOpts };
```

**Layer 4 — `typediagram-core/render-svg`**

```ts
export function renderSvg(graph: LaidOutGraph, opts?: SvgOpts): string;
export type { SvgOpts, Theme };
```

**Layer 5 — sugar (`typediagram-core`)**

```ts
export function renderToString(source: string, opts?: AllOpts): Promise<Result<string, Diagnostic[]>>;
export function render(source: string, opts?: AllOpts): Promise<Result<SVGElement, Diagnostic[]>>; // browser
// plus re-exports of every layer's barrel
export * as parser from "typediagram-core/parser";
export * as model from "typediagram-core/model";
export * as layout from "typediagram-core/layout";
export * as renderSvg from "typediagram-core/render-svg";
export type { Result } from "typediagram-core";
```

**Layer 5 — markdown (`typediagram-core/markdown`)**

```ts
export function renderMarkdown(md: string, opts?: AllOpts): Promise<Result<string, Diagnostic[]>>;
```

### Why layered

- **Replaceability.** Swap any layer without touching the others. Renderer alternatives (canvas, React, Mermaid-compat) only need to consume `LaidOutGraph`. Parser alternatives (tree-sitter for editor incremental reparse) only need to produce a `Diagram` AST.
- **Embeddability.** A VS Code extension (eventual `.vsix` target) imports `parser` for diagnostics and `render-svg` in the webview — never the markdown sugar. Static-site generators import `markdown`. No layer drags in capability the consumer didn't ask for.
- **Testability.** Each layer has its own test file with its own contract.
- **No language coupling.** No layer branches on a language name; the renderer treats all type names as opaque strings.

## First-party consumer apps

Two reference apps ship in the same monorepo. Both are **pure consumers** of the framework — they do not duplicate any framework logic. They exist to (a) prove the layered API is complete enough to build real things on, and (b) serve as the integration smoke-test surface for both runtime targets.

### `packages/cli` — CLI

Headless Node binary. Validates the framework works without a DOM and is composable in build pipelines / docs builds / CI.

```
typediagram input.td > output.svg
typediagram --theme dark < input.td
```

Pipeline: `read(file|stdin) → parse → renderToString → write(stdout)`. Errors go to stderr in the framework's diagnostic format, with non-zero exit code. Flags: `--theme light|dark`, `--font-size N`.

### `packages/web` — Web playground

Browser bundle. Validates the framework works in the same kind of environment a VS Code webview will use (the future `.vsix` target reuses this app's renderer wiring).

A simple split-pane editor: textarea on the left (typeDiagram source), live SVG preview on the right. On every (debounced) input change: `parse → renderToString → set preview.innerHTML`. Parse errors render as a formatted diagnostic list inside the preview pane.

No framework logic lives in this app — only DOM glue. The app is the simplest possible end-to-end smoke test for the browser code path.

### Future: `packages/vscode` (Phase 2+)

A `.vsix` extension that combines:

- The parser layer in the extension host (Node) for diagnostics, hover, go-to-def via LSP.
- The render layer in the webview (browser) for live preview.
- A TextMate grammar for syntax highlighting.

Reuses the web playground's renderer wiring directly.

### Parser — hand-written recursive descent in TypeScript

The grammar is ~6 productions, LL(1), no left recursion, no precedence. A parser generator (Chevrotain ~150KB, Lezer ~40KB + tables, Langium drags in the LSP stack) is overkill and adds bundle weight that markdown integrators will complain about — Mermaid's bundle size is already a known pain point and we will not repeat it.

Hand-written wins on every axis here: ~300 lines of TS, zero deps, tree-shakes to nothing, and we control every `expect()` call so error messages can name exactly what was expected and where. The lexer tags every token with `{line, col, offset}` and the parser threads a `Diagnostic[]` through. No build step, no generated artifacts.

### Layout — elkjs (`@aetlas/elkjs` / `elkjs`), `layered` algorithm

Dagre is effectively abandoned (last meaningful release 2020; `dagre-d3` archived) and only knows node-center anchors. Our nodes are tall — unions with multiple payload-bearing variants, each an edge source that needs to attach at the **right row** — so we need port-aware orthogonal routing. ELK gives us exactly that:

```
elk.layered.nodePlacement.strategy = NETWORK_SIMPLEX
elk.edgeRouting                    = ORTHOGONAL
elk.direction                      = RIGHT
```

ELK is ~2MB minified. Acceptable for a docs-build tool; in the browser bundle we lazy-load it the same way Mermaid lazy-loads its diagram modules. Critically, **elkjs runs in Node with zero DOM dependency** — that's the decisive factor for static markdown rendering at build time.

### SVG — hand-written strings via tagged template

No d3, no snap, no virtual DOM. We're generating, not mutating; reactivity buys nothing. A tiny `svg\`...\`` helper that escapes attribute values, ~300 lines for the whole renderer. Identical output in browser and Node. (This is what nomnoml and D2 do.)

### Text measurement — monospace + char-width table (no jsdom, ever)

Text measurement is the usual reason diagram tools are forced to depend on jsdom. We sidestep the entire problem by rendering all text in a monospace stack (`ui-monospace, Menlo, Consolas, monospace`) and computing widths as `charCount * charWidthEm * fontSize`, with a small width table for wide chars (CJK, emoji ≈ 1.0em vs ASCII ≈ 0.6em). Accuracy within 2–3px; node padding absorbs the rest.

This is the same trick Graphviz uses for `-Tsvg` without a display. It is the single decision that lets us ship one code path for browser + Node with no DOM polyfill.

### Pipeline

`parse(src) → AST → resolve refs → build ELK graph (with pre-computed node dimensions from char counts) → elk.layout() → walk result, emit SVG strings`. Same path in both runtimes.

### VS Code extension (Phase 3)

VS Code syntax highlighting cannot be driven by our JS parser — VS Code tokenizes on every keystroke in a worker and requires either a TextMate grammar (regex JSON) or a tree-sitter grammar. For ~6 productions a TextMate grammar is ~80 lines of JSON: keywords (`type|union|alias`), identifiers, generics brackets, punctuation. We ship that for syntax highlighting, and back hover / go-to-def with a small LSP server that reuses our existing TS parser's AST.

Tree-sitter is **only** considered if/when LSP performance demands incremental reparse. Not for MVP, not for Phase 3. Likely never needed at this grammar size.

## Roadmap

1. **MVP** — spec, hand-written TS parser, model, ELK layout + SVG string renderer with monospace measurement, snapshot tests against both examples above.
2. Markdown integration helper (`renderMarkdown(md)` that swaps ```typeDiagram fences for SVG).
3. VS Code extension: TextMate grammar (highlighting), preview pane, LSP backed by our TS parser (hover, diagnostics, go-to-def).
4. Live preview in markdown (mirror mermaid's VS Code experience).
5. **PDF export with embedded vector diagrams.** Right-click a `.md` file in the explorer or editor title → generates `<basename>.pdf` next to the source, with every ` ```typediagram ` fence rendered as a vector SVG inside the PDF. Uses VS Code's bundled Electron via `webview.printToPDF`; no new runtime binaries. Full spec: [pdf-export.md](./pdf-export.md).

## Verification

- `parse()` produces a model from the small example with: 2 records, 2 unions (one generic), 1 alias, correct generics, `email: Option<Email>` resolved as a reference to the `Option` union. Diagnostics carry `{line, col}`.
- `parse()` on the chat-model example produces 5 records + 4 unions, with `ToolResultContent.List.items` resolving to `List<ContentItem>` and `ContentItem` resolving correctly.
- `renderToString()` produces SVG containing every type name, every field, and exactly the expected edges (record→record, union variant→payload, generic-arg). Edges enter union nodes at the correct **variant row**, not the union header — verifies ELK port routing is wired up.
- Identical SVG output in browser and Node for the same input (byte-for-byte).
- No code path in the renderer branches on a language name. No `jsdom` in `package.json`. No `dagre` in `package.json`.
- Open the rendered SVG in a browser; nodes don't overlap, edges are orthogonal and hit node borders.
- Snapshot tests for both example diagrams lock the SVG output.
