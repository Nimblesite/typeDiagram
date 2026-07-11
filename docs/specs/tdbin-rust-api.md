# TDBIN Rust Codec Specification

> **Status:** PARTIAL DRAFT v1. The direct typed runtime, framing, packing, structural verification, generated Rust codecs, and benchmark harness exist; the conformance and performance blockers are tracked in the [implementation audit](../reports/tdbin-implementation-audit.md) and [handoff plan](../plans/tdbin-implementation-plan.md#next-agent-handoff). Companion to [tdbin-wire-format.md](tdbin-wire-format.md), which remains authoritative for bytes.
> Implementation plan: [docs/plans/tdbin-implementation-plan.md](../plans/tdbin-implementation-plan.md).

Every public behavior lives under a `[TDBIN-RS-*]` / `[TDBIN-TEST-*]` / `[TDBIN-BENCH-*]` ID; code and tests MUST reference the IDs in comments/test names so `grep '\[TDBIN-'` traces spec → code → tests.

---

## [TDBIN-RS-CRATE] Crate

- Path `crates/tdbin`, library name `tdbin`. Inherits workspace lints (`[lints] workspace = true`) — all lints deny, per root `Cargo.toml` (REPO-STANDARDS-SPEC `[LINT-RUST]`).
- Runtime dependencies: **none** — the shipped crate builds offline and uses hand-written error enums. `criterion` and `prost` are dev dependencies used only by `[TDBIN-BENCH-GATE]`. `[TDBIN-RS-LOG]` is not implemented and the crate does not currently depend on `tracing`.
- No `unsafe`. No panics reachable from any public function on any input — `unwrap`/`expect`/`panic!`/indexing are workspace-denied; all offset arithmetic is `checked_*` and failures surface as errors (`[TDBIN-RS-NOPANIC]`).

## [TDBIN-RS-API] Public API — direct typed path (CORE, implemented)

**This is the core serialization path and what the `tdbin` crate ships today.** typeDiagram
codegen emits, per record and union, an `impl tdbin::Struct` whose layout — data (scalar)
section, pointer section, slot indices, union discriminant — is **baked in at generation time**.
A blanket `TdBin` gives every such type `to_bytes`/`from_bytes`: a typed value encodes straight
to bytes and decodes straight back into the typed object, with **no runtime `Schema` and no
intermediate dynamic `Value`**. Eliminating that reflective hop is intended to reduce overhead;
only `[TDBIN-BENCH-GATE]` determines whether it beats the comparison codec.

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

The current runtime supports bare, framed, and packed-framed messages; direct bool bit packing;
fixed-width and semantic scalars; pointer, raw, bit, word, and composite lists; generated records
and struct-unions; and schema-independent structural verification. This does not imply complete
v1 conformance: the pickup section below records the remaining deviations.

## Implementation status and pickup (non-normative)

Close these API/codegen gaps before treating the Rust implementation as v1 conformant:

1. Required pointer readers must map null to the schema default instead of returning
   `UnexpectedNull` (`[TDBIN-PTR-NULL]`, `[TDBIN-REC-SHORT]`). Preserve `NullRoot` for a null root
   pointer and preserve `None` for optional pointer fields.
2. Generated scalar options must use a first-fit one-bit presence flag followed by the scalar
   value slot, not a word-sized presence value (`[TDBIN-PRIM-OPTION]`, `[TDBIN-REC-ALLOC]`).
3. typeDiagram codegen must emit the frozen compatibility-major hash and generated normal framed
   decode wrappers must call `from_framed_bytes_with_hash`; the unchecked generic API may remain
   available for tooling (`[TDBIN-SCHEMA-HASH]`, `[TDBIN-SCHEMA-CANON]`).
4. Composite-list helpers must represent non-empty, zero-stride element sequences without
   confusing their zero body-word count with null (`[TDBIN-LIST-COMPOSITE]`).
5. `[TDBIN-RS-LOG]` needs an implementation and tests, or removal from this v1 contract.

Every item needs byte-exact golden coverage, generated-code compilation, evolution coverage where
applicable, and adversarial typed-error coverage. After correctness is closed, the next Rust
performance work is the verify-once borrowed API in
[tdbin-future-reader.md](tdbin-future-reader.md), not further eager-materialization tuning without a
profile.

## [TDBIN-RS-REFLECT] Optional reflective model — NOT part of serialize/deserialize

> **Optional extra, off the hot path.** The implemented `tdbin::reflect` module is a bridge between
> a dynamic tooling tree and an already-generated typed codec. It does not interpret schemas while
> serializing. The direct `Struct` / `TdBin` path remains the production path.

Generated or manual types opt in through `ValueCodec`:

```rust
pub trait ValueCodec: TdBin {
    fn type_def() -> TypeDef;
    fn to_value(&self) -> Value;
    fn from_value(value: &Value) -> Result<Self, ReflectError>;
}

pub fn encode<T: ValueCodec>(value: &Value) -> Result<Vec<u8>, ReflectError>;
pub fn decode<T: ValueCodec>(wire: &[u8]) -> Result<Value, ReflectError>;
pub fn verify<T: ValueCodec>(wire: &[u8]) -> Result<(), ReflectError>;
pub fn type_def<T: ValueCodec>() -> TypeDef;
```

`TypeDef`, `TypeRef`, and `Value` cover records, unions, aliases, primitive/semantic values,
options, lists, named references, and generic-parameter metadata. `encode` converts `Value` to `T`
then delegates to `T::to_bytes`; `decode` delegates to `T::from_bytes` then materializes `Value`.
`verify` currently verifies by fully decoding `T`, so it is a tooling convenience rather than the
future borrowed verifier API.

There is no implemented runtime `build_schema`, schema interpreter, root-name dispatcher, or
reflective layout-hash function. If those are added later, specify them as a separate tooling API
and keep them out of the production benchmark path. Do not describe the existing bridge as a
schema-driven codec.

## [TDBIN-RS-ERROR] Errors

The implemented hand-written `#[non_exhaustive]` errors carry no payload bytes:

- `EncodeError` — `BadLength`, `LimitExceeded`, and `OffsetOutOfRange`.
- `DecodeError` — frame/header/hash errors; packed truncation; pointer bounds, kind, and composite-tag errors; depth/amplification/UTF-8/limit errors; `UnknownVariant { ordinal }`; `UnexpectedNull`; and `NullRoot`.
- `reflect::ReflectError` — dynamic shape/name errors plus wrapped `EncodeError` and `DecodeError`.

There is no implemented `SchemaError` because there is no runtime schema builder. Generated-code
schema failures are TypeScript `Diagnostic[]` values at generation time. Failures remain values;
no `Err` path may allocate unboundedly or log payload bytes.

## [TDBIN-RS-NOPANIC] Totality

The public typed encode/decode APIs and optional reflective bridge are **total**: every typed value
or input byte slice returns `Ok` or `Err`, never panics, and never loops unboundedly. The traversal
budget (`[TDBIN-SAFE-AMPLIFY]`) bounds decode and checked wire limits bound encode. There is no
`build_schema` precondition because no runtime schema builder exists.

## [TDBIN-RS-LOG] Logging

This requirement is **not implemented**. The intended implementation uses `tracing` spans at
`debug` on encode/decode/verify entry and exit with structured metadata only, such as
`{ wire_bytes, words_traversed, packed }`. It must never log payload contents or string values.
Errors log at `warn` with the error variant and offsets. Add tests that prove sensitive values are
absent, or remove this requirement from the v1 contract before claiming full spec conformance.

---

## [TDBIN-TEST] Testing (per repo testing rules: few, huge, E2E-style tests)

Tests are black-box over the public API, deterministic, assertion-dense, and merged (no per-assertion splitting). Each test name references its spec ID.

### [TDBIN-TEST-ROUNDTRIP]

One comprehensive generated-code round-trip test per schema corpus entry covers nested records,
recursive values, every primitive, bare and payload unions, the full `Option` matrix, nested lists,
generics, Unicode strings, and empty values. Exercise bare, framed, and packed-framed production
APIs; decode must deep-equal the input and byte-identically re-encode (`[TDBIN-ENC-CANON]`). The
same suite pins exact sizes, defaults, short/long struct behavior, and checked hash handling.

### [TDBIN-TEST-GOLDEN]

Golden vectors: for each corpus schema+value, the exact wire bytes as hex fixtures asserted byte-for-byte both directions. These fixtures are the future cross-language conformance suite (`[TDBIN-FUTURE-TS]`) — they MUST never change without a wire-format version bump.

### [TDBIN-TEST-EVIL]

Adversarial corpus, all asserting **typed errors, never panics**: truncation at every byte boundary of a golden message; every pointer field perturbed (offset out of bounds, reserved kinds, oversized sections); composite tag count mismatches; depth bombs (> 64); amplification bombs (aliased fan-out); invalid UTF-8; packed streams truncated mid-run; wrong magic/version/hash; unknown discriminants (asserting `UnknownVariant` specifically).

### [TDBIN-TEST-EVOLVE]

Evolution suite: encode with schema v1, decode with v1+appended-field / appended-variant schema (defaults surface, `[TDBIN-EVOLVE-APPEND]`) and the reverse (extra data ignored, `[TDBIN-REC-SHORT]`); plus a width-crossing case asserting the documented breaking behavior (`[TDBIN-EVOLVE-WIDTH]` — hash mismatch on framed messages).

### [TDBIN-TEST-FUZZ]

`cargo-fuzz` target: decode arbitrary bytes through bare, framed, and packed entry points for a
fixed generated type — no panics, timeouts, or OOM. Fixed depth, amplification, and unpack limits
bound the current implementation. Run it in CI on a time budget.

---

## [TDBIN-BENCH] The gate that makes "smaller AND faster than Protobuf" enforceable

### [TDBIN-BENCH-CORPUS]

A fixed benchmark corpus of ≥ 3 realistic payload shapes defined in **both** typeDiagram and `.proto`: (a) a record-heavy document (typeDiagram's own diagram model), (b) a union-heavy event stream (many small tagged messages), (c) a list-heavy dataset (structs with numeric/string columns). Same logical values on both sides.

### [TDBIN-BENCH-GATE]

Criterion benches compare production `tdbin` APIs against `prost` on the corpus. The gate is
CI-checked:

- **Size:** TDBIN packed framed bytes ≤ Protobuf encoded bytes on every corpus entry.
- **Speed:** TDBIN `encode` and `decode` each ≥ 1.5× the throughput of prost's on every corpus entry (target headroom; the roadmap zero-copy reader raises this to order-of-magnitude on reads, research §2).
- Regressions against the recorded baseline fail the build. `make bench` generates the committed
  [benchmark report](../reports/tdbin-bench-report.md) from
  [raw data](../reports/tdbin-bench-data.json); those artifacts are the sole numeric authority.

The 2026-07-10 generated report fails this gate. Do not claim general Protobuf superiority until a
later generated report passes every row.
