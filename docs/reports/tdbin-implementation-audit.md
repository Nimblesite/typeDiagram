# TDBIN Implementation Audit

Date: 2026-07-10 (Australia/Melbourne)

Scope: Rust runtime and codegen, TypeScript runtime and codegen, wire/API
specifications, safety tests, profiler output, and the `prost` benchmark gate.

This is an engineering analysis, not the benchmark result artifact. All
benchmark values and computed verdicts live exclusively in the deterministic
[generated benchmark report](tdbin-bench-report.md) and its
[raw machine data](tdbin-bench-data.json).

## Executive Verdict

TDBIN is not yet a complete implementation of its own v1 specifications and it
has not thoroughly beaten Protocol Buffers. The core word/pointer encoding,
framing, packing, generated Rust round-trips, and malformed-input handling are
substantial. This audit also fixed several high-severity safety and canonical
encoding defects. Release claims must nevertheless remain scoped.

The generated report fails the packed-framed specification gate. Only the
list-heavy telemetry workload passes all three requirements in bare and
unpacked-framed modes; packing makes its encoder too slow. The actual diagram
document and event stream are larger and slower than Protobuf in packed-framed
mode. The broad “smaller and faster than Protobuf” claim is unsupported.

## Correctness Findings Fixed

- Decode now performs a schema-independent structural traversal before typed
  materialization in both runtimes. It validates every reachable pointer slot,
  including slots the generated decoder does not visit.
- Amplification accounting now charges physical body words for structs and all
  list kinds. Repeated aliases consume the budget instead of receiving a
  one-word charge per struct.
- Rust and TypeScript writers enforce the 64-pointer-edge depth limit during
  encode as well as decode.
- Zero-size structs use the canonical non-null relative offset `-1` marker, so
  an empty struct no longer aliases a null pointer.
- Composite list equation failures have a specific
  `MalformedCompositeTag` error.
- Generated known-union decoders reject non-null inactive pointer slots.
- Framed decoders expose explicit expected-layout-hash APIs and return a typed
  `HashMismatch` when the hash is absent or different.
- Rust word-list and bool-list decode hot paths validate ranges once and load
  each packed word once.
- TypeScript list decoders no longer rebuild arrays with repeated spread
  operations.
- The benchmark now compares production bare, framed, and packed-framed APIs;
  framed size is no longer paired with bare encode timing.

Regression coverage was added for unvisited pointers, alias fan-out,
zero-size roots, depth boundaries, hash mismatch, inactive union slots, every
sparse packing tag, and the expanded benchmark sizes.

## Remaining Release Blockers

1. Required pointer fields still reject null where the wire specification uses
   null as the default value for absent pointer data. Rust and TypeScript
   codegen need one consistent required/default policy.
2. Scalar `Option<T>` presence is word-granular instead of using the specified
   first-fit one-bit allocation.
3. Normal framed decode does not automatically know the expected layout hash.
   Codegen must derive the frozen compatibility-major hash and call the checked
   API; caller opt-in is insufficient for a schema guard.
4. TypeScript `Int` is restricted to JavaScript safe integers, so the full Rust
   `i64` domain is not cross-language lossless.
5. TypeScript enum-unions are not emitted as the specified inline scalar form,
   `List<enum-union>` is missing, and generated support is incomplete for lists,
   semantic scalars, scalar options, and generics.
6. Generated TypeScript codecs are not compiled and executed as the golden
   conformance subject, and browser parity and bundle size are unmeasured.
7. Zero-word composite lists such as `List<empty-record>` remain unsupported.
8. The normative-ID traceability audit fails: roadmap headings and many
   requirements do not have both implementing-code and test references.

## Academic Alignment

| Research recommendation                  | Current implementation                                                            | Assessment              |
| ---------------------------------------- | --------------------------------------------------------------------------------- | ----------------------- |
| Fixed tag-free data and pointer sections | 64-bit words, fixed struct sections, relative pointers                            | Implemented             |
| XOR fields with schema defaults          | Zero defaults work naturally; non-zero generated defaults are not a complete path | Partial                 |
| Cap'n Proto word packing                 | Sparse/dense runs, bounded unpack                                                 | Implemented, but costly |
| Verify once, then borrowed random access | Full structural prepass exists, but decode still allocates and materializes ADTs  | Partial                 |
| SIMD-friendly integer columns            | No SIMD-BP128 or Stream VByte column codec                                        | Not implemented         |
| Column-oriented repeated records/unions  | Composite lists remain row-oriented                                               | Not implemented         |
| One-bit validity/presence                | Bool lists/fields use bits; scalar options use words                              | Partial                 |
| Dense union columns                      | Row-wise discriminant plus payload structures                                     | Not implemented         |

The implementation did not “venture away” from the papers in the core pointer
layout. It stopped before the mechanisms that make the research thesis win both
axes. The local research document explicitly depends on verify-once borrowed
access, SIMD-friendly integer columns, and column-oriented repeated ADTs. Those
remain future specs. The current eager materialization path pays allocation and
copy costs, while row-wise fixed-width records pay padding and pointer overhead.

This conclusion is consistent with the primary sources: the
[Cap'n Proto encoding specification](https://capnproto.org/encoding.html)
defines the fixed word layout, relative pointers, XOR defaults, and packing
tradeoff; the [Protocol Buffers encoding guide](https://protobuf.dev/programming-guides/encoding/)
explains its compact tag/varint representation; and
[Lemire and Boytsov's SIMD integer decoding paper](https://arxiv.org/abs/1209.2137)
describes the vectorized bit-packing path that TDBIN has not implemented.
The missing repeated-ADT design is also the central subject of the
[PLUR columnar ADT paper](https://arxiv.org/abs/1708.08319), while the
[Dremel decade paper](https://www.vldb.org/pvldb/vol13/p3461-melnik.pdf)
quantifies nested column representation tradeoffs rather than endorsing the
current row-wise composite list.

## Benchmark Evidence

The [generated benchmark report](tdbin-bench-report.md) is the sole
human-readable result source. It contains all encoded sizes, Criterion medians,
confidence intervals, environment metadata, commands, and a SHA-256 matching
the [raw JSON](tdbin-bench-data.json). The generator computes every ratio and
pass/fail verdict directly from Criterion artifacts and encoder output.

The list-heavy metric fixture is deliberately favorable to fixed words: its
large integer IDs require long Protobuf varints, and its numeric/bool columns
create many packable zero bytes. It is a valid fixed workload, but it is not
evidence of a general serialization win. The document and event rows execute
the paired schemas committed under `docs/benchmarks/`, rather than proxying
those workload shapes.

## Profiler Results

`/usr/bin/sample` on the packed metric decode collected 4,134 stack samples.
`pack::decode` accounted for 2,359 samples (approximately 57%); typed reader
materialization accounted for roughly 25%, with raw word-list and bool-list
work visible beneath it. A sparse-tag scatter experiment made Criterion slower
and was reverted. The retained reader changes hoist repeated range checks and
avoid repeated bool-word loads; final timings are recorded only in the
generated benchmark report.

Packing remains the dominant hot path because it scans and reconstructs every
word before typed decode. That is an inherent second pass in the current API,
not a reader micro-optimization. Meaningful next gains require either a fused
packed reader, a borrowed unpack arena, or the planned columnar/SIMD formats.

## Verification

- `make bench` passed the Rust tests, ran the seven-fixture Criterion matrix
  with 50 samples and five-second measurement windows, and regenerated the
  hash-verified JSON and Markdown reports.
- Formatting, TypeScript builds/typechecks, ESLint, banned-dependency checks,
  deny-all Rust Clippy, and Rust workspace tests passed.
- `typediagram-core` passed 416 tests. Branch coverage is 91.07% against the
  91.05% threshold; the structural verifier has 100% statement/line coverage.
- The complete web Playwright rerun passed 120 tests with 2 intentional
  viewport skips. Merged web coverage passed at 98.08% statements, 96.76%
  branches, 98.02% functions, and 98.04% lines.
- Coverage ratcheting, workspace build, and bundle size passed. The core bundle
  is 80.97 KB against the 84 KB budget.
- The combined `make ci` run lost its Vite preview server during the final two
  mobile tests after 118 passes. Both tests passed in isolation and the
  subsequent complete 120-test rerun passed. This was an infrastructure flake,
  but the plan does not mark a one-invocation run complete.
- The required `deslop` audit could not run because neither its CLI nor MCP tool
  is available in this environment.

## Release Decision

Do not release with a general Protobuf superiority claim. A defensible preview
claim is limited to the exact unpacked-framed telemetry workload in the
generated report. Treat the TypeScript codec as experimental until the
cross-language blockers above are closed.

---

## Addendum — 2026-07-12 remediation and rework

Everything below supersedes the corresponding 2026-07-10 findings; the
regenerated [benchmark report](tdbin-bench-report.md) remains the sole
numeric authority.

### What changed

- **Columnar layout major 2 shipped end to end** ([tdbin-columnar.md](../specs/tdbin-columnar.md)):
  column groups, adaptive-width var columns, validity bitmaps, dense union
  tag columns with derived offsets, nested-list concatenation, and
  frame-of-reference delta integer blocks (`[TDBIN-COL-INTBLOCK]`, the scalar
  member of the SIMD-BP128 family the research mandated). The benchmark
  corpus is now entirely codegen-produced at layout 2; all hand-written
  corpus codecs were deleted.
- **Runtime hot paths rebuilt on measurement**: byte-arena writer with
  single-touch bulk appends; fused single-pass verifying decode (no
  structural pre-pass, no per-message allocation, extension slots and
  unknown-variant unions still fully verified); SWAR/cursor word packer with
  a branchless sparse expander; whole-payload UTF-8 validation with
  char-boundary row cuts; an absolute per-message materialization budget.
- **Every 2026-07-10 release blocker closed except the TypeScript roadmap
  items**: null-as-default decode (both generators, with executing TS codec
  tests that also flushed out and fixed a latent generated-encode bug),
  1-bit `Option<scalar>` presence via one shared cross-language allocator,
  automatic layout-hash emission and enforcement, normative-ID traceability
  (84/84 via `scripts/tdbin-spec-trace.mjs`).

### Measured outcome (see the generated report for numbers)

Every corpus and batch fixture is now BOTH smaller than Protobuf and faster
on every measured operation in its qualifying production mode. Against the
stretch 1.5x-headroom bar: `metric_batch`, `diagram_document`,
`person_batch`, and `contact_batch` pass; `event_batch` passes encode at
~2x and misses only its decode pin, repeatedly measuring 1.48-1.50x — the
materializing decode is now allocation-bound at the same object-graph shape
as prost, which is precisely the ceiling the verify-once borrowed reader
([tdbin-future-reader.md](../specs/tdbin-future-reader.md)) is specified to
break. The tiny single-message stress rows remain Protobuf-favored on size,
as the research predicts for any fixed-layout format at sub-100-byte
payloads.

### Still open

- TypeScript cross-language roadmap ([tdbin-future-typescript.md](../specs/tdbin-future-typescript.md)):
  lossless i64, list/columnar generation, browser matrix. The TS generator's
  supported subset now executes real round-trips in its suite.
- `List<empty-record>` zero-stride composites (loud diagnostics both layouts).
- Deslop repo duplication measures 18.6% against the 15% budget (breached
  before this work began; the generated fixture modules add to it), and the
  scan is not yet in the enforced CI path.
- The 1.5x decode headroom on `event_batch` via `[TDBIN-FUTURE-READER]`.
