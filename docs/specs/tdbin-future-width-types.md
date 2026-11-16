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

## Implemented (#85)

### [TDBIN-WIDTH-RANGE]

`I32`, `U8`, `U16`, `U32`, `U64` and `Size` are DSL primitives ([MODEL-WIDTH]). As a record field, each one occupies **one data word**, like `Int`: signed widths store the i64 two's-complement bit pattern and unsigned widths store the raw value. `Option<width>` uses the `[TDBIN-PRIM-OPTION]` presence bit plus value word. Encoding is lossless (the native type already bounds the value). Decoding narrows, and a word outside the declared range fails with the typed `ValueOutOfRange` error; it is never truncated. The layout manifest names each width (`i32@w0`, `u16@w2`, …), so changing `Int` to `I32` changes the layout hash: a breaking change, as `[TDBIN-EVOLVE-WIDTH]` requires.

### [TDBIN-WIDTH-LIST]

Lists use the element widths `[TDBIN-PTR-LIST]` reserves for them, little-endian:

| Element | List elem code | Bytes per element |
| ------- | -------------- | ----------------- |
| `U8`    | 2              | 1                 |
| `U16`   | 3              | 2                 |
| `U32`   | 4              | 4                 |
| `I32`   | 4              | 4                 |
| `U64`   | 5              | 8                 |
| `Size`  | 5              | 8                 |

### [TDBIN-WIDTH-PATH]

`Path` is a UTF-8 `String` on the wire (wire-identical to `String`, so its manifest token is `str`). Rust maps it to `std::path::PathBuf`. Encoding a non-UTF-8 path fails with `EncodeError::NonUtf8Path`.

Layout-2 column groups don't encode width types or `Path` yet; they fail with a diagnostic. `F32`, `I8`/`I16`, and explicit ordinals (`[TDBIN-FUTURE-ORDINALS]`) remain roadmap items.
