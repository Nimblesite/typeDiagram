# typediagram-core

**Type-safe diagrams and source code from one schema.** Parse a tiny DSL (records, tagged unions, aliases) into a model, then generate SVG diagrams and round-trip types for TypeScript, Python, Rust, Go, C#, and F#.

**Live demo:** [typediagram.dev](https://typediagram.dev)

![TypeDiagram VS Code extension with live SVG preview](https://typediagram.dev/vscode-screenshot.png)

## Install

```sh
npm install typediagram-core
```

## Quick start

```ts
import { parse, layout, renderSvg } from "typediagram-core";

const source = `
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
`;

const model = parse(source);
const laid = await layout(model);
const svg = renderSvg(laid);
```

## The DSL

Three constructs:

- `type` — records
- `union` — tagged sum types
- `alias` — newtypes

Generics with `<T>`. Comments with `#`.

## Subpath exports

- `typediagram-core` — high-level `parse`, `layout`, `renderSvg`
- `typediagram-core/parser` — parser only
- `typediagram-core/model` — model types
- `typediagram-core/layout` — layout engine
- `typediagram-core/render-svg` — SVG renderer
- `typediagram-core/markdown` — markdown integration

## Related packages

- [`typediagram`](https://www.npmjs.com/package/typediagram) — CLI binary
- TypeDiagram VS Code extension — syntax highlighting + live preview (search "TypeDiagram" by nimblesite on the Marketplace)

## Links

- Docs: [typediagram.dev/docs](https://typediagram.dev/docs/)
- Source: [github.com/Nimblesite/typeDiagram](https://github.com/Nimblesite/typeDiagram)

MIT © [Nimblesite](https://nimblesite.co)
