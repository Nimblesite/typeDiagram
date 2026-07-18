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

### Semantic scalars

Three semantic scalars are also built in. They render like any other primitive, but code generation maps each one to the **native** date / UUID / decimal type of the target language — so a timestamp or an id keeps its real type instead of degrading to a plain string.

| typeDiagram | Python              | C# / F#          | TypeScript     | Rust                            | Go          | Dart       | Protobuf                    | PHP                  |
| ----------- | ------------------- | ---------------- | -------------- | ------------------------------- | ----------- | ---------- | --------------------------- | -------------------- |
| `DateTime`  | `datetime.datetime` | `DateTimeOffset` | `string` (ISO) | `chrono::DateTime<chrono::Utc>` | `time.Time` | `DateTime` | `google.protobuf.Timestamp` | `\DateTimeImmutable` |
| `Uuid`      | `uuid.UUID`         | `Guid`           | `string`       | `uuid::Uuid`                    | `string`    | `String`   | `string`                    | `string`             |
| `Decimal`   | `decimal.Decimal`   | `decimal`        | `string`       | `rust_decimal::Decimal`         | `string`    | `String`   | `string`                    | `string`             |

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
