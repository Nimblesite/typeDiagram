# Language Converters

typeDiagram includes bidirectional converters for **TypeScript**, **Python**, **Rust**, **Go**, **C#**, **F#**, **Dart**, **PHP**, and **Protobuf**. Each converter can parse existing type definitions into a typeDiagram model, and emit type definitions from a model. All nine converters losslessly round-trip the canonical home-page sample (`TD → lang → TD` is byte-for-byte identical).

## How it works

```
TypeScript source  ──→  Model  ──→  SVG diagram
                          ↕
Python source      ←──  Model  ←──  typeDiagram source
```

Converters target the **Model** layer (Layer 2 of the framework). They don't round-trip through DSL text — they work directly with the resolved type graph.

## Semantic scalars

Beyond `Bool`/`Int`/`Float`/`String`/`Bytes`/`Unit`, three semantic scalars — `DateTime`, `Uuid`, and `Decimal` — map to the **native** date / UUID / decimal type of each language in both directions. A timestamp stays a `datetime.datetime` / `DateTimeOffset` / `time.Time`, an id stays a `uuid.UUID` / `Guid` / `uuid::Uuid` — never a bare string. The emitters also pull in the required imports automatically (Python `import datetime`, Go `import "time"`, Protobuf `import "google/protobuf/timestamp.proto"`).

| typeDiagram | Python              | C# / F#          | TypeScript     | Rust                            | Go          | Dart       | Protobuf                    | PHP                  |
| ----------- | ------------------- | ---------------- | -------------- | ------------------------------- | ----------- | ---------- | --------------------------- | -------------------- |
| `DateTime`  | `datetime.datetime` | `DateTimeOffset` | `string` (ISO) | `chrono::DateTime<chrono::Utc>` | `time.Time` | `DateTime` | `google.protobuf.Timestamp` | `\DateTimeImmutable` |
| `Uuid`      | `uuid.UUID`         | `Guid`           | `string`       | `uuid::Uuid`                    | `string`    | `String`   | `string`                    | `string`             |
| `Decimal`   | `decimal.Decimal`   | `decimal`        | `string`       | `rust_decimal::Decimal`         | `string`    | `String`   | `string`                    | `string`             |

## Unknown types fail generation

When you emit to a language (`--to`), every referenced type must resolve to a primitive, a generic built-in (`List`, `Map`, `Option`, `Any`), a declared type, or a generic parameter. A name that resolves to none of these — a typo or an unsupported type like `Timestamp` or `Instant` — is rejected with a non-zero exit code and a diagnostic, instead of being passed through verbatim into source that won't compile. (Rendering a diagram still treats unknown names as opaque external references — only code generation is strict.)

## TypeScript

### What maps

| TypeScript                      | typeDiagram                      |
| ------------------------------- | -------------------------------- |
| `interface User { ... }`        | `type User { ... }`              |
| `type Shape = Circle \| Square` | `union Shape { Circle, Square }` |
| `type Email = string`           | `alias Email = String`           |
| `string`                        | `String`                         |
| `number`                        | `Int`                            |
| `boolean`                       | `Bool`                           |
| `Array<T>`                      | `List<T>`                        |
| `Map<K,V>`                      | `Map<K,V>`                       |

### From TypeScript

```ts
// Input
export interface User {
  id: string;
  name: string;
  email: string | undefined;
}
```

```sh
typediagram --from typescript types.ts > diagram.svg
```

### To TypeScript

Emits `export interface` for records, discriminated unions with a `kind` field for unions, `export type X = Y` for aliases.

## Python

### What maps

| Python                    | typeDiagram           |
| ------------------------- | --------------------- |
| `@dataclass class User`   | `type User { ... }`   |
| `class Color(str, Enum)`  | `union Color { ... }` |
| `class Config(TypedDict)` | `type Config { ... }` |
| `str`                     | `String`              |
| `int`                     | `Int`                 |
| `float`                   | `Float`               |
| `bool`                    | `Bool`                |
| `list[T]` / `List[T]`     | `List<T>`             |
| `dict[K,V]` / `Dict[K,V]` | `Map<K,V>`            |
| `Optional[T]`             | `Option<T>`           |

### To Python

Emits `@dataclass` for records, `str, Enum` for unions with no payloads, separate dataclass per variant + type alias for unions with payloads.

## Rust

### What maps

| Rust                      | typeDiagram            |
| ------------------------- | ---------------------- |
| `pub struct User { ... }` | `type User { ... }`    |
| `pub enum Shape { ... }`  | `union Shape { ... }`  |
| `pub type Email = String` | `alias Email = String` |
| `String` / `&str`         | `String`               |
| `i32` / `i64` / `u64`     | `Int`                  |
| `f64`                     | `Float`                |
| `bool`                    | `Bool`                 |
| `Vec<T>`                  | `List<T>`              |
| `HashMap<K,V>`            | `Map<K,V>`             |
| `Option<T>`               | `Option<T>`            |

Supports struct variants, tuple variants, and unit variants in enums. Generic bounds (e.g. `T: Clone`) are parsed but bounds are dropped (only the type parameter name is kept).

## Go

### What maps

| Go                             | typeDiagram            |
| ------------------------------ | ---------------------- |
| `type User struct { ... }`     | `type User { ... }`    |
| `type Shape interface { ... }` | `union Shape { ... }`  |
| `type Email = string`          | `alias Email = String` |
| `string`                       | `String`               |
| `int64`                        | `Int`                  |
| `float64`                      | `Float`                |
| `bool`                         | `Bool`                 |
| `[]T`                          | `List<T>`              |
| `map[K]V`                      | `Map<K,V>`             |
| `*T`                           | `Option<T>`            |

Go doesn't have native sum types. Interfaces are mapped to unions; exported field names are lowercased in the typeDiagram output.

## C#

### What maps

| C#                                         | typeDiagram            |
| ------------------------------------------ | ---------------------- |
| `record User(...)`                         | `type User { ... }`    |
| `abstract record` + nested `sealed record` | `union Shape { ... }`  |
| `enum Color { ... }`                       | `union Color { ... }`  |
| `using Email = string;`                    | `alias Email = String` |

Tagged unions emit as a closed hierarchy (abstract record + nested sealed records, RestClient.Net / Outcome style). Primary-constructor records preserve the original field names. Aliases emit as `using Email = string;`.

## F#

### What maps

| F#                              | typeDiagram            |
| ------------------------------- | ---------------------- |
| `type User = { ... }`           | `type User { ... }`    |
| `type Shape = Circle \| Square` | `union Shape { ... }`  |
| `type Email = string`           | `alias Email = String` |

F# discriminated unions map directly. Record syntax is used for struct types.

## Dart

### What maps

| Dart                                                   | typeDiagram            |
| ------------------------------------------------------ | ---------------------- |
| `final class User { ... }`                             | `type User { ... }`    |
| `sealed class Shape` + `extends`/`implements` variants | `union Shape { ... }`  |
| `typedef Email = String`                               | `alias Email = String` |
| `T?`                                                   | `Option<T>`            |
| `List<T>`                                              | `List<T>`              |
| `Map<K,V>`                                             | `Map<K,V>`             |

Uses Dart 3 `sealed class` for tagged unions. First-class generics are preserved.

## PHP

### What maps

| PHP                                       | typeDiagram            |
| ----------------------------------------- | ---------------------- |
| `final readonly class User { ... }`       | `type User { ... }`    |
| sealed `interface` + implementing classes | `union Shape { ... }`  |
| `@typediagram-kind alias` docblock        | `alias Email = String` |
| `?string`                                 | `Option<String>`       |
| `@param list<T>`                          | `List<T>`              |
| `@param array<K,V>`                       | `Map<K,V>`             |

Emits `final readonly class` DTOs with constructor-promoted `public` params, `declare(strict_types=1)`, and PHPStan docblocks for generics. Tagged unions use a sealed `interface` with implementing classes and `@var 'Kind'` tags. Note: `Option<Unit>` is not round-trippable because both collapse to PHP `null` on parse.

## Protobuf

### What maps

| Protobuf                            | typeDiagram                        |
| ----------------------------------- | ---------------------------------- |
| `message User { ... }`              | `type User { ... }`                |
| `enum Color { ... }`                | `union Color { Red, Green, Blue }` |
| `oneof` + nested `message` variants | `union Shape { ... }`              |
| `optional T`                        | `Option<T>`                        |
| `repeated T`                        | `List<T>`                          |
| `map<K,V>`                          | `Map<K,V>`                         |

Uses proto3 syntax. Because proto3 can't natively express generics, `Option<List<T>>`, or type aliases, the converter encodes these via comment directives: `// @td-generics:`, `// @td-type:`, `// @td-alias:`. Unit-only unions emit as `enum`; struct-variant unions emit as `oneof` with nested `message` types.

## Programmatic API

```ts
import { converters } from "typediagram-core";

// Parse TypeScript source into a Model
const result = converters.typescript.fromSource(tsCode);
if (result.ok) {
  const model = result.value;

  // Convert to Rust
  const rustCode = converters.rust.toSource(model);

  // Convert to Python
  const pyCode = converters.python.toSource(model);

  // Render to SVG (via typeDiagram DSL)
  const { model: modelLayer } = await import("typediagram");
  const tdSource = modelLayer.printSource(model);
  const svg = await renderToString(tdSource);
}

// Available converters
converters.typescript;
converters.python;
converters.rust;
converters.go;
converters.csharp;
converters.fsharp;
converters.dart;
converters.php;
converters.protobuf;
```

Each converter implements the `Converter` interface:

```ts
interface Converter {
  readonly language: Language;
  fromSource(source: string): Result<Model, Diagnostic[]>;
  toSource(model: Model): string;
}
```
