# TDBIN Future Reader Specification

> Status: roadmap spec for `[TDBIN-FUTURE-READER]`.
> Depends on: [tdbin-wire-format.md](tdbin-wire-format.md), [tdbin-rust-api.md](tdbin-rust-api.md).

## Scope

`[TDBIN-FUTURE-READER]` adds a verified zero-copy reader for generated Rust ADTs.
The reader verifies a framed message once, then exposes typed accessors that
borrow directly from the input bytes.

## Requirements

- Verification MUST run all `[TDBIN-SAFE-*]` checks before any accessor is
  constructed.
- Accessors MUST NOT allocate for scalar, enum, string, bytes, or pointer lookup.
- String accessors MUST return `&str` after `[TDBIN-SAFE-UTF8]` validation.
- Unknown union variants MUST remain typed errors carrying the ordinal.
- The existing materializing `TdBin::from_bytes` path MUST stay available.

## Acceptance

- Golden vectors are shared with the materializing reader.
- Tests cover valid access, invalid pointer targets, invalid UTF-8, unknown
  variants, depth limits, and packed framed messages.
- Benchmarks compare verify-once plus repeated accessor reads against
  materializing decode.
