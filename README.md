# typeDiagram

**Define your types once. Generate code and diagrams everywhere.**

typeDiagram is a tiny, language-neutral DSL for describing **algebraic data types** — records, tagged unions, generics, aliases. From one `.td` file, you get:

- **Source code** in TypeScript, Python, Rust, Go, and C# — DTOs, data classes, discriminated unions, pattern-matchable enums — generated from the same definition, always in sync.
- **SVG diagrams** with automatic orthogonal layout — no dragging, no fiddling, versionable in git.
- **Round-trip conversion** from existing TypeScript/Python/Rust/Go/C# back to the DSL, so you can retrofit an existing codebase.

This is not a diagramming tool dressed up with a text input like Mermaid or PlantUML. typeDiagram is a **shared schema for your data model** — the diagram is a side effect, not the goal. The primary output is code, in as many languages as you need, kept strictly in sync by construction.

### Why this matters

When your backend is Python, your mobile app is Swift/Kotlin, your web client is TypeScript, and your data pipeline is Rust, keeping DTOs aligned across five languages is a full-time job. typeDiagram inverts the problem: one definition, N outputs. Change a field, regenerate, done. Every consumer of the schema stays honest because they all build from the same source.

## 🚀 Try it live — no install

**→ [typediagram.dev](https://typediagram.dev)**

The full thing runs in your browser. Playground, converter, docs — all live. Paste a schema, get a diagram. Paste TypeScript, get a diagram. Export SVG. Done.

## VS Code extension ★★★★★

![TypeDiagram VS Code extension with live SVG preview](docs/vscode-screenshot.png)

Live SVG preview, syntax highlighting, and hover docs — right next to your schema.

**Install:**

- **Marketplace:** [marketplace.visualstudio.com/items?itemName=Nimblesite.typediagram](https://marketplace.visualstudio.com/items?itemName=Nimblesite.typediagram)
- **Rate it:** [leave a 5-star review](https://marketplace.visualstudio.com/items?itemName=Nimblesite.typediagram&ssr=false#review-details)
- **VSIX download:** [typediagram.vsix](docs/typediagram.vsix)

**Install the .vsix manually:**

1. Download [`typediagram.vsix`](docs/typediagram.vsix).
2. In VS Code, press `Ctrl+Shift+P` / `Cmd+Shift+P` and run **Extensions: Install from VSIX…**, then pick the file.
3. Or from a terminal: `code --install-extension typediagram.vsix`

## Install

```sh
# CLI
npm install -g typediagram

# Library
npm install typediagram-core

# VS Code extension
code --install-extension Nimblesite.typediagram
# or search "TypeDiagram" by Nimblesite in the Marketplace:
# https://marketplace.visualstudio.com/items?itemName=Nimblesite.typediagram
```

## The language

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

## CLI

```sh
typediagram schema.td > diagram.svg          # DSL → SVG
typediagram --from typescript types.ts > diagram.svg   # TS → SVG
typediagram --to rust schema.td > types.rs    # DSL → Rust
```

Full reference at [typediagram.dev/docs/](https://typediagram.dev/docs/).

## Monorepo layout

| Package                                        | What                                                                    |
| ---------------------------------------------- | ----------------------------------------------------------------------- |
| [packages/typediagram/](packages/typediagram/) | Core framework: parser, model, layout, render-svg, converters           |
| [packages/cli/](packages/cli/)                 | `typediagram` CLI binary                                                |
| [packages/web/](packages/web/)                 | Web playground + docs site ([typediagram.dev](https://typediagram.dev)) |
| [packages/vscode/](packages/vscode/)           | VS Code extension                                                       |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full workflow, repo layout, and rules. **Always run `make ci` before opening a PR** — it runs exactly what CI runs.

```sh
make setup   # install deps + build framework (first time only)
make fmt     # auto-format your changes
make ci      # full CI simulation — MUST pass before you push
```

MIT © [Nimblesite](https://nimblesite.co)
