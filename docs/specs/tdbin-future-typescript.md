# TDBIN TypeScript Codec Specification

> Status: partial implementation of `[TDBIN-FUTURE-TS]`; not release-conformant.
> Depends on: [tdbin-wire-format.md](tdbin-wire-format.md), [tdbin-rust-api.md](tdbin-rust-api.md), and the [implementation audit](../reports/tdbin-implementation-audit.md).

## Scope

`[TDBIN-FUTURE-TS]` adds a TypeScript TDBIN codec emitted by
`src/typediagram` from the same typeDiagram model used by Rust codegen.

The implementation lives in:

- `src/typediagram/src/tdbin/`: DataView/Uint8Array runtime for bare,
  framed, and packed framed messages.
- `src/typediagram/src/converters/typescript-tdbin.ts`: typed
  `StructCodec<T>` code generator with baked record/union layout.
- `src/typediagram/test/tdbin/golden.test.ts`: Rust golden-vector
  conformance for Person/Contact, including framed and packed framed decode.

## Requirements

- Generated TypeScript codecs MUST round-trip every Rust golden vector byte for
  byte. The initial hand-authored conformance set covers the frozen Rust
  Person/Contact vectors; release conformance requires generated modules over
  the complete corpus.
- The hot path MUST use `DataView`/`Uint8Array` over structured reflection.
- Decode MUST return typed errors, not throw for malformed input.
- The implementation MUST support framed and packed messages before release.
- `Int` MUST preserve the full signed 64-bit wire domain without converting
  through an unsafe JavaScript `number`.
- Generated normal framed decode MUST require its emitted compatibility-major
  layout hash. An unchecked generic runtime entry point may remain for tooling.
- Browser and Node behavior MUST be identical.

## Acceptance

- Golden-vector conformance tests run in `src/typediagram`.
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
- [x] Generated support for every layout-1 list form and scalar options
      ([TDBIN-TS-LIST]); a Rust-produced golden vector is reproduced byte for
      byte by the generated TypeScript codec.
- [ ] Generated support for semantic scalars, nested lists, maps, generics,
      and layout-2 columnar groups.
- [ ] Apply required-pointer null/default semantics consistently with the wire
      specification.
- [x] Generate the compatibility-major layout hash and require it during normal
      framed decode ([TDBIN-SCHEMA-HASH]): every generated codec carries
      `layoutHash`, identical to the Rust `LAYOUT_HASH` for the same schema;
      `encodeFramed`/`encodePackedFramed` advertise it; `decodeFramed` requires
      it (missing or different → `HashMismatch`); `decodeAuto` rejects a
      contradicting advertised hash.
- [x] Base64 framed helpers for JSON envelopes such as JSON-RPC/LSP
      ([TDBIN-FRAME-BASE64]): `encodeFramedBase64` emits a packed, hashed frame
      as standard base64; `decodeFramedBase64` returns `BadBase64`, `BadMagic`,
      `HashMismatch`, … as typed errors.
- [ ] Compile and execute generated codecs, run Rust-to-TypeScript-to-Rust byte
      identity in both directions, and cover browser as well as Node execution.
- [x] Measure and record bundle-size impact ([TDBIN-TS-BUNDLE]). Generated
      modules import only `typediagram-core/tdbin` (`ok` is re-exported there)
      and the package is `"sideEffects": false`, so esbuild tree-shakes the
      parser, layout, and renderer away. A three-type generated module (record,
      union, `Option` child) plus the base64 framed round-trip bundles to
      **18.5 KB minified / 6.3 KB gzipped** (esbuild `--bundle --minify`,
      ESM), with no elkjs or lezer code.

## Pickup order

1. **Create one shared layout plan.** Move record/union classification, scalar
   bit allocation, pointer slots, enum encoding class, list kind, and canonical
   manifest/hash derivation into a language-neutral converter module. Both
   `rust-tdbin.ts` and `typescript-tdbin.ts` consume that plan; neither emitter
   independently recomputes layout.
2. **Make the public value model lossless.** Represent TDBIN `Int` as `bigint`
   through generated types and codec helpers, with explicit range checks at the
   i64 boundary. Treat the generated TypeScript API change from `number` as a
   deliberate breaking change and update converter fixtures accordingly.
3. **Reach layout parity.** Emit inline enum-union fields and byte enum lists,
   one-bit scalar-option presence, semantic scalars, all list forms, nested
   options, records/unions, aliases, and monomorphized generics. Apply required
   pointer null/default behavior exactly as the wire spec states.
4. **Make schema checks automatic.** Emit the compatibility-major hash beside
   every generated root codec and generate framed encode/decode wrappers that
   pass it. Test missing, wrong, append-compatible, and breaking hashes.
5. **Test generated artifacts rather than source strings alone.** Generate a
   module from each corpus schema, compile it under strict TypeScript, execute
   both directions against Rust bytes in Node, and import the same built module
   in browser E2E. Retain source-shape assertions only as focused codegen tests.
6. **Measure shipping impact.** Run the package bundle gate with the runtime and
   representative generated module included, record the result in the
   generated/CI artifact that owns bundle measurements, and keep it within the
   existing budget.

## Completion evidence

- `npm exec -w typediagram-core -- vitest run test/tdbin test/converters/rust-tdbin.test.ts test/converters/typescript-tdbin.test.ts` passes with generated-module execution.
- The browser matrix exercises bare, framed, and packed-framed generated codecs
  and malformed/hash failures without Node-only globals.
- `cargo test -p tdbin` decodes TypeScript-produced fixtures and byte-identically
  re-encodes them; TypeScript does the reverse for every Rust golden vector.
- Full-range tests include `i64::MIN`, `i64::MAX`, values immediately outside
  JavaScript's safe-integer range, and rejected out-of-range `bigint` values.
- `make ci` and the bundle gate pass in one invocation. Only then may
  `[TDBIN-FUTURE-TS]` be checked in the implementation plan.
