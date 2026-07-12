# TDBIN Future Columnar Specification

> **Status:** SUPERSEDED — the columnar layout is now specified normatively in [tdbin-columnar.md](tdbin-columnar.md) (`[TDBIN-COL-*]`) and implemented by the Rust runtime (`crates/tdbin/src/column.rs`, `column_read.rs`) and generated codecs at layout major 2. This file remains as the research roadmap that led to it; the SIMD integer-block stage is still future work.
> Depends on: [tdbin-wire-format.md](tdbin-wire-format.md), [tdbin-future-reader.md](tdbin-future-reader.md), and the [implementation audit](../reports/tdbin-implementation-audit.md).

## Scope

`[TDBIN-FUTURE-COLUMNAR]` defines a schema-selected physical encoding for
logical `List<record>` and `List<union>` values: validity bitmaps,
struct-of-arrays fields, dense-union columns, and optionally SIMD-friendly
integer blocks. It targets the missing PLUR/columnar mechanisms identified by
the audit; it is not a claim that every payload benefits from columns.

## Compatibility boundary

Changing a published logical list from row-wise composite elements to columnar
storage is a breaking layout change. It MUST publish a new compatibility-major
manifest/hash and MUST NOT reinterpret v1 composite list elem kind 7.

The first implementation uses a **column-group struct** made only from existing
v1 primitives: a data word carries the logical element count and pointer slots
address validity, tag/offset, and field payload columns. The schema-selected
layout tells generated readers which struct shape to use, while the existing
schema-independent verifier still sees ordinary structs and lists. A dedicated
list kind may be introduced only by a later explicitly versioned wire extension.

## Physical layout

- A record column group stores one column per field in declaration order. Fixed
  scalars use packed/raw scalar columns; pointer values use offsets plus payload
  bytes or pointer columns; nested records recurse into column groups.
- Nullable scalar and semantic columns use a validity bitmap with bit 0 assigned
  to element 0. Absent lanes MUST contain canonical zero data. Nullable pointer
  columns may use null pointers only when random row lookup remains O(1).
- Variable-width strings/bytes use an element-count-plus-one offset column and a
  contiguous byte payload. Offsets MUST be monotonic, start at zero, and end at
  the payload length.
- Dense union columns store a discriminant per row, a variant-local offset per
  row, and one payload column group per payload-bearing variant. Unknown
  discriminants remain typed errors. Inactive payload lanes and padding MUST be
  canonical zero.
- The scalar baseline is the canonical reference codec on every CPU. Integer
  block compression may add SIMD-BP128 or an equivalent proven codec only after
  its block header, bit width, tail, and fallback bytes are specified and pinned
  by cross-language goldens.
- CPU feature selection MUST NOT change encoded bytes. SIMD and scalar paths
  produce byte-identical output and accept the same canonical input.

## Selection policy

Codegen MUST select row or column encoding from explicit schema/layout policy,
not runtime payload heuristics. The selection is part of
`[TDBIN-SCHEMA-CANON]`, and generated Rust/TypeScript codecs MUST agree. A
benchmark may compare policies, but production bytes cannot change because of
machine features, element count, or observed values.

## Implementation stages

1. Add the column-group layout to the shared layout planner and compatibility
   manifest. Keep the portable scalar codec as the only writer.
2. Implement fixed scalar, validity, offset-plus-payload, and nested record
   columns in Rust with generated borrowed views.
3. Implement dense-union tags, variant-local offsets, and payload columns.
4. Implement the identical scalar format in TypeScript and freeze
   cross-language vectors.
5. Add SIMD decode/encode behind runtime feature detection, prove byte identity,
   and retain the scalar fallback on every platform.
6. Re-profile all benchmark rows and retain columnar selection only where it
   improves the release gate without regressing correctness or canonicality.

## Acceptance

- Golden vectors cover empty/singleton columns, every validity-bit boundary,
  empty and Unicode variable data, monotonic-offset failures, zero-stride nested
  values, dense unions with empty/payload/unknown variants, and partial final
  integer blocks.
- Property tests prove row-wise and columnar codecs produce the same logical
  values, and scalar/SIMD paths produce identical bytes and typed errors.
- Rust and TypeScript decode each other's generated columnar vectors in Node and
  a browser.
- `make bench` measures the exact committed corpus and regenerates the sole
  numeric report. `[TDBIN-BENCH-GATE]` must pass every row; a win on only the
  list-heavy fixture does not complete this item.
