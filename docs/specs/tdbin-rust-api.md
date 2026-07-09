# TDBIN Rust Codec Specification

> **Status:** DRAFT v1. Companion to [tdbin-wire-format.md](tdbin-wire-format.md) — that spec defines the bytes; this one defines the first implementation: the `tdbin` crate in the Rust workspace.
> Implementation plan: [docs/plans/tdbin-implementation-plan.md](../plans/tdbin-implementation-plan.md).

Every public behavior lives under a `[TDBIN-RS-*]` / `[TDBIN-TEST-*]` / `[TDBIN-BENCH-*]` ID; code and tests MUST reference the IDs in comments/test names so `grep '\[TDBIN-'` traces spec → code → tests.

---

## [TDBIN-RS-CRATE] Crate

- Path `crates/tdbin`, library name `tdbin`. Inherits workspace lints (`[lints] workspace = true`) — all lints deny, per root `Cargo.toml` (REPO-STANDARDS-SPEC `[LINT-RUST]`).
- Dependencies: `thiserror` (error derive), `tracing` (structured logging). Dev-dependencies: `criterion` (benches), `prost` + `prost-build` or pre-generated fixtures (the Protobuf comparison corpus, `[TDBIN-BENCH-GATE]`).
- No `unsafe`. No panics reachable from any public function on any input — `unwrap`/`expect`/`panic!`/indexing are workspace-denied; all offset arithmetic is `checked_*` and failures surface as errors (`[TDBIN-RS-NOPANIC]`).

## [TDBIN-RS-API] Public API

The API is plain functions returning `Result<T, E>` — no classes, no builders-as-objects, no global state:

```rust
pub fn build_schema(defs: &[TypeDef]) -> Result<Schema, SchemaError>;
pub fn schema_hash(schema: &Schema) -> u64;                       // [TDBIN-SCHEMA-HASH]

pub fn encode(
    schema: &Schema, root_type: &str, value: &Value, opts: &EncodeOptions,
) -> Result<Vec<u8>, EncodeError>;

pub fn decode(
    schema: &Schema, root_type: &str, wire: &[u8], opts: &DecodeOptions,
) -> Result<Value, DecodeError>;

pub fn verify(
    schema: &Schema, root_type: &str, wire: &[u8], opts: &DecodeOptions,
) -> Result<VerifyStats, DecodeError>;                            // [TDBIN-SAFE]
```

- `decode` = verify + materialize in one O(n) pass; it MUST be safe on arbitrary untrusted bytes (`[TDBIN-SAFE]`).
- `verify` exposes the standalone pass (returns traversed-word/depth stats) for callers that will later use the zero-copy reader (`[TDBIN-FUTURE-READER]`).
- `encode` output is deterministic (`[TDBIN-ENC-CANON]`) and honors `EncodeOptions { packed: bool, framing: Framing }` with `Framing::Bare | Framing::Framed { include_hash: bool }` (`[TDBIN-MSG-FRAME]`).
- `DecodeOptions { max_body_bytes: u64, expected_hash: Option<u64> }` — depth (64) and amplification caps are wire-format constants, not options (`[TDBIN-SAFE-DEPTH]`, `[TDBIN-SAFE-AMPLIFY]`).

## [TDBIN-RS-SCHEMA] Schema model

`TypeDef` mirrors the typeDiagram language reference exactly (records, unions with bare/named-field/tuple variants and optional pinned discriminants, aliases, generics):

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
```

`build_schema` validates (duplicate names, unknown references, arity, recursion only through pointer types, union size caps), **monomorphizes** all reachable generic instantiations (`[TDBIN-SCHEMA-MONO]`), expands aliases (`[TDBIN-SCHEMA-ALIAS]`), and precomputes every layout via `[TDBIN-REC-ALLOC]` / `[TDBIN-UNION-OVERLAP]`. Layout computation happens once here — never during encode/decode. Tuple-variant payload fields get positional names `"0"`, `"1"`, ….

The `.td` text → `TypeDef` parser is a separate deliverable (`crates/td-schema`, plan phase); `tdbin` itself is parser-agnostic.

## [TDBIN-RS-VALUE] Dynamic value model

v1 is schema-driven and dynamic (static codegen comes later):

```rust
pub enum Value {
    Unit,
    Bool(bool), Int(i64), Float(f64),
    Str(String), Bytes(Vec<u8>),
    DateTime(i64),            // µs since Unix epoch, UTC   [TDBIN-PRIM-MAP]
    Uuid([u8; 16]), Decimal([u8; 16]),
    Option(Option<Box<Value>>),
    List(Vec<Value>),
    Record { fields: Vec<(String, Value)> },
    Union  { variant: String, fields: Vec<(String, Value)> },
}
```

- `Record.fields` may omit fields (encode as default) and may appear in any order; unknown field names are an `EncodeError`.
- Enum-unions are `Value::Union` with empty `fields` — one uniform shape.
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
