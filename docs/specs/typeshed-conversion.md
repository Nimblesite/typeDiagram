# Typeshed to typeDiagram

`[TYPESHED-*]` defines how [python/typeshed](https://github.com/python/typeshed) `.pyi` files become typeDiagram models, DSL files, and SVG diagrams. The importer is available in the library, the normal CLI, the bulk CLI, and the web converter.

## Quick start

Convert one stub:

```sh
typediagram --from typeshed --emit td stdlib/dataclasses.pyi > dataclasses.td
typediagram --from typeshed stdlib/dataclasses.pyi > dataclasses.svg
```

Convert a complete typeshed checkout while preserving its `stdlib/` and `stubs/` directory structure:

```sh
typediagram-typeshed /path/to/typeshed /path/to/generated-typeshed
```

Every `.pyi` containing declarations produces a matching `.td`; import-only, constant-only, and re-export-only modules are reported and skipped. Output files are written atomically.

Programmatic conversion uses the same public converter registry as every other language:

```ts
import { converters, model } from "typediagram-core";

const analyzed = converters.typeshed.analyzeSource(stubSource);
if (analyzed.ok) {
  const td = model.printSource(analyzed.value.model);
  const { declarationsConverted, methodsSkipped } = analyzed.value.stats;
}
```

`converters.typeshed.fromSource(source)` returns only the model when conversion statistics are not needed. `converters.typeshed.toSource(model)` emits a `.pyi` representation.

## Conversion pipeline

`[TYPESHED-AST]` parses Python with `@lezer/python`, a browser-safe Python grammar. Conversion never uses regular expressions to interpret structured stub syntax.

```text
.pyi source
  → Python concrete syntax tree
  → module declaration extraction
  → type annotation normalization
  → overload/class merge and generic-arity normalization
  → resolved typeDiagram Model
  → .td / JSON / layout / SVG
```

The extractor walks module declarations and declarations inside module-level `if`/`elif`/`else` version and platform gates. Conditional definitions with the same name are merged. It does not descend from a class into its methods.

## Declaration mapping

| Typeshed syntax                                       | typeDiagram result                          |
| ----------------------------------------------------- | ------------------------------------------- |
| ordinary `class` / `Protocol`                         | `type`, with annotated class fields         |
| `@dataclass class`                                    | `type`, with dataclass fields               |
| `TypedDict` / `NamedTuple` class                      | `type`, with declared fields                |
| `Enum`, `IntEnum`, `StrEnum`, `Flag`, `IntFlag`       | `union`, with assignment names as variants  |
| module `def` / `async def`                            | `function`                                  |
| repeated `@overload def name`                         | one `function name` with several signatures |
| `name: TypeAlias = T`                                 | `alias name = T`                            |
| `type Name[T] = T`                                    | generic `alias Name<T> = T`                 |
| inferable legacy alias / `NewType` / `TypeAliasType`  | `alias`                                     |
| class method, property, static method, or constructor | deliberately omitted                        |
| module constant or `TypeVar` declaration              | omitted                                     |

`[TYPESHED-DATACLASS]` does not depend on executing decorators. A dataclass is read structurally from its syntax tree, so frozen, slotted, generic, and decorator-call forms work in the browser. `ClassVar` members are not instance data and are omitted.

`[TYPESHED-METHODS]` is the boundary between data and behavior: module functions are retained; functions nested in classes are counted in `methodsSkipped` and never become fields or function declarations. This applies equally to dataclasses, protocols, TypedDicts, NamedTuples, enums, and ordinary classes.

## Function markup

`[DSL-FUNCTION]` adds free functions to the typeDiagram grammar. One signature uses a compact declaration:

```typediagram
function fetch(request: Request, limit: Int) -> Response
async function refresh(request: Request) -> Response
```

Overloads share one node:

```typediagram
function open {
  (path: String) -> Bytes
  (descriptor: Int, mode: String) -> Bytes
  async (path: String, timeout: Float) -> Bytes
}
```

Functions participate in parsing, model resolution, automatic parameter/return edges, JSON round-tripping, source printing, layout, SVG rendering, and render hooks. Existing data-language emitters continue to emit records/unions/aliases only; the typeshed emitter preserves function signatures as `.pyi` declarations.

## Type normalization

Python primitives and common containers map directly: `str → String`, `int → Int`, `float → Float`, `bool → Bool`, `bytes → Bytes`, `list → List`, `dict/Mapping → Map`, and `T | None → Option<T>`. Qualified names use their final component.

The importer preserves unfamiliar typing constructs as external type references, so `Callable`, `Protocol`, `LiteralString`, `TypeGuard`, and package-specific types still appear in the diagram. `Annotated`, `Final`, `Required`, `NotRequired`, and `ReadOnly` unwrap to their payload type; `ClassVar` fields are dropped; literal values reduce to their scalar type where a literal cannot be represented by a typeDiagram type reference.

Python permits special and variadic generic arities that typeDiagram does not. `[TYPESHED-ARITY]` computes the largest observed arity for every declaration, adds synthetic generic parameters when required, and pads shorter references with `Any`. This keeps every emitted `.td` valid and round-trippable without discarding the referenced declaration.

## Full-corpus verification

`[TYPESHED-CORPUS]` audits an external checkout without making network access part of normal CI:

```sh
cd packages/typediagram
npm run test:typeshed -- /path/to/typeshed
```

The gate parses each `.pyi`, converts every eligible declaration, prints `.td`, parses it again, rebuilds the model, and fails if any eligible file does not round-trip. On the typeshed `main` archive tested on 2026-07-19:

| Measure                                    |                 Result |
| ------------------------------------------ | ---------------------: |
| `.pyi` files scanned                       |                  5,214 |
| files with convertible declarations        |                  4,508 |
| declaration-free files                     |                    706 |
| eligible files converted and round-tripped |   4,508 / 4,508 (100%) |
| declaration statements converted           | 40,467 / 40,467 (100%) |
| merged model declarations emitted          |                 38,666 |
| class methods deliberately skipped         |                 53,468 |
| syntax/conversion failures                 |                      0 |

Normal unit/integration coverage uses realistic dataclass, TypedDict, NamedTuple, enum, alias, conditional, overload, async, malformed-source, and empty-source cases. The bulk CLI has a filesystem E2E test. Playwright drives the public web converter, pastes a typeshed dataclass with a method plus a module function, and asserts that the generated DSL and SVG retain the data/function while excluding the method.
