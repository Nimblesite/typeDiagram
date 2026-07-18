# CLI Reference

The `typediagram` CLI reads typeDiagram source (or other language source) and writes SVG or language code to stdout.

## Installation

```sh
npm install -g typediagram
# or use via npx:
npx typediagram schema.td > diagram.svg
```

## Usage

```
typediagram [options] [file]
typediagram --config FILE [--watch]
```

If `file` is omitted, reads from stdin. Output goes to stdout. Errors go to stderr with exit code 1.

## Options

| Flag           | Value                                                               | Description                                       |
| -------------- | ------------------------------------------------------------------- | ------------------------------------------------- |
| `--config`     | JSON file                                                           | Generate every configured language output         |
| `--watch`      |                                                                     | Regenerate configured outputs after `.td` changes |
| `--from`       | `typescript\|python\|rust\|go\|csharp\|fsharp\|dart\|protobuf\|php` | Convert from language source to SVG               |
| `--to`         | `typescript\|python\|rust\|go\|csharp\|fsharp\|dart\|protobuf\|php` | Convert from typeDiagram to language source       |
| `--theme`      | `light\|dark`                                                       | Color theme (default: `light`)                    |
| `--font-size`  | number                                                              | Font size in pixels                               |
| `-h`, `--help` |                                                                     | Show help                                         |

`--from` and `--to` are mutually exclusive.

## Configured generation and watch mode

Paths are relative to the config file. Each `outputs` key selects one converter from the supported language registry:

```json
{
  "source": "schemas/person.td",
  "watch": true,
  "outputs": {
    "typescript": "frontend/src/generated/person.ts",
    "rust": "backend/src/generated/person.rs",
    "python": "services/generated/person.py"
  }
}
```

```sh
typediagram --config typediagram.json
```

`"watch": true` performs initial generation and then watches the source. `--watch` enables the same behavior from the command line when the config omits it. Each valid save regenerates every selected language. Invalid source reports diagnostics without overwriting the last good generated files; the watcher recovers automatically after the next valid save.

## Examples

### Render typeDiagram to SVG

```sh
# From a file
typediagram schema.td > diagram.svg

# From stdin
echo 'type User { name: String }' | typediagram > diagram.svg

# Dark theme
typediagram --theme dark schema.td > diagram.svg

# Custom font size
typediagram --font-size 16 schema.td > diagram.svg
```

### Convert from other languages

```sh
# TypeScript interfaces → SVG
typediagram --from typescript types.ts > diagram.svg

# Python dataclasses → SVG
typediagram --from python models.py > diagram.svg

# Rust structs/enums → SVG
typediagram --from rust types.rs > diagram.svg

# Go structs → SVG
typediagram --from go types.go > diagram.svg

# C# classes → SVG
typediagram --from csharp Models.cs > diagram.svg
```

### Export to other languages

```sh
# typeDiagram → TypeScript
typediagram --to typescript schema.td > types.ts

# typeDiagram → Python
typediagram --to python schema.td > models.py

# typeDiagram → Rust
typediagram --to rust schema.td > types.rs

# typeDiagram → Go
typediagram --to go schema.td > types.go

# typeDiagram → C#
typediagram --to csharp schema.td > Models.cs
```

## Exit codes

| Code | Meaning                                                        |
| ---- | -------------------------------------------------------------- |
| 0    | Success                                                        |
| 1    | Parse error, render error, unknown type in `--to`, or bad args |

Parse errors include `line:col` diagnostics on stderr:

```
  3:12  error   expected '{', got Ident "User"
  7:1   error   unexpected token EOF
```

### Unknown types fail `--to`

Code generation is strict: every referenced type must be a primitive, a generic built-in (`List`, `Map`, `Option`, `Any`), a declared type, or a generic parameter. An unknown name (a typo, or an unsupported type) exits **1** with a diagnostic instead of emitting source that won't compile:

```sh
$ printf 'type Probe {\n  a: Timestamp\n}\n' | typediagram --to python
  0:0  error   unknown type 'Timestamp': not a primitive, builtin, or declared type — declare it or use a builtin scalar
$ echo $?
1
```

Use the built-in semantic scalars `DateTime`, `Uuid`, and `Decimal` for timestamps, ids, and money — they map to each language's native type. Rendering a diagram (without `--to`) still treats unknown names as opaque external references.

## Makefile shortcuts

```sh
make cli FILE=schema.td                    # typeDiagram → SVG
make cli FILE=types.ts LANG=typescript     # TypeScript → SVG
make cli FILE=models.py LANG=python        # Python → SVG
```
