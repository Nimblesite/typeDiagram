# TDBIN TypeScript Codec Specification

> Status: partial implementation of `[TDBIN-FUTURE-TS]`; not release-conformant.
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

## Implementation Status

- [x] Bare, framed, and packed-framed runtime paths use `DataView` and
      `Uint8Array`.
- [x] Structural verification, depth limits, amplification limits, inactive
      union slot checks, and explicit expected-hash checks return typed errors.
- [x] Focused runtime and hand-authored Rust golden-vector tests pass in Node.
- [ ] Preserve the full signed 64-bit `Int` domain. The current public value
      model is limited to JavaScript safe integers instead of using `bigint` or an
      equivalent lossless representation.
- [ ] Emit enum-unions as inline discriminant scalars, including
      `List<enum-union>`, rather than pointer child structs.
- [ ] Complete generated support for lists, semantic scalars, scalar options,
      generics, and every Rust codegen schema form.
- [ ] Apply required-pointer null/default semantics consistently with the wire
      specification.
- [ ] Generate the compatibility-major layout hash and require it during normal
      framed decode; the current API only checks a caller-supplied expected hash.
- [ ] Compile and execute generated codecs, run Rust-to-TypeScript-to-Rust byte
      identity in both directions, and cover browser as well as Node execution.
- [ ] Measure and record bundle-size impact.
