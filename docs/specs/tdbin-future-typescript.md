# TDBIN Future TypeScript Codec Specification

> Status: roadmap spec for `[TDBIN-FUTURE-TS]`.
> Depends on: [tdbin-wire-format.md](tdbin-wire-format.md).

## Scope

`[TDBIN-FUTURE-TS]` adds a TypeScript TDBIN codec emitted by
`packages/typediagram` from the same typeDiagram model used by Rust codegen.

## Requirements

- Generated TypeScript codecs MUST round-trip every Rust golden vector byte for
  byte.
- The hot path MUST use `DataView`/`Uint8Array` over structured reflection.
- Decode MUST return typed errors, not throw for malformed input.
- The implementation MUST support framed and packed messages before release.
- Browser and Node behavior MUST be identical.

## Acceptance

- Golden-vector conformance tests run in `packages/typediagram`.
- Cross-language fixtures prove Rust encode -> TypeScript decode -> Rust encode
  byte identity and the reverse.
- Bundle-size impact is measured and kept under the package budget.
