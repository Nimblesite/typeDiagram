# TDBIN Implementation Plan

> Executes [docs/specs/tdbin-wire-format.md](../specs/tdbin-wire-format.md) + [docs/specs/tdbin-rust-api.md](../specs/tdbin-rust-api.md).
> Research basis: [docs/research/binary-format-research.md](../research/binary-format-research.md).
> First language: **Rust** (`crates/tdbin`, the workspace's first crate). TypeScript follows via golden-vector conformance.
> End state (roadmap): two-way streaming + an RPC framework (`[TDRPC-*]`) where typeDiagram `type`s are the payloads and typeDiagram **functions are the service contract** — every phase below keeps that door open (self-delimiting frames, forward-only encode, reserved capability pointer kind).

Rules of engagement: every function/test references its `[TDBIN-*]` ID; deslop `find-similar` before authoring, `rescan` after; functions < 20 lines, files < 500 lines; no panics; `Result<T,E>` everywhere; `tracing` only.

---

## Phase 1 — Crate scaffold + schema model + layout engine

- [ ] `crates/tdbin/Cargo.toml`: `[lints] workspace = true`, deps `thiserror` + `tracing`, workspace-inherited edition/license `[TDBIN-RS-CRATE]`
- [ ] Wire `cargo fmt` / `cargo clippy -- -D warnings` / `cargo llvm-cov` into `make fmt` / `make lint` / `make test` (first crate has landed — root `Cargo.toml` note + REPO-STANDARDS-SPEC `[MAKE-TARGETS]`); add Rust entry to `coverage-thresholds.json` (ratchet-only)
- [ ] Schema model: `TypeDef` / `FieldDef` / `VariantDef` / `TypeRef` `[TDBIN-RS-SCHEMA]`
- [ ] `build_schema`: validation (duplicates, unknown refs, arity, `InfiniteInline`, caps `[TDBIN-WIRE-LIMITS]`), alias expansion `[TDBIN-SCHEMA-ALIAS]`, monomorphization `[TDBIN-SCHEMA-MONO]`
- [ ] Layout engine: first-fit bit allocator `[TDBIN-REC-ALLOC]`, union variant overlap `[TDBIN-UNION-OVERLAP]`, discriminant sizing `[TDBIN-UNION-DISC]`, enum-union inlining `[TDBIN-UNION-ENUM]`, `Option` special cases `[TDBIN-PRIM-OPTION]`
- [ ] Canonical schema text + FNV-1a hash `[TDBIN-SCHEMA-CANON]` `[TDBIN-SCHEMA-HASH]`
- [ ] Test (merged, assertion-dense): layout goldens for a complex schema — exact bit offsets, pointer slots, section sizes, discriminant widths, hash values; plus every `SchemaError` variant provoked `[TDBIN-RS-ERROR]`

## Phase 2 — Encoder

- [ ] Word arena writer: preorder DFS allocation, in-message back-patching only `[TDBIN-ENC-ORDER]`
- [ ] Struct emission: XOR-default scalars `[TDBIN-REC-XOR]`, bit packing `[TDBIN-WIRE-WORD]`, zeroed padding + dead union slots `[TDBIN-ENC-ZERO]`
- [ ] Pointer emission: struct/list pointers, null-for-default `[TDBIN-PTR-STRUCT]` `[TDBIN-PTR-LIST]` `[TDBIN-PTR-NULL]`
- [ ] All list forms incl. composite tag word `[TDBIN-LIST-ELEM]` `[TDBIN-LIST-RAW]` `[TDBIN-LIST-COMPOSITE]`
- [ ] Primitive codecs: `DateTime`/`Uuid`/`Decimal` byte layouts `[TDBIN-PRIM-MAP]`, `Option` matrix `[TDBIN-PRIM-OPTION]`
- [ ] Framing writer `[TDBIN-MSG-FRAME]`; determinism `[TDBIN-ENC-CANON]`
- [ ] Test: encode-side of `[TDBIN-TEST-ROUNDTRIP]` + first golden vectors `[TDBIN-TEST-GOLDEN]` (byte-exact hex)

## Phase 3 — Verifier + decoder

- [ ] O(n) verify pass: bounds `[TDBIN-SAFE-BOUNDS]`, depth `[TDBIN-SAFE-DEPTH]`, amplification budget `[TDBIN-SAFE-AMPLIFY]`, UTF-8 `[TDBIN-SAFE-UTF8]`, all-slots validation `[TDBIN-SAFE-ZEROSLOT]`, `VerifyStats`
- [ ] Decode = verify + materialize in one pass → `Value` `[TDBIN-RS-VALUE]`; short/long structs `[TDBIN-REC-SHORT]`; `UnknownVariant` `[TDBIN-UNION-UNKNOWN]`
- [ ] Framing reader: magic/version/reserved/length/hash checks `[TDBIN-MSG-FRAME]`
- [ ] Full `DecodeError` surface `[TDBIN-RS-ERROR]`; totality `[TDBIN-RS-NOPANIC]`; `tracing` spans `[TDBIN-RS-LOG]`
- [ ] Tests: full `[TDBIN-TEST-ROUNDTRIP]` both directions; adversarial corpus `[TDBIN-TEST-EVIL]`; evolution suite `[TDBIN-TEST-EVOLVE]`

## Phase 4 — Packing + fuzz

- [ ] Packer/unpacker `[TDBIN-PACK-WORD]` `[TDBIN-PACK-RUNS]`, bounds-checked, output-capped
- [ ] Packed framing end-to-end (`PACKED` flag) `[TDBIN-MSG-FRAME]`
- [ ] Extend `[TDBIN-TEST-ROUNDTRIP]`/`[TDBIN-TEST-GOLDEN]`/`[TDBIN-TEST-EVIL]` with packed variants (incl. `PackedTruncated`)
- [ ] `cargo-fuzz` decode target, CI time-budgeted `[TDBIN-TEST-FUZZ]`

## Phase 5 — The gate: benchmark vs Protobuf

- [ ] Benchmark corpus in typeDiagram + `.proto`: diagram-model doc, union-heavy events, list-heavy dataset `[TDBIN-BENCH-CORPUS]`
- [ ] Criterion benches vs `prost`; CI-enforced gate: **size ≤ protobuf on every entry, encode+decode ≥ 1.5× prost throughput** `[TDBIN-BENCH-GATE]`
- [ ] Size assertions also live inside `[TDBIN-TEST-ROUNDTRIP]` (packed TDBIN bytes vs recorded protobuf fixture sizes) so `make test` guards the size axis even without benches
- [ ] Record baseline numbers in the bench report; regressions fail

## Phase 6 — `.td` text pipeline (E2E per repo testing rules)

- [ ] `crates/td-schema`: parser for the type subset of the language reference (records, unions incl. pinned/tuple variants, aliases, generics) → `TypeDef` — mirrors the TS parser's grammar; golden-parity fixtures against `packages/typediagram` parser output
- [ ] E2E tests: **diagram text → schema → encode → decode** in one black-box flow (the repo's "complex diagram text" test shape)
- [ ] CLI glue (later, `packages/cli` or a `tdbin` bin): `typediagram encode|decode|verify` — thin consumer only

## Phase 7 — Roadmap tracks (each opens with its own spec)

- [ ] `[TDBIN-FUTURE-READER]` zero-copy reader: `verify` once → nanosecond typed accessors (the order-of-magnitude read win, research §2)
- [ ] `[TDBIN-FUTURE-COLUMNAR]` struct-of-arrays lists: validity bitmaps, dense-union columns, SIMD-BP128 integer columns
- [ ] `[TDBIN-FUTURE-TS]` TypeScript codec in `packages/typediagram/` passing every golden vector
- [ ] `[TDBIN-FUTURE-RPC]` **`[TDRPC-*]` spec — the streaming/RPC framework**: typeDiagram function definitions → service contract; unary/server-stream/client-stream/bidi from signature shape (`f(Stream<Req>) -> Stream<Resp>`); numeric method ids (no method-name strings on the wire); capability pointer kind `11`; promise pipelining; QUIC-first transport. Drafted from the dedicated RPC research pass (research §6)
- [ ] `[TDBIN-FUTURE-WIDTH-TYPES]` width-refined DSL numerics; `[TDBIN-FUTURE-ORDINALS]` explicit ordinals for non-append evolution

## Exit criteria (v1 = phases 1–5)

1. `make ci` green: fmt + clippy (deny-all) + tests + coverage threshold + deslop budget.
2. Golden vectors committed and byte-stable `[TDBIN-TEST-GOLDEN]`.
3. Fuzz target runs clean on CI budget `[TDBIN-TEST-FUZZ]`.
4. **Bench gate holds: smaller than Protobuf on every corpus entry AND ≥ 1.5× prost encode/decode throughput** `[TDBIN-BENCH-GATE]`.
5. `grep -r '\[TDBIN-' crates/ docs/` shows every normative ID with at least one code or test reference.
