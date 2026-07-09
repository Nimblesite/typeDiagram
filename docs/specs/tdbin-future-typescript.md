# TDBIN TypeScript Codec Specification

> Status: implemented initial runtime + codegen for `[TDBIN-FUTURE-TS]`.
> Depends on: [tdbin-wire-format.md](tdbin-wire-format.md).

## Scope

`[TDBIN-FUTURE-TS]` adds a TypeScript TDBIN codec emitted by
`packages/typediagram` from the same typeDiagram model used by Rust codegen.

The implementation lives in:

- `packages/typediagram/src/tdbin/`: DataView/Uint8Array runtime for bare,
  framed, and packed framed messages.
- `packages/typediagram/src/converters/typescript-tdbin.ts`: typed
  `StructCodec<T>` code generator with baked record/union layout.
- `packages/typediagram/test/tdbin/golden.test.ts`: Rust golden-vector
  conformance for Person/Contact, including framed and packed framed decode.

## Requirements

- Generated TypeScript codecs MUST round-trip every Rust golden vector byte for
  byte. The initial conformance set covers the frozen Rust Person/Contact
  vectors.
- The hot path MUST use `DataView`/`Uint8Array` over structured reflection.
- Decode MUST return typed errors, not throw for malformed input.
- The implementation MUST support framed and packed messages before release.
- Browser and Node behavior MUST be identical.

## Acceptance

- Golden-vector conformance tests run in `packages/typediagram`.
- Cross-language fixtures prove Rust encode -> TypeScript decode -> Rust encode
  byte identity and the reverse.
- Bundle-size impact is measured and kept under the package budget.
