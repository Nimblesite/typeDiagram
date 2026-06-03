# typediagram

**CLI for [typeDiagram](https://typediagram.dev).** Render the typeDiagram DSL to SVG, or convert between the DSL and TypeScript, Python, Rust, Go, C#, F#, Dart, PHP, and Protobuf.

**Live demo:** [typediagram.dev](https://typediagram.dev)

## Install

```sh
npm install -g typediagram
```

## Usage

```sh
# DSL → SVG (default)
typediagram schema.td > diagram.svg

# Source language → SVG
typediagram --from typescript types.ts > diagram.svg

# DSL → source language
typediagram --to rust schema.td > types.rs

# Read from stdin
cat schema.td | typediagram > diagram.svg
```

## Options

| Flag            | Values                                                                              | Default |
| --------------- | ----------------------------------------------------------------------------------- | ------- |
| `--from <lang>` | `typescript`, `python`, `rust`, `go`, `csharp`, `fsharp`, `dart`, `protobuf`, `php` | —       |
| `--to <lang>`   | `typescript`, `python`, `rust`, `go`, `csharp`, `fsharp`, `dart`, `protobuf`, `php` | —       |
| `--emit <fmt>`  | `svg`, `td`, `td+svg` (for `--from`)                                                | `svg`   |
| `--theme`       | `light`, `dark`                                                                     | `light` |
| `--font-size N` | font size in px                                                                     | —       |
| `-h`, `--help`  | show help                                                                           |         |

If no file is given, stdin is read. Output goes to stdout; errors go to stderr.

## Example

```sh
cat > user.td <<'EOF'
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
EOF

typediagram user.td > user.svg
```

## Related packages

- [`typediagram-core`](https://www.npmjs.com/package/typediagram-core) — core library (parser, layout, SVG renderer)
- TypeDiagram VS Code extension — syntax highlighting + live preview (search "TypeDiagram" by nimblesite on the Marketplace)

## Links

- Docs: [typediagram.dev/docs](https://typediagram.dev/docs/)
- Source: [github.com/Nimblesite/typeDiagram](https://github.com/Nimblesite/typeDiagram)

MIT © [Nimblesite](https://nimblesite.co)
