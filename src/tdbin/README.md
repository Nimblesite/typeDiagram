# tdbin

The Rust runtime for **TDBIN**, the compact binary wire format for
[typeDiagram](https://typediagram.dev) algebraic data types. It has no
dependencies.

You don't write codecs by hand: `typediagram encode schema.td` generates your
Rust types together with their `impl tdbin::Struct`, and this crate encodes,
decodes, frames, packs, and verifies them.

```toml
[dependencies]
tdbin = "0.14"
```

```rust
use tdbin::TdBin;

let bytes = person.to_packed_framed_bytes_checked()?;
let back = Person::from_framed_bytes(&bytes)?;
```

Decoding is safe on untrusted input: malformed bytes return a typed
`DecodeError` and never panic. Framed messages carry the schema's layout hash,
so a reader built against a different schema version rejects the message
instead of misreading it.

See the [TDBIN guide](https://typediagram.dev/docs/tdbin.html) and the
[wire-format specification](https://typediagram.dev/docs/tdbin-wire-format.html).
