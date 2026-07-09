//! Scalar <-> word bit conversions for data-section fields ([TDBIN-PRIM-MAP]).
//! Pure reinterpretation — no arithmetic, no `as` casts. Generated ADT code
//! calls these to fill and read scalar slots.

/// Encode a `bool` as a data word (low bit).
#[must_use]
pub fn bool_bits(value: bool) -> u64 {
    u64::from(value)
}

/// Decode a `bool` from a data word.
#[must_use]
pub fn bool_from(word: u64) -> bool {
    (word & 1) == 1
}

/// Encode an `i64` as its little-endian bit pattern.
#[must_use]
pub fn i64_bits(value: i64) -> u64 {
    u64::from_le_bytes(value.to_le_bytes())
}

/// Decode an `i64` from its little-endian bit pattern.
#[must_use]
pub fn i64_from(word: u64) -> i64 {
    i64::from_le_bytes(word.to_le_bytes())
}

/// Encode an `f64` as its IEEE-754 bit pattern.
#[must_use]
pub fn f64_bits(value: f64) -> u64 {
    value.to_bits()
}

/// Decode an `f64` from its IEEE-754 bit pattern.
#[must_use]
pub fn f64_from(word: u64) -> f64 {
    f64::from_bits(word)
}
