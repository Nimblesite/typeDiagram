# TDBIN Future Columnar Specification

> Status: roadmap spec for `[TDBIN-FUTURE-COLUMNAR]`.
> Depends on: [tdbin-wire-format.md](tdbin-wire-format.md).

## Scope

`[TDBIN-FUTURE-COLUMNAR]` defines columnar encodings for list-heavy schemas:
validity bitmaps, struct-of-arrays record lists, dense-union columns, and SIMD
integer blocks.

## Requirements

- Columnar lists MUST be schema-selected and layout-hashed so row and column
  encodings cannot be confused.
- Nullable columns MUST use a validity bitmap with bit 0 assigned to element 0.
- Dense union columns MUST store the discriminant column separately from payload
  columns and MUST zero inactive payload lanes.
- Integer columns MAY use SIMD-BP128 blocks only when the element count and CPU
  feature checks make the fallback unambiguous.
- Readers MUST always support a scalar fallback path.

## Acceptance

- A list-heavy benchmark corpus entry uses this encoding.
- Golden vectors include bitmap edge cases, empty columns, partial final blocks,
  and unknown union variants.
- Benchmarks prove whether the columnar path closes `[TDBIN-BENCH-GATE]`.
