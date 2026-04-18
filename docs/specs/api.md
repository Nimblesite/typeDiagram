# Node.js API

The `typediagram-core` npm package exposes a layered API. Each layer is independently importable.

## Quick start

```ts
import { renderToString } from "typediagram-core";

const source = `
  type User { name: String, email: Option<Email> }
  union Option<T> { Some { value: T }, None }
  alias Email = String
`;

const result = await renderToString(source);
if (result.ok) {
  console.log(result.value); // full <svg> string
}
```

## Sugar API (top-level)

```ts
import { renderToString, render, parser } from "typediagram-core";
```

### `renderToString(source, opts?)`

Parse, layout, and render to an SVG string. Returns `Result<string, Diagnostic[]>`.

```ts
const result = await renderToString(source, {
  theme: "dark", // "light" | "dark"
  fontSize: 14, // px
  padding: 16, // outer padding
});
```

### `render(source, opts?)`

Browser-only. Same as `renderToString` but returns an `SVGElement` via `DOMParser`. Returns `Result<SVGElement, Diagnostic[]>`.

### Render hooks

`SvgOpts` accepts an optional `hooks` field — a typed, phase-based extension point for customising the rendered SVG:

```ts
import { renderToString, svg, raw, type RenderHooks } from "typediagram-core";

const hooks: RenderHooks = {
  defs: () => svg`<filter id="drop"><feDropShadow dx="1" dy="2" stdDeviation="2"/></filter>`,
  background: (ctx) => svg`<rect width="${ctx.width}" height="${ctx.height}" fill="#fafafa"/>`,
  node: (ctx, def) => svg`<g filter="url(#drop)" data-name="${ctx.node.declName}">${def}</g>`,
  row: (ctx, def) =>
    ctx.row.text.startsWith("id:")
      ? svg`${def}<rect x="${ctx.x}" y="${ctx.y}" width="3" height="${ctx.height}" fill="#ffd400"/>`
      : undefined,
  edge: (ctx, def) => (ctx.dashArray !== undefined ? def : undefined),
  post: (ctx) => svg`${ctx.svg}<style>.td-union { cursor: pointer; }</style>`,
};

await renderToString(source, { hooks });
```

**Six phases** (each optional, called in this order):

| Phase        | Input                                | Output                                        | Typical use                                         |
| ------------ | ------------------------------------ | --------------------------------------------- | --------------------------------------------------- |
| `defs`       | `DefsCtx`                            | `SafeSvg \| undefined` (appended to `<defs>`) | Gradients, filters, patterns, markers               |
| `background` | `BackgroundCtx` (width, height)      | `SafeSvg \| undefined` (drawn under nodes)    | Grid, watermark, full-bleed fill                    |
| `node`       | `NodeCtx`, `defaultSvg: SafeSvg`     | `SafeSvg \| undefined`                        | Wrap or replace the default node group              |
| `row`        | `RowCtx`, `defaultSvg: SafeSvg`      | `SafeSvg \| undefined`                        | Per-field colour accents, icons, overlays           |
| `edge`       | `EdgeCtx`, `defaultSvg: SafeSvg`     | `SafeSvg \| undefined`                        | Custom arrowheads, labels, dashed overrides         |
| `post`       | `PostCtx` (includes whole `SafeSvg`) | `SafeSvg`                                     | Wrap the document, inject `<style>`, add root `<g>` |

Contexts carry absolute geometry (padding already added), the resolved theme, and the full `LaidOutGraph` for cross-referencing. Hooks return **`SafeSvg`**, produced via the tagged template literals ` svg`…` ` and `raw(…)` — plain strings fail the type check. See [render-hooks spec](https://github.com/Nimblesite/typeDiagram/blob/main/docs/specs/render-hooks.md) for the full context type definitions.

**Rules**:

- Hooks must be **pure** — no mutation of inputs, no retained state, no I/O. Same graph + same hooks = byte-identical SVG.
- A hook that throws does NOT crash the render; the error is logged via `pino` and that phase falls back to the default output.
- Return `undefined` from any transform hook to mean "use the default for this item".
- Hooks are a single object, not an array. To compose, capture the previous hook and chain: `const prev = hooks.node; hooks.node = (ctx, def) => { const base = prev?.(ctx, def) ?? def; return svg`<g>${base}</g>`; };`

## Result type

Every API returns `Result<T, E>` instead of throwing:

```ts
import { type Result, ok, err, isOk, isErr, map, andThen, unwrap } from "typediagram-core";

const result = await renderToString(source);
if (result.ok) {
  console.log(result.value);
} else {
  console.error(result.error); // Diagnostic[]
}
```

## Layer 1: Parser

```ts
import { parser } from "typediagram-core";

const result = parser.parse(source);
// Result<Diagram, Diagnostic[]>

// Partial parse (for IDE/LSP — returns both AST and diagnostics)
const { diagram, diagnostics } = parser.parsePartial(source);

// Format diagnostics for display
const text = parser.formatDiagnostics(diagnostics);
// "  3:12  error   expected '{', got Ident "User""
```

## Layer 2: Model

```ts
import { model } from "typediagram-core";

// From AST
const m = model.buildModel(ast);
// Result<Model, Diagnostic[]>

// Programmatic construction
const builder = new model.ModelBuilder();
builder.add(
  model.record("User", [
    { name: "name", type: model.ref("String") },
    { name: "email", type: model.ref("Option", [model.ref("Email")]) },
  ])
);
builder.add(model.alias("Email", model.ref("String")));
const result = builder.build();

// Model → typeDiagram DSL source
const source = model.printSource(result.value);

// Model → JSON (stable versioned schema)
const json = model.toJSON(result.value);
const restored = model.fromJSON(json);
```

## Layer 3: Layout

```ts
import { layoutLayer } from "typediagram-core";

const result = await layoutLayer.layout(model);
// Result<LaidOutGraph, Diagnostic[]>
// LaidOutGraph has: nodes (NodeBox[]), edges (EdgeRoute[]), width, height
```

## Layer 4: SVG Renderer

```ts
import { renderSvgLayer } from "typediagram-core";

const svg = renderSvgLayer.renderSvg(laidOutGraph, {
  theme: "light",
  fontSize: 13,
  padding: 16,
});
// Returns a full <svg xmlns="...">...</svg> string
```

## Converters

```ts
import { converters } from "typediagram-core";

// Parse other languages
const model = converters.typescript.fromSource(tsCode);
const model = converters.python.fromSource(pyCode);
const model = converters.rust.fromSource(rsCode);
const model = converters.go.fromSource(goCode);
const model = converters.csharp.fromSource(csCode);

// Emit other languages
const tsCode = converters.typescript.toSource(model);
const pyCode = converters.python.toSource(model);
const rsCode = converters.rust.toSource(model);
const goCode = converters.go.toSource(model);
const csCode = converters.csharp.toSource(model);
```

## Diagnostic type

```ts
interface Diagnostic {
  severity: "error" | "warning";
  message: string;
  line: number;
  col: number;
  length: number;
}
```
