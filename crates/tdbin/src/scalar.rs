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

/// Split a 16-byte semantic scalar into two little-endian words.
#[must_use]
pub const fn bytes16_words(bytes: &[u8; 16]) -> (u64, u64) {
    let [b0, b1, b2, b3, b4, b5, b6, b7, b8, b9, b10, b11, b12, b13, b14, b15] = *bytes;
    (
        u64::from_le_bytes([b0, b1, b2, b3, b4, b5, b6, b7]),
        u64::from_le_bytes([b8, b9, b10, b11, b12, b13, b14, b15]),
    )
}

/// Join two little-endian words into a 16-byte semantic scalar.
#[must_use]
pub const fn bytes16_from_words(first: u64, second: u64) -> [u8; 16] {
    let [a0, a1, a2, a3, a4, a5, a6, a7] = first.to_le_bytes();
    let [b0, b1, b2, b3, b4, b5, b6, b7] = second.to_le_bytes();
    [
        a0, a1, a2, a3, a4, a5, a6, a7, b0, b1, b2, b3, b4, b5, b6, b7,
    ]
}
