# Getting Started

typeDiagram is a tiny, language-neutral DSL for diagramming **records**, **tagged unions**, and **generics**. Write plain text, get auto-laid-out SVG diagrams.

## Quick start

### Web playground

The fastest way to try typeDiagram is the [web playground](/#playground). Type on the left, see your diagram on the right — updates instantly.

### VS Code extension

Install the `.vsix` for syntax highlighting of `.td` files:

```sh
make vsix-install
```

This gives you keyword highlighting, bracket matching, and comment support in VS Code.

### CLI

Install and run from the command line:

```sh
# From typeDiagram source
echo 'type User { name: String }' | typediagram > diagram.svg

# From a file
typediagram schema.td > diagram.svg

# From existing TypeScript/Python/Rust/Go/C# code
typediagram --from typescript types.ts > diagram.svg
```

## Your first diagram

Create a file called `schema.td`:

```
typeDiagram

type User {
  id:    UUID
  name:  String
  email: Option<Email>
}

union Option<T> {
  Some { value: T }
  None
}

alias Email = String
```

Render it:

```sh
typediagram schema.td > diagram.svg
open diagram.svg
```

You'll see three connected boxes: `User` links to `Option<T>` (via the `email` field) and to `Email` (via the generic argument). The layout is automatic — orthogonal edges, no overlapping nodes.

## What's in the box

| Tool                  | What it does                                                                                             |
| --------------------- | -------------------------------------------------------------------------------------------------------- |
| **Web playground**    | Browser-based editor with syntax highlighting, live preview, pan/zoom, and a Hooks tab with live presets |
| **CLI**               | `typediagram` binary — pipe source in, SVG out                                                           |
| **VS Code extension** | Live `.td` preview, markdown preview rendering, **Export to PDF** with vector diagrams                   |
| **Converters**        | Bidirectional: TypeScript, Python, Rust, Go, C# ↔ typeDiagram                                            |
| **Node.js API**       | `renderToString()`, `parse()`, converter APIs, **render hooks** for SVG customisation                    |

## Markdown → PDF (VS Code)

Author docs in markdown with ` ```typediagram ` fenced blocks, then **right-click → Export to PDF with typeDiagrams**. The generated PDF embeds every diagram as inline SVG paths — no screenshots, no raster fallbacks. Zoom the PDF and the edges stay sharp.

- Command: `typediagram.exportMarkdownPdf`
- Setting: `typediagram.pdfExport.theme` (`light` / `dark`)
- The PDF lands next to the source `.md` file; existing PDFs are overwritten silently.

See [Node.js API](/docs/api.html#render-hooks) for programmatic rendering inside your own documentation pipelines.

## Customising the SVG — render hooks

The renderer exposes a typed, phase-based hook API. Inject `<defs>` (gradients, filters, patterns), decorate the default node/row/edge output, paint a background layer, or wrap the whole document — without forking the renderer.

```ts
import { renderToString, svg } from "typediagram-core";

await renderToString(source, {
  hooks: {
    defs: () => svg`<filter id="glow"><feGaussianBlur stdDeviation="2"/></filter>`,
    node: (ctx, def) => (ctx.isUnion ? svg`<g filter="url(#glow)">${def}</g>` : undefined),
  },
});
```

Try it without leaving the browser: the [playground](/#playground) has a **Hooks** tab with preset chips (`shadow`, `grid`, `field color`, `union glow`, `css classes`). Each chip pastes real JavaScript into an editor you can hand-edit — presets aren't a black box; they're example code.
