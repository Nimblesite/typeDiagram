//! Scalar <-> word bit conversions for data-section fields ([TDBIN-PRIM-MAP]).
//! Pure reinterpretation — no arithmetic, no `as` casts. Generated ADT code
//! calls these to fill and read scalar slots.

use crate::error::{DecodeError, EncodeError};

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

// [TDBIN-WIDTH-RANGE] Width-refined integers occupy one data word like `Int`;
// signed widths store the i64 bit pattern, unsigned widths the raw value. Encode
// is lossless by construction; decode narrows and fails typed, never truncates.

/// Encode an `i32` as the bit pattern of the equal `i64`.
#[must_use]
pub fn i32_bits(value: i32) -> u64 {
    i64_bits(i64::from(value))
}

/// Decode an `i32`, rejecting words outside its range.
///
/// # Errors
/// Returns [`DecodeError::ValueOutOfRange`] when the word does not fit.
pub fn i32_from(word: u64) -> Result<i32, DecodeError> {
    i32::try_from(i64_from(word)).map_err(|_| DecodeError::ValueOutOfRange)
}

/// Emit the `*_bits` / checked `*_from` pair for one unsigned width.
macro_rules! unsigned_width {
    ($bits:ident, $from:ident, $t:ty) => {
        #[doc = concat!("Encode a `", stringify!($t), "` as its unsigned value.")]
        #[must_use]
        pub fn $bits(value: $t) -> u64 {
            u64::from(value)
        }

        #[doc = concat!("Decode a `", stringify!($t), "`, rejecting words outside its range.")]
        ///
        /// # Errors
        /// Returns [`DecodeError::ValueOutOfRange`] when the word does not fit.
        pub fn $from(word: u64) -> Result<$t, DecodeError> {
            <$t>::try_from(word).map_err(|_| DecodeError::ValueOutOfRange)
        }
    };
}

unsigned_width!(u8_bits, u8_from, u8);
unsigned_width!(u16_bits, u16_from, u16);
unsigned_width!(u32_bits, u32_from, u32);

/// Encode a `u64` (identity: the word is the value).
#[must_use]
pub fn u64_bits(value: u64) -> u64 {
    value
}

/// Decode a `u64` (identity).
#[must_use]
pub fn u64_from(word: u64) -> u64 {
    word
}

/// Encode a `usize` as a `u64`. Every supported target has `usize` ≤ 64 bits,
/// so the conversion is exact.
#[must_use]
pub fn usize_bits(value: usize) -> u64 {
    u64::try_from(value).unwrap_or(u64::MAX)
}

/// Decode a `usize`, rejecting words this target cannot address.
///
/// # Errors
/// Returns [`DecodeError::ValueOutOfRange`] when the word does not fit.
pub fn usize_from(word: u64) -> Result<usize, DecodeError> {
    usize::try_from(word).map_err(|_| DecodeError::ValueOutOfRange)
}

/// [TDBIN-WIDTH-PATH] A `Path` is a UTF-8 `String` on the wire.
///
/// # Errors
/// Returns [`EncodeError::NonUtf8Path`] when the path is not valid UTF-8.
pub fn path_str(path: &std::path::Path) -> Result<&str, EncodeError> {
    path.to_str().ok_or(EncodeError::NonUtf8Path)
}

/// Owned form of [`path_str`], for `List<Path>`.
///
/// # Errors
/// Returns [`EncodeError::NonUtf8Path`] when the path is not valid UTF-8.
pub fn path_string(path: &std::path::Path) -> Result<String, EncodeError> {
    path_str(path).map(str::to_owned)
}
