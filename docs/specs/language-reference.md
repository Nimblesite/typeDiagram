# Language Reference

typeDiagram has four constructs: **type** (records), **union** (tagged sum types), **alias** (newtypes), and **function** (free-function/service signatures). It has no class methods.

## Records (`type`)

A record has a name, optional generic parameters, and named fields with types.

```
type User {
  id:      UUID
  name:    String
  email:   Option<Email>
  roles:   List<Role>
  address: Address
}
```

Fields are separated by newlines or commas. Trailing commas are allowed.

### Generics

```
type Pair<A, B> {
  first:  A
  second: B
}

type Box<T> {
  value: T
}
```

## Unions (`union`)

A union represents "one of" — a tagged sum type. Each variant can be bare (no payload) or carry fields.

```
union Shape {
  Circle    { radius: Float }
  Rectangle { width: Float, height: Float }
  Triangle  { a: Float, b: Float, c: Float }
  Point
}
```

Unions render visually distinct from records: dashed dividers between variants and a `|` pipe prefix on each variant row.

Variants can also pin an explicit numeric discriminant:

```
union ErrorCode {
  ParseError = -32700
  InvalidRequest = -32600
  MethodNotFound = -32601
}
```

This is useful when the integer value is part of a wire contract, such as protocol error codes or FFI enums.

### Generic unions

```
union Option<T> {
  Some { value: T }
  None
}

union Result<T, E> {
  Ok  { value: T }
  Err { error: E }
}
```

### Tuple-form variants

Variants can also carry positional payloads with tuple syntax:

```
union RequestId {
  Number(Int)
  String(String)
}
```

This is useful when the target language distinguishes tuple variants from
named-field variants, such as Rust `Number(i64)` vs `Number { value: i64 }`.

## Aliases (`alias`)

An alias creates a named synonym for another type.

```
alias Email = String
alias UserId = Uuid
alias Callback = Option<String>
```

## Functions (`function`)

Functions carry typed parameters, return types, optional generics, async state, and overloads. See [Typeshed to typeDiagram](typeshed-conversion.md) for the full import pipeline.

```typediagram
function fetch<T>(request: Request, fallback: Option<T>) -> Response

function read {
  (path: String) -> Bytes
  async (path: String, timeout: Float) -> Bytes
}
```

## Built-in types

These primitive types are always available (no declaration needed):

| Type     | Description     |
| -------- | --------------- |
| `Bool`   | Boolean         |
| `Int`    | Integer         |
| `Float`  | Floating point  |
| `String` | Text            |
| `Bytes`  | Binary data     |
| `Unit`   | No value (void) |

### Exact TypeScript integer types [CONV-TS-EXACT-INTEGERS]

The framework API `converters.typescript.toSource(model, { integerType: "bigint" })` emits `bigint` for built-in `Int`, including aliases, optional values, containers and union payloads; `Float` stays `number`. The default remains `number`. Reading TypeScript `bigint` maps back to `Int`. This is a model-generation option, not a CLI flag or a runtime validator: consumers must enforce their protocol's bounds and decode integers without first converting through JavaScript `number`. Ordinary JSON number parsing cannot preserve all 64-bit identities, and ordinary JSON stringification does not support bigint. Shared-memory and binary adapters need exact integer accessors and explicit range checks; model declarations alone do not supply them.

The TypeScript tdbin runtime scalar writer `i64Bits` accepts safe integer numbers or bigint values in the inclusive signed-64-bit range. It rejects overflow before producing unsigned wire bits; negative zero normalizes to zero. Exact readers use the raw bigint word with signed interpretation, never the number-returning `i64From` convenience function. `emitTypeScriptCodec(model, { integerType: "bigint" })` and `generateTypeScriptModule` with the same option produce exact bigint readers and bigint record defaults, including optional integers and child defaults. The option changes the JavaScript representation, not the wire layout; supported shapes and wire bounds are unchanged. Model generation alone does not enable this option on separately generated codecs.

### Osprey model generation [CONV-OSPREY]

`generateOspreyModule(model)` (imported from `typediagram-core/converters/osprey`) returns a Result containing Osprey ML declarations or diagnostics. It reuses the common target-aware declaration walker for records, unions and aliases, including generic references, List, Option and Result. Int maps to int, Float to float, Bool to bool, String and Uuid to string, and Unit to unit. UUID formatting and protocol bounds remain boundary validation responsibilities. Unsupported scalar mappings, external types, empty records/unions, functions, reserved identifiers and conflicting constructor names are rejected instead of silently renamed or omitted. This is a one-way model emitter, not a source parser, CLI converter, binary codec or fixed-layout ABI generator.

### Swift model generation [CONV-SWIFT]

`converters.generateSwiftModule(model)` returns a Result containing monomorphic, acyclic Swift model declarations or diagnostics. Records have immutable public fields and explicit public initializers so consuming modules can construct them; enums preserve named associated values and aliases preserve their names. Identifiers are backtick-escaped. Int maps to Int64, Float to Double, Uuid to Foundation UUID, String/Bool/Unit to String/Bool/Void, List to Array syntax and Option to optional syntax. The module imports Foundation. Unsupported external/scalar mappings, generic declarations, functions and recursive dependency graphs are rejected. Recursive UI model support remains outstanding; no implicit boxing layer is inserted. This API produces logical models, not Codable conformance, canonical wire encodings, fixed-layout shared views or a two-way CLI converter.

### Semantic scalars

Three semantic scalars are also built in. They render like any other primitive, but code generation maps each one to the **native** date / UUID / decimal type of the target language — so a timestamp or an id keeps its real type instead of degrading to a plain string.

| typeDiagram | Python              | C# / F#          | TypeScript     | Rust                            | Go          | Dart       | Protobuf                    | PHP                  |
| ----------- | ------------------- | ---------------- | -------------- | ------------------------------- | ----------- | ---------- | --------------------------- | -------------------- |
| `DateTime`  | `datetime.datetime` | `DateTimeOffset` | `string` (ISO) | `chrono::DateTime<chrono::Utc>` | `time.Time` | `DateTime` | `google.protobuf.Timestamp` | `\DateTimeImmutable` |
| `Uuid`      | `uuid.UUID`         | `Guid`           | `string`       | `uuid::Uuid`                    | `string`    | `String`   | `string`                    | `string`             |
| `Decimal`   | `decimal.Decimal`   | `decimal`        | `string`       | `rust_decimal::Decimal`         | `string`    | `String`   | `string`                    | `string`             |

### Width-refined integers and `Path` [MODEL-WIDTH]

`Int` is a signed 64-bit integer. When a field needs a narrower or unsigned range, use a width-refined integer. Code generation emits the closest native type, and the TDBIN codecs range-check every value on encode and decode, failing with a typed error instead of truncating ([TDBIN-FUTURE-WIDTH-TYPES]). `Path` is a file-system path: a UTF-8 string on the wire and in most languages, and `std::path::PathBuf` in Rust.

| typeDiagram | Range      | Rust                 | TypeScript | C#       | F#       | Go       | Protobuf | Swift    |
| ----------- | ---------- | -------------------- | ---------- | -------- | -------- | -------- | -------- | -------- |
| `I32`       | −2³¹…2³¹−1 | `i32`                | `number`   | `int`    | `int`    | `int32`  | `int32`  | `Int32`  |
| `U8`        | 0…255      | `u8`                 | `number`   | `byte`   | `byte`   | `uint8`  | `uint32` | `UInt8`  |
| `U16`       | 0…65535    | `u16`                | `number`   | `ushort` | `uint16` | `uint16` | `uint32` | `UInt16` |
| `U32`       | 0…2³²−1    | `u32`                | `number`   | `uint`   | `uint32` | `uint32` | `uint32` | `UInt32` |
| `U64`       | 0…2⁶⁴−1    | `u64`                | `bigint`   | `ulong`  | `uint64` | `uint64` | `uint64` | `UInt64` |
| `Size`      | 0…2⁶⁴−1    | `usize`              | `number`   | `ulong`  | `uint64` | `uint`   | `uint64` | `UInt`   |
| `Path`      | UTF-8 text | `std::path::PathBuf` | `string`   | `string` | `string` | `string` | `string` | `String` |

Python, Typeshed, Dart, PHP and Osprey have one integer type, so every width maps to `int` there. Protobuf has no 8- or 16-bit integers, so `U8`/`U16` widen to `uint32`. Reading Rust source back maps `i32`/`u8`/`u16`/`u32`/`u64`/`usize`/`PathBuf` to these types.

A declaration that reuses a built-in name shadows it: `alias Uuid = String` makes `Uuid` mean `String` again. Declared names always win over built-ins, so existing schemas never break.

## Container types

These generic built-ins are understood by every converter. They render as external references unless declared in the diagram:

| Type        | Description                                              |
| ----------- | -------------------------------------------------------- |
| `List<T>`   | Ordered collection                                       |
| `Map<K, V>` | Key-value mapping                                        |
| `Option<T>` | Optional value (declare as a union to get diagram edges) |
| `Any`       | Opaque / dynamic value                                   |

## Code generation and unknown types

Rendering a diagram is lenient: any name you reference that isn't a primitive or a declared type is treated as an opaque **external** reference and drawn as inline text. Code generation (`--to <language>`) is stricter. Every referenced name must resolve to a primitive, a generic built-in (`List`, `Map`, `Option`, `Any`), a declared type, or a generic parameter. An unknown name — a typo, or an unsupported type like `Timestamp` or `Instant` — fails generation with a non-zero exit code instead of silently emitting a symbol that won't compile in the target language.

## Comments

Line comments start with `#`:

```
# This is a comment
type User {
  name: String  # inline comment
}
```

## File header

The optional `typeDiagram` keyword at the top of a file is a header marker. It's not required.

```
typeDiagram

type User { ... }
```

## Edges (automatic)

Edges are drawn automatically when a field or variant references another type declared in the same diagram:

- **Field → Type**: solid arrow, labeled with the field name
- **Variant payload → Type**: solid arrow from the variant row
- **Generic argument → Type**: thin dashed arrow, labeled with the parameter

References to undeclared types (like `CountryCode` or any name not declared in the file) render as inline text only — no dangling edges.

## Grammar (formal)

```
Diagram     = ("typeDiagram")? Declaration*
Declaration = Record | Union | Alias | Function
Record      = "type" Name Generics? "{" Field* "}"
Union       = "union" Name Generics? "{" Variant* "}"
Alias       = "alias" Name Generics? "=" TypeRef
Function    = ("async")? "function" Name Generics? Signature
            | "function" Name Generics? "{" Signature* "}"
Signature   = ("async")? "(" Parameter* ")" "->" TypeRef
Parameter   = Name ":" TypeRef
Field       = Name ":" TypeRef
Variant     = Name ("=" Number)? ("{" Field* "}")?
TypeRef     = Name ("<" TypeRef ("," TypeRef)* ">")?
Generics    = "<" Name ("," Name)* ">"
Name        = [A-Za-z_][A-Za-z0-9_]*
Number      = "-"? [0-9] ([0-9_]* [0-9])?
```

The grammar is LL(1) with ~6 productions. Newlines and commas both work as separators inside `{ }` blocks.

### Native C# integer models [CONV-CS-INTEGER-WIDTH]

`converters.csharp.toSource(model, { integerWidth: 64 })` emits `long` for Int through aliases, optional values, containers and union payloads; the default is 32-bit `int`. Aliases precede declarations, and generated alias-order comments preserve round-trip ordering. UUID aliases use `System.Guid`. Logical records are not shared-memory layouts: range validation and generated ABI views remain separate responsibilities.

### Explicit native generator entry points [CONV-SHARED-LAYOUT]

Native build tooling imports `generateSwiftModule` from `typediagram-core/converters/swift` and `generateSharedLayout` from `typediagram-core/converters/shared-layout`. These build-time generators are deliberately absent from the default browser converter registry. The Swift emitter currently supports monomorphic acyclic logical models. The shared-layout generator returns a profile-specific manifest and exact SHA-256 fingerprint; it does not grant ownership or validate borrowed memory. Neither API supplies host runtime views or completes a bridge migration.
