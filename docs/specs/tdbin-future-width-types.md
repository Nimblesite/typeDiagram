# TDBIN Future Width Types Specification

> Status: roadmap spec for `[TDBIN-FUTURE-WIDTH-TYPES]` and `[TDBIN-FUTURE-ORDINALS]`.
> Depends on: [tdbin-wire-format.md](tdbin-wire-format.md), [converters.md](converters.md).

## Scope

`[TDBIN-FUTURE-WIDTH-TYPES]` adds width-refined numeric DSL types such as `I8`,
`U16`, `U32`, `F32`, and explicit enum/union ordinals.

## Requirements

- Width-refined integers MUST map to the reserved list element widths already
  defined by `[TDBIN-PTR-LIST]`.
- `F32` MUST encode IEEE-754 binary32 little-endian.
- Generated language types MUST use the closest checked native type available.
- Explicit ordinals MUST be unique, stable, and rejected when outside the
  encoded width.
- Width crossings MUST be classified as breaking evolution
  (`[TDBIN-EVOLVE-WIDTH]`).

## Acceptance

- Parser, model, converters, Rust codegen, and TDBIN tests cover every width.
- Golden vectors pin scalar fields, lists, and enum-list ordinal bounds.
- Protobuf conversion documents any lossy width mapping explicitly.
