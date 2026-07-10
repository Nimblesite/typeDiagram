# TDBIN Rust Codec Specification

> **Status:** DRAFT v1. Companion to [tdbin-wire-format.md](tdbin-wire-format.md) — that spec defines the bytes; this one defines the first implementation: the `tdbin` crate in the Rust workspace.
> Implementation plan: [docs/plans/tdbin-implementation-plan.md](../plans/tdbin-implementation-plan.md).

Every public behavior lives under a `[TDBIN-RS-*]` / `[TDBIN-TEST-*]` / `[TDBIN-BENCH-*]` ID; code and tests MUST reference the IDs in comments/test names so `grep '\[TDBIN-'` traces spec → code → tests.

---

## [TDBIN-RS-CRATE] Crate

- Path `crates/tdbin`, library name `tdbin`. Inherits workspace lints (`[lints] workspace = true`) — all lints deny, per root `Cargo.toml` (REPO-STANDARDS-SPEC `[LINT-RUST]`).
- Dependencies (v0): **none** — zero external deps so the crate builds offline. Errors are hand-written enums (the `thiserror` derive lands with the logging pass), and `tracing`/`criterion`/`prost` arrive with `[TDBIN-RS-LOG]` / `[TDBIN-BENCH-GATE]` respectively.
- No `unsafe`. No panics reachable from any public function on any input — `unwrap`/`expect`/`panic!`/indexing are workspace-denied; all offset arithmetic is `checked_*` and failures surface as errors (`[TDBIN-RS-NOPANIC]`).

## [TDBIN-RS-API] Public API — direct typed path (CORE, implemented in v0)

**This is the core serialization path and what the `tdbin` crate ships today.** typeDiagram
codegen emits, per record and union, an `impl tdbin::Struct` whose layout — data (scalar)
section, pointer section, slot indices, union discriminant — is **baked in at generation time**.
A blanket `TdBin` gives every such type `to_bytes`/`from_bytes`: a typed value encodes straight
to bytes and decodes straight back into the typed object, with **no runtime `Schema` and no
intermediate dynamic `Value`**. Eliminating that reflective hop is what lets it beat a
schema-driven codec on speed.

```rust
pub trait Struct: Sized {
    const DATA_WORDS: u16;   // fixed scalar-section width   [TDBIN-REC-ALLOC]
    const PTR_WORDS:  u16;   // fixed pointer-section width   [TDBIN-REC-SECTIONS]
    fn write_struct(&self, w: &mut Writer, at: usize) -> Result<(), EncodeError>;
    fn read_struct(r: &Reader<'_>, at: usize) -> Result<Self, DecodeError>;
}

pub trait TdBin: Struct {                                    // blanket impl for every Struct
    fn to_bytes(&self) -> Result<Vec<u8>, EncodeError>;      // Writer::message  [TDBIN-ENC-CANON]
    fn from_bytes(wire: &[u8]) -> Result<Self, DecodeError>; // Reader::message  [TDBIN-SAFE]
    fn to_framed_bytes(&self, schema_hash: Option<u64>) -> Result<Vec<u8>, EncodeError>;
    fn to_packed_framed_bytes(&self, schema_hash: Option<u64>) -> Result<Vec<u8>, EncodeError>;
    fn from_framed_bytes(wire: &[u8]) -> Result<Self, DecodeError>;
    fn from_framed_bytes_with_hash(wire: &[u8], expected: u64) -> Result<Self, DecodeError>;
}
```

- `Writer` and `Reader<'a>` are the public building blocks the generated impls call: `scalar` /
  `string` / `bytes` / `child` slot accessors over a word arena and checked offsets. Decode first
  performs schema-independent structural verification of every reachable pointer slot, then the
  generated typed reader validates schema-specific slot use and materializes the value.
- `from_bytes` is **safe on arbitrary untrusted bytes** (`[TDBIN-SAFE]`): every read is
  bounds-checked, with a depth cap of 64 (`[TDBIN-SAFE-DEPTH]`), an amplification budget
  (`[TDBIN-SAFE-AMPLIFY]`), and UTF-8 validation (`[TDBIN-SAFE-UTF8]`). No panics on any input
  (`[TDBIN-RS-NOPANIC]`).
- `from_framed_bytes_with_hash` requires the frame to carry the caller's expected
  compatibility-major layout hash and returns `HashMismatch` for a missing or different hash.
  Plain `from_framed_bytes` validates frame structure but does not assert schema identity.
- `to_bytes` is deterministic/canonical (`[TDBIN-ENC-CANON]`): the same value always yields the
  same bytes, and `bytes → object → bytes` is byte-identical.
- **The ADT types _and_ their codec are produced by typeDiagram codegen — never hand-written.**
  `packages/typediagram/src/converters/rust.ts` emits the `struct`/`enum`; `rust-tdbin.ts`
  (`generateRustModule`) emits the `impl tdbin::Struct`. `crates/tdbin/tests/generated/mod.rs` is
  a checked-in example of that output, round-tripped by `tests/roundtrip.rs` under `cargo test`.

v0 wire subset is bare framing, unpacked: one word per scalar (bool/int/float), String / Bytes /
nested record / union via pointers, `Option<pointer-type>` = null-for-None, union = discriminant
word + payload child pointer. `EncodeOptions { packed, framing }`, semantic scalars, and lists are
Phase 2+ (`[TDBIN-MSG-FRAME]`, `[TDBIN-PRIM-MAP]`).

## [TDBIN-RS-REFLECT] Optional reflective model — NOT part of serialize/deserialize

> ⚠️ **Optional extra, off the hot path.** The `TypeDef` / `TypeRef` schema model and the dynamic
> `Value` codec (`build_schema` / `encode` / `decode` / `verify`) described here are a **tooling
> feature** — for programs that want to inspect a model's structure, or encode/decode _without_
> generated types. They are **explicitly NOT the core serialization path** and are **not required**
> to round-trip typeDiagram ADTs; the direct typed `Struct` / `TdBin` path above owns that, and it
> is what makes TDBIN fast (no reflective `Value` hop). This reflective model is a later, separable
> deliverable (plan Phase 5, `[TDBIN-FUTURE-*]`); it targets the _same_ bytes, so the two paths
> interoperate. Nothing below is implemented in v0.

The reflective/dynamic API is plain functions returning `Result<T, E>` — no classes, no global state:

```rust
pub fn build_schema(defs: &[TypeDef]) -> Result<Schema, SchemaError>;
pub fn schema_hash(schema: &Schema) -> u64;                       // [TDBIN-SCHEMA-HASH]
pub fn encode(schema: &Schema, root_type: &str, value: &Value, opts: &EncodeOptions) -> Result<Vec<u8>, EncodeError>;
pub fn decode(schema: &Schema, root_type: &str, wire: &[u8], opts: &DecodeOptions) -> Result<Value, DecodeError>;
pub fn verify(schema: &Schema, root_type: &str, wire: &[u8], opts: &DecodeOptions) -> Result<VerifyStats, DecodeError>; // [TDBIN-SAFE]
```

`TypeDef` mirrors the typeDiagram language reference exactly (records, unions with bare/named-field/tuple variants and optional pinned discriminants, aliases, generics), and `build_schema` validates + monomorphizes (`[TDBIN-SCHEMA-MONO]`) + expands aliases (`[TDBIN-SCHEMA-ALIAS]`) + precomputes layouts once (`[TDBIN-REC-ALLOC]`). The `.td` text → `TypeDef` parser is itself a separate deliverable (`crates/td-schema`); `tdbin` is parser-agnostic.

```rust
pub enum TypeDef {
    Record { name: String, params: Vec<String>, fields: Vec<FieldDef> },
    Union  { name: String, params: Vec<String>, variants: Vec<VariantDef> },
    Alias  { name: String, params: Vec<String>, target: TypeRef },
}
pub struct FieldDef   { pub name: String, pub ty: TypeRef }
pub struct VariantDef { pub name: String, pub fields: Vec<FieldDef>, pub pinned: Option<i64> }
pub enum TypeRef {
    Bool, Int, Float, Str, Bytes, Unit, DateTime, Uuid, Decimal,
    Option(Box<TypeRef>), List(Box<TypeRef>),
    Named { name: String, args: Vec<TypeRef> },
    Param(String),
}

pub enum Value {                                  // dynamic tree — the hop the typed path avoids
    Unit, Bool(bool), Int(i64), Float(f64),
    Str(String), Bytes(Vec<u8>),
    DateTime(i64), Uuid([u8; 16]), Decimal([u8; 16]),   // [TDBIN-PRIM-MAP]
    Option(Option<Box<Value>>), List(Vec<Value>),
    Record { fields: Vec<(String, Value)> },
    Union  { variant: String, fields: Vec<(String, Value)> },
}
```

- `Record.fields` may omit fields (encode as default) and may appear in any order; unknown field names are an `EncodeError`. Enum-unions are `Value::Union` with empty `fields`.
- `decode` materializes every field the reader's schema knows, applying defaults for short structs (`[TDBIN-REC-SHORT]`); an unknown discriminant is `DecodeError::UnknownVariant` (`[TDBIN-UNION-UNKNOWN]`).

## [TDBIN-RS-ERROR] Errors

Four `#[non_exhaustive]` `thiserror` enums; every variant carries actionable context and no payload data:

- `SchemaError` — `DuplicateType`, `UnknownType`, `ArityMismatch`, `InfiniteInline` (recursion not through a pointer), `TooManyVariants`, `TooManyFields` (section caps, `[TDBIN-WIRE-LIMITS]`).
- `EncodeError` — `TypeMismatch { type_name, field, expected, got }`, `UnknownField`, `UnknownRoot`, `LimitExceeded`, `InvalidDecimal`.
- `DecodeError` — `BadMagic`, `BadVersion`, `ReservedBits`, `LengthMismatch`, `HashMismatch { expected, got }`, `PointerOutOfBounds { word_index }`, `ReservedPointerKind`, `DepthExceeded`, `AmplificationExceeded`, `MalformedCompositeTag`, `InvalidUtf8 { word_index }`, `UnknownVariant { type_name, ordinal }`, `PackedTruncated`, `LimitExceeded`.
- Failures are values; no `Err` path may allocate unboundedly or log payload bytes.

## [TDBIN-RS-NOPANIC] Totality

`encode`, `decode`, `verify` are **total**: for every input — any schema accepted by `build_schema`, any `Value`, any byte slice — they return `Ok` or `Err`, never panic, never loop unboundedly (traversal budget `[TDBIN-SAFE-AMPLIFY]` bounds decode; value size bounds encode). Control flow is `match`/combinators per repo style — no bare `if` chains.

## [TDBIN-RS-LOG] Logging

`tracing` spans at `debug` on `encode`/`decode`/`verify` entry/exit with structured fields only — `{ root_type, wire_bytes, words_traversed, packed }`. Never payload contents, never string values (PII rule). Errors log at `warn` with the error variant name and offsets.

---

## [TDBIN-TEST] Testing (per repo testing rules: few, huge, E2E-style tests)

Tests are black-box over the public API, deterministic, assertion-dense, and merged (no per-assertion splitting). Each test name references its spec ID.

### [TDBIN-TEST-ROUNDTRIP]

One comprehensive round-trip test per schema corpus entry: build a **complex** schema (nested records, a recursive tree, every primitive, unions with bare + named + tuple + pinned variants, the full `Option` matrix, `List<List<T>>`, generics `Pair<Int,String>`/`Result<T,E>`, unicode strings, empty lists/strings) → `encode` (bare, framed, packed × unpacked) → `verify` → `decode` → deep-equality with the input, PLUS in the same test: exact expected byte lengths, packed ≤ unpacked, defaults round-trip as `None`/zero, field-order-independence of `Record.fields`, and re-encode determinism (`[TDBIN-ENC-CANON]`).

### [TDBIN-TEST-GOLDEN]

Golden vectors: for each corpus schema+value, the exact wire bytes as hex fixtures asserted byte-for-byte both directions. These fixtures are the future cross-language conformance suite (`[TDBIN-FUTURE-TS]`) — they MUST never change without a wire-format version bump.

### [TDBIN-TEST-EVIL]

Adversarial corpus, all asserting **typed errors, never panics**: truncation at every byte boundary of a golden message; every pointer field perturbed (offset out of bounds, reserved kinds, oversized sections); composite tag count mismatches; depth bombs (> 64); amplification bombs (aliased fan-out); invalid UTF-8; packed streams truncated mid-run; wrong magic/version/hash; unknown discriminants (asserting `UnknownVariant` specifically).

### [TDBIN-TEST-EVOLVE]

Evolution suite: encode with schema v1, decode with v1+appended-field / appended-variant schema (defaults surface, `[TDBIN-EVOLVE-APPEND]`) and the reverse (extra data ignored, `[TDBIN-REC-SHORT]`); plus a width-crossing case asserting the documented breaking behavior (`[TDBIN-EVOLVE-WIDTH]` — hash mismatch on framed messages).

### [TDBIN-TEST-FUZZ]

`cargo-fuzz` target: `decode(arbitrary bytes)` on a fixed corpus schema — no panics, no timeouts, no OOM (bounded by `DecodeOptions`). Run in CI on a time budget.

---

## [TDBIN-BENCH] The gate that makes "smaller AND faster than Protobuf" enforceable

### [TDBIN-BENCH-CORPUS]

A fixed benchmark corpus of ≥ 3 realistic payload shapes defined in **both** typeDiagram and `.proto`: (a) a record-heavy document (typeDiagram's own diagram model), (b) a union-heavy event stream (many small tagged messages), (c) a list-heavy dataset (structs with numeric/string columns). Same logical values on both sides.

### [TDBIN-BENCH-GATE]

Criterion benches comparing `tdbin` against `prost` on the corpus. The gate (CI-checked, not vibes):

- **Size:** TDBIN packed framed bytes ≤ Protobuf encoded bytes on every corpus entry.
- **Speed:** TDBIN `encode` and `decode` each ≥ 1.5× the throughput of prost's on every corpus entry (target headroom; the roadmap zero-copy reader raises this to order-of-magnitude on reads, research §2).
- Regressions against the recorded baseline fail the build. Numbers are recorded in the bench report committed with the change.
