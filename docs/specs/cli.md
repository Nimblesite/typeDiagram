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
```

If `file` is omitted, reads from stdin. Output goes to stdout. Errors go to stderr with exit code 1.

## Options

| Flag           | Value                                                               | Description                                 |
| -------------- | ------------------------------------------------------------------- | ------------------------------------------- |
| `--from`       | `typescript\|python\|rust\|go\|csharp\|fsharp\|dart\|protobuf\|php` | Convert from language source to SVG         |
| `--to`         | `typescript\|python\|rust\|go\|csharp\|fsharp\|dart\|protobuf\|php` | Convert from typeDiagram to language source |
| `--theme`      | `light\|dark`                                                       | Color theme (default: `light`)              |
| `--font-size`  | number                                                              | Font size in pixels                         |
| `-h`, `--help` |                                                                     | Show help                                   |

`--from` and `--to` are mutually exclusive.

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

| Code | Meaning                                         |
| ---- | ----------------------------------------------- |
| 0    | Success                                         |
| 1    | Parse error, render error, or invalid arguments |

Parse errors include `line:col` diagnostics on stderr:

```
  3:12  error   expected '{', got Ident "User"
  7:1   error   unexpected token EOF
```

## Makefile shortcuts

```sh
make cli FILE=schema.td                    # typeDiagram → SVG
make cli FILE=types.ts LANG=typescript     # TypeScript → SVG
make cli FILE=models.py LANG=python        # Python → SVG
```
