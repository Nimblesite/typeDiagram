# Language Reference

typeDiagram has three constructs: **type** (records), **union** (tagged sum types), and **alias** (newtypes). That's it.

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
alias UserId = UUID
alias Callback = Option<String>
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

## Container types

These are conventionally used but not built-in — they render as external references:

| Type        | Description                                              |
| ----------- | -------------------------------------------------------- |
| `List<T>`   | Ordered collection                                       |
| `Map<K, V>` | Key-value mapping                                        |
| `Option<T>` | Optional value (declare as a union to get diagram edges) |

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

References to undeclared types (like `UUID`, `String`) render as inline text only — no dangling edges.

## Grammar (formal)

```
Diagram     = ("typeDiagram")? Declaration*
Declaration = Record | Union | Alias
Record      = "type" Name Generics? "{" Field* "}"
Union       = "union" Name Generics? "{" Variant* "}"
Alias       = "alias" Name Generics? "=" TypeRef
Field       = Name ":" TypeRef
Variant     = Name ("{" Field* "}")?
TypeRef     = Name ("<" TypeRef ("," TypeRef)* ">")?
Generics    = "<" Name ("," Name)* ">"
Name        = [A-Za-z_][A-Za-z0-9_]*
```

The grammar is LL(1) with ~6 productions. Newlines and commas both work as separators inside `{ }` blocks.
