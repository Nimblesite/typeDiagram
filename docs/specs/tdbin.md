# TDBIN Binary Codec

TDBIN is typeDiagram's compact binary format for algebraic data types: records
and tagged unions. A generated codec serializes a typed value directly to bytes
and materializes the same typed value from bytes. It does not build a generic
JSON-like value tree at runtime.

## Status and when to use it

TDBIN is an in-repository, pre-release implementation. Its Rust runtime,
generated Rust codecs, bare frames, packed frames, structural verification, and
golden-vector tests are implemented. The TypeScript runtime and generator are
also available, but are partial: use them for the supported shapes below and do
not claim full Rust/TypeScript production conformance yet.

Use TDBIN when the producer and consumer share a typeDiagram schema and you
want deterministic, compact binary messages. Do not use the bare format as a
self-describing interchange format: bare bytes contain no schema identity. Use
a framed message with an expected compatibility hash at a trust or deployment
boundary.

The implementation has not been published as a stable crate or npm release.
The commands and dependency paths in this guide are for a checkout of this
repository.

## Quick start: one schema, generated codecs

Start with a schema that uses records, an optional nested record, and a tagged
union. This is the schema used by the Rust example below.

```typediagram
type Address {
  street: String
  zip: Int
}

type EmailContact {
  addr: String
}

type PhoneContact {
  number: Int
  country: Int
}

union Contact {
  Email(EmailContact)
  Phone(PhoneContact)
}

type Person {
  name: String
  age: Int
  active: Bool
  score: Float
  address: Option<Address>
  nickname: Option<String>
  contact: Contact
}
```

Save it as `person.td`, validate the schema, then emit Rust. `encode` emits the
Rust type declarations and their `tdbin::Struct` implementations together.
`decode` emits only the implementations, which is useful when the Rust types
were generated separately with `--to rust`.

```sh
typediagram verify person.td
typediagram encode person.td > src/person.rs

# Alternative: generate the Rust ADTs separately, then only the codec impls.
typediagram --to rust person.td > src/types.rs
typediagram decode person.td > src/tdbin_codec.rs
```

The generated layout is part of the source: every record and union gets fixed
data-word and pointer-word counts plus slot-addressed read/write code. Do not
hand-write those implementations or reuse a codec generated from a different
schema.

## Rust: encode and decode generated types

Add the in-workspace runtime to the consuming Rust crate. In a standalone
checkout, replace the relative path with the path to this repository.

```toml
[dependencies]
tdbin = { path = "../typeDiagram/crates/tdbin" }
```

Place the result of `typediagram encode person.td` in `src/person.rs`. The
following `main.rs` constructs an actual generated `Person`, serializes it,
decodes it, and proves that re-encoding produces the exact same bytes.

```rust
mod person;

use person::{Address, Contact, EmailContact, Person};
use tdbin::TdBin;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let person = Person {
        name: "Ada Lovelace".to_owned(),
        age: 36,
        active: true,
        score: 9.75,
        address: Some(Address {
            street: "1 Analytical Way".to_owned(),
            zip: 1815,
        }),
        nickname: Some("Countess".to_owned()),
        contact: Contact::Email(EmailContact {
            addr: "ada@example.com".to_owned(),
        }),
    };

    let bytes = person.to_bytes()?;
    let decoded = Person::from_bytes(&bytes)?;
    assert_eq!(decoded, person);

    let encoded_again = decoded.to_bytes()?;
    assert_eq!(encoded_again, bytes);
    Ok(())
}
```

`TdBin` is blanket-implemented for every generated `tdbin::Struct`, so import
the trait to access `to_bytes` and `from_bytes`. Both methods return typed
errors instead of panicking; propagate or handle `EncodeError` and
`DecodeError` in application code.

### Rust framing, packing, and schema checks

`to_bytes` produces a bare, word-aligned body. It is ideal inside a context
where the schema is already fixed, but it has no magic bytes, length prefix, or
schema identity. For files, queues, services, or any boundary that may receive
the wrong message type, use a frame and require the expected hash on decode.

```rust
use person::Person;
use tdbin::TdBin;

fn decode_person_frame(bytes: &[u8], expected_hash: u64) -> Result<Person, tdbin::DecodeError> {
    Person::from_framed_bytes_with_hash(bytes, expected_hash)
}

fn encode_person_frame(person: &Person, schema_hash: u64) -> Result<Vec<u8>, tdbin::EncodeError> {
    person.to_packed_framed_bytes(Some(schema_hash))
}
```

There are three wire choices:

| Method                                                   | Bytes produced                            | Typical use                                                |
| -------------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------- |
| `to_bytes` / `from_bytes`                                | Bare, unpacked body                       | An in-process or otherwise schema-fixed boundary           |
| `to_framed_bytes` / `from_framed_bytes`                  | Self-delimiting frame around the body     | Streams and stored messages when compression is not needed |
| `to_packed_framed_bytes` / `from_framed_bytes_with_hash` | Frame with Cap'n-Proto-style word packing | Sparse data over a boundary; pair it with an expected hash |

`from_framed_bytes` validates framing and packed content but intentionally does
not compare a schema hash. `from_framed_bytes_with_hash` rejects a missing or
different hash with `DecodeError::HashMismatch`; use that method when the
sender is not already constrained to the exact layout.

## TypeScript: generate a codec, then round-trip

TypeScript uses the public `typediagram-core/tdbin` runtime. The generator
produces TypeScript interfaces/unions plus a `StructCodec<T>` for every
supported type. It returns a `Result`, so diagnostics stay values instead of
becoming thrown exceptions.

This is a build-time script that reads the same `person.td` schema and writes a
module named `person.ts`. The current CLI has TDBIN commands for Rust only; use
this public API for TypeScript generation.

```ts
import { readFile, writeFile } from "node:fs/promises";
import { model, parser } from "typediagram-core";
import { generateTypeScriptModule } from "typediagram-core/converters/typescript-tdbin";

const source = await readFile("person.td", "utf8");
const parsed = parser.parse(source);
const resolved = parsed.ok ? model.buildModel(parsed.value) : parsed;
const generated = resolved.ok ? generateTypeScriptModule(resolved.value) : resolved;

if (!generated.ok) {
  process.stderr.write(`${JSON.stringify(generated.error)}\n`);
  process.exitCode = 1;
} else {
  await writeFile("src/person.ts", generated.value);
}
```

After generating `src/person.ts`, the generated `PersonCodec` is a real codec
object. The following program exercises both byte directions and uses the
framed encoder/automatic decoder as well. `Int` is represented as a JavaScript
`number` today, so the TypeScript generator rejects values outside the safe
integer range rather than silently changing them.

```ts
import * as tdbin from "typediagram-core/tdbin";
import { PersonCodec, type Person } from "./person.js";

const person = {
  name: "Ada Lovelace",
  age: 36,
  active: true,
  score: 9.75,
  address: { street: "1 Analytical Way", zip: 1815 },
  nickname: "Countess",
  contact: { kind: "Email", _0: { addr: "ada@example.com" } },
} satisfies Person;

const bare = tdbin.encode(PersonCodec, person);
if (!bare.ok) {
  process.stderr.write(`${bare.error.code}: ${bare.error.message}\n`);
  process.exitCode = 1;
} else {
  const decoded = tdbin.decode(PersonCodec, bare.value);
  if (!decoded.ok) {
    process.stderr.write(`${decoded.error.code}: ${decoded.error.message}\n`);
    process.exitCode = 1;
  } else {
    const reencoded = tdbin.encode(PersonCodec, decoded.value);
    const byteIdentical = reencoded.ok && tdbin.toHex(reencoded.value) === tdbin.toHex(bare.value);
    process.stdout.write(`round trip: ${String(byteIdentical)}\n`);
  }
}

const schemaHash = 0xdecafn;
const framed = tdbin.encodePackedFramed(PersonCodec, person, schemaHash);
const decodedFrame = framed.ok ? tdbin.decodeAuto(PersonCodec, framed.value, schemaHash) : framed;
```

`decodeAuto` decodes a bare body when it sees no frame magic and otherwise
validates the frame, unpacks it if necessary, checks the supplied hash when one
is provided, then calls the typed codec. The returned error has a stable code
such as `HashMismatch`, `BadMagic`, `InvalidUtf8`, `UnknownVariant`, or
`PointerOutOfBounds`.

### TypeScript support boundary

The TypeScript implementation is deliberately conservative in its current
state. It supports generated records with `Bool`, `Int`, `Float`, `String`,
`Bytes`, optional pointer fields, and nested generated records/unions. It also
supports unions with bare variants, a single generated-record payload, or a
single `String` payload.

It does **not** yet generate codecs for lists, scalar `Option<T>`, semantic
scalars (`DateTime`, `Uuid`, `Decimal`), generics, inline enum-unions, or every
Rust-supported schema form. Generated modules are not yet compiled and
executed across the full browser and Rust interoperability matrix. Keep a
schema inside the supported subset and use the Rust codec when you need the
broader implemented feature set. See the [TypeScript codec roadmap](tdbin-future-typescript.md)
for the release criteria.

## What the bytes guarantee

TDBIN layouts are determined by the schema rather than by per-field tags.
Every struct has a scalar data section followed by pointer slots; pointers
refer to strings, byte lists, nested structs, and composite lists. The format
uses little-endian 64-bit words, and all bodies are word-aligned.

This design makes encoding canonical. For a fixed schema and typed value,
`value → bytes` is deterministic, and `bytes → value → bytes` preserves the
original canonical bytes. The checked Rust and TypeScript implementations both
validate malformed input before materializing typed values. Their decoder
defences include checked bounds, pointer-kind checks, UTF-8 validation, a
maximum nesting depth, and an amplification budget for hostile pointer graphs.

Read the [wire-format specification](tdbin-wire-format.md) for bit-level
layouts, frame flags, pointer encodings, packing, defaults, and evolution
rules. The [Rust codec specification](tdbin-rust-api.md) describes the public
Rust API and current implementation gaps.

## Compatibility rules

TDBIN evolves by layout, not by source names. These are the practical rules for
long-lived schemas:

- Append fields or union variants only at the end. Renaming is wire-compatible;
  reordering, removing, inserting, or changing a prior field is not.
- A union variant may be appended only while its discriminant width stays the
  same. Adding the first payload-carrying variant to an all-bare union is also
  breaking because it changes the union's encoding class.
- Use the compatibility-major layout hash in framed messages. The hash excludes
  names and formatting but captures the frozen wire facts for that schema major.
- Treat a hash mismatch as a deployment/schema compatibility failure, not as a
  malformed-message retry. Publish a new major layout when a frozen fact must
  change.

The current generators do not derive and enforce a layout hash automatically.
Until they do, choose, distribute, and pass the expected `u64`/`bigint` hash at
the application boundary yourself. That limitation is why the explicit hash
argument appears in both framed examples.

## Debugging checklist

| Symptom                                                       | Check                                                                                                                                                  |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `HashMismatch`                                                | Both sides must use the same compatibility-major hash and the frame must carry it.                                                                     |
| `BadLength`, `BadMagic`, or `BadVersion`                      | Confirm that the consumer expects a frame versus a bare body, and that transport has not truncated or transformed bytes.                               |
| `PointerOutOfBounds`, `ReservedPointerKind`, or `InvalidUtf8` | Treat input as malformed or corrupted; do not retry it as a different schema.                                                                          |
| `UnknownVariant`                                              | The writer used a newer or incompatible union layout; check append-only evolution and discriminant width.                                              |
| TypeScript generation diagnostic                              | Check the support boundary above; lists, semantic scalars, scalar options, and generics are not emitted yet.                                           |
| Rust compile error in generated output                        | Run `typediagram verify person.td`, regenerate with the matching checkout, and ensure the consuming crate depends on this workspace's `tdbin` runtime. |

## Next references

- [TDBIN wire format](tdbin-wire-format.md) — authoritative byte layout and evolution rules.
- [TDBIN Rust API](tdbin-rust-api.md) — trait-level API, error model, and runtime status.
- [TDBIN TypeScript roadmap](tdbin-future-typescript.md) — known gaps and completion evidence.
- [Multi-language pipeline](multi-language-pipeline.md) — generating types from one typeDiagram schema.
