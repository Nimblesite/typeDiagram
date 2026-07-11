# TDBIN Future Reader Specification

> **Status:** NOT IMPLEMENTED; highest-priority Rust performance track after v1 wire-conformance blockers. The structural verifier prerequisite exists, but current decode still eagerly materializes ADTs.
> Depends on: [tdbin-wire-format.md](tdbin-wire-format.md), [tdbin-rust-api.md](tdbin-rust-api.md), and the [implementation audit](../reports/tdbin-implementation-audit.md).

## Scope

`[TDBIN-FUTURE-READER]` adds generated verify-once views for Rust ADTs. An
unpacked message is structurally verified once, then typed accessors borrow
scalars and payload slices directly from the verified body. This implements the
research path that the current materializing reader stops short of.

Packed bytes cannot be borrowed as random-access words. Packed-framed input
MUST first unpack into one bounded owned arena; views then borrow that arena.
The API and benchmarks MUST distinguish this owned-unpack cost from true
zero-copy access to bare or unpacked-framed bodies.

## API shape

The implementation may refine names, but it MUST preserve these ownership
boundaries:

```rust
pub struct VerifiedMessage<'wire> { /* verified borrowed word body */ }
pub struct VerifiedPackedMessage { /* bounded owned unpack arena */ }
pub trait View<'wire>: Sized {
    fn from_verified(message: &'wire VerifiedMessage<'wire>) -> Result<Self, DecodeError>;
}
```

- Verification constructs the proof-bearing message. Generated views cannot be
  constructed from an arbitrary `&[u8]` or an unverified `Reader`.
- `VerifiedPackedMessage` exposes a verified borrowed message/view whose
  lifetime is tied to the owned arena, so no accessor can outlive unpacked data.
- Each generated record view exposes field accessors; each generated union view
  exposes a checked discriminant and variant-specific payload views.
- The existing materializing `TdBin::from_bytes` and framed APIs remain
  available and may be implemented by walking the generated view.

## Requirements

- Verification MUST run all `[TDBIN-SAFE-*]` checks, including UTF-8, inactive
  union pointer slots, depth, and amplification, before any view is returned.
- Accessors MUST NOT repeat the whole-message traversal or pointer validation.
  Schema-specific kind/section checks may occur once when constructing a nested
  view.
- Accessors MUST NOT allocate for scalar, enum, string, bytes, list length, or
  pointer lookup. Strings return `&str`; bytes return `&[u8]`; fixed-width scalar
  lists expose an iterator or borrowed view without materializing `Vec<T>`.
- Unknown union variants MUST remain typed errors carrying the ordinal. A view
  MUST never expose inactive payload storage as a live variant.
- Verification and access remain total, bounds-checked, and free of `unsafe`.
- Generated views MUST use the same compatibility-major layout hash as the
  materializing codec.

## Implementation stages

1. Split frame parsing/unpacking from structural verification and return a
   proof-bearing verified body without changing wire bytes.
2. Generate borrowed views for scalars, strings/bytes, child records, and
   struct-unions; implement materialization through those views to prevent two
   decoding rule sets.
3. Add borrowed bit/raw-word/pointer/composite-list views and zero-stride list
   handling.
4. Add the owned packed wrapper and expose unpack, verify, and traversal timing
   separately in benchmarks.
5. Profile the production corpus. Consider a fused packed traversal only if the
   retained profile shows it beats the bounded arena design.

## Acceptance

- Reuse every materializing golden and adversarial vector; both paths return the
  same values/errors and enforce the same expected layout hash.
- Add compile-fail lifetime coverage proving views cannot outlive borrowed or
  unpacked storage.
- Allocation instrumentation proves repeated scalar/string/bytes/list access on
  a verified unpacked message allocates zero bytes.
- Benchmarks report verification once, first traversal, and repeated traversal
  separately for bare, framed, and packed-framed inputs, against materializing
  TDBIN and `prost` decode.
- `cargo test -p tdbin`, deny-all Clippy, `make bench`, and the full v1
  conformance/traceability gates pass before this roadmap item is checked.
