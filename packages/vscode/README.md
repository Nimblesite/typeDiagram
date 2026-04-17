# TypeDiagram for VS Code

**Type-safe diagrams and source code from one schema — live inside VS Code.** Syntax highlighting and a live SVG preview for the [typeDiagram](https://typediagram.dev) DSL.

## Features

- Syntax highlighting for `.td` and `.typediagram` files
- Light and dark themes tuned for TypeDiagram
- **Live SVG preview** — edit the DSL, see the diagram update instantly
- Language configuration (comments, brackets, auto-close pairs)

## Usage

1. Open a `.td` or `.typediagram` file
2. Click the **Open Preview** icon in the editor title bar, or run **TypeDiagram: Open Preview** from the command palette
3. The preview updates live as you type

## The DSL

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

Three constructs: `type` (records), `union` (tagged sum types), `alias` (newtypes). Generics with `<T>`. Comments with `#`.

## Related

- [typediagram.dev](https://typediagram.dev) — live web playground
- [`typediagram-core`](https://www.npmjs.com/package/typediagram-core) — npm library
- [`typediagram`](https://www.npmjs.com/package/typediagram) — CLI binary

## Links

- Docs: [typediagram.dev/docs](https://typediagram.dev/docs/)
- Source: [github.com/Nimblesite/typeDiagram](https://github.com/Nimblesite/typeDiagram)

MIT © [Nimblesite](https://nimblesite.co)
