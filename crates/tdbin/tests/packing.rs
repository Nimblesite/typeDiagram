//! [TDBIN-REC-XOR] / [TDBIN-ENC-ZERO] runtime checks for generated-style
//! bit/word packing behavior.

use tdbin::{DecodeError, EncodeError, Reader, Struct, TdBin, Writer};

/// Boxed-error alias for fallible tests.
type TestResult = Result<(), Box<dyn std::error::Error>>;

/// Bytes per TDBIN word.
const WORD_BYTES: usize = 8;

/// Read one little-endian word from a canonical TDBIN byte message.
fn read_word(bytes: &[u8], word_index: usize) -> Result<u64, Box<dyn std::error::Error>> {
    let start = word_index
        .checked_mul(WORD_BYTES)
        .ok_or("word offset overflow")?;
    let end = start.checked_add(WORD_BYTES).ok_or("word end overflow")?;
    let raw = bytes.get(start..end).ok_or("word out of bounds")?;
    let word = <[u8; WORD_BYTES]>::try_from(raw).map_err(|_| "word slice length")?;
    Ok(u64::from_le_bytes(word))
}

/// Generated-style record with three Bool fields sharing one data word.
#[derive(Debug, PartialEq, Eq)]
struct PackedFlags {
    /// First packed Bool.
    a: bool,
    /// Second packed Bool.
    b: bool,
    /// Third packed Bool.
    c: bool,
    /// A word-aligned scalar after the Bool bitset.
    count: i64,
}

impl Struct for PackedFlags {
    const DATA_WORDS: u16 = 2;
    const PTR_WORDS: u16 = 0;

    fn write_struct(&self, w: &mut Writer, at: usize) -> Result<(), EncodeError> {
        w.bool_bit(at, 0, 0, self.a)?;
        w.bool_bit(at, 0, 1, self.b)?;
        w.bool_bit(at, 0, 2, self.c)?;
        w.scalar(at, 1, tdbin::scalar::i64_bits(self.count))
    }

    fn read_struct(r: &Reader<'_>, at: usize) -> Result<Self, DecodeError> {
        let a = r.bool_bit(at, 0, 0)?;
        let b = r.bool_bit(at, 0, 1)?;
        let c = r.bool_bit(at, 0, 2)?;
        let count = tdbin::scalar::i64_from(r.scalar(at, 1)?);
        Ok(Self { a, b, c, count })
    }
}

/// Generated-style mixed union with a bare variant and a string variant.
#[derive(Debug, PartialEq, Eq)]
enum MaybeText {
    /// String payload variant.
    Text(String),
    /// Bare variant, which must leave the inactive pointer slot zero.
    Empty,
}

impl Struct for MaybeText {
    const DATA_WORDS: u16 = 1;
    const PTR_WORDS: u16 = 1;

    fn write_struct(&self, w: &mut Writer, at: usize) -> Result<(), EncodeError> {
        match self {
            Self::Text(text) => {
                w.scalar(at, 0, 0)?;
                w.string(at, Self::DATA_WORDS, 0, Some(text))
            }
            Self::Empty => {
                w.scalar(at, 0, 1)?;
                Ok(())
            }
        }
    }

    fn read_struct(r: &Reader<'_>, at: usize) -> Result<Self, DecodeError> {
        match r.scalar(at, 0)? {
            0 => Ok(Self::Text(
                r.string(at, Self::DATA_WORDS, 0)?
                    .ok_or(DecodeError::UnexpectedNull)?,
            )),
            1 => Ok(Self::Empty),
            ordinal => Err(DecodeError::UnknownVariant { ordinal }),
        }
    }
}

/// [TDBIN-REC-XOR] Direct Bool fields pack into one word, and zero defaults
/// remain zero words that `[TDBIN-PACK]` can remove.
#[test]
fn bool_fields_share_one_word_and_zero_defaults_pack_cleanly() -> TestResult {
    let value = PackedFlags {
        a: true,
        b: false,
        c: true,
        count: 0,
    };
    let bytes = value.to_bytes()?;
    assert_eq!(PackedFlags::from_bytes(&bytes)?, value);
    assert_eq!(read_word(&bytes, 1)?, 0b101);
    assert_eq!(read_word(&bytes, 2)?, 0);
    assert!(tdbin::pack::encode(&bytes)?.len() < bytes.len());
    Ok(())
}

/// [TDBIN-ENC-ZERO] Inactive union pointer slots stay zero because writers
/// reserve zeroed words before variant-specific writes.
#[test]
fn bare_union_variant_leaves_inactive_pointer_slot_zero() -> TestResult {
    let bytes = MaybeText::Empty.to_bytes()?;
    assert_eq!(MaybeText::from_bytes(&bytes)?, MaybeText::Empty);
    assert_eq!(read_word(&bytes, 2)?, 0);
    Ok(())
}

/// [TDBIN-PRIM-MAP] 16-byte semantic scalar helpers preserve byte order exactly.
#[test]
fn semantic_scalar_words_round_trip_sixteen_bytes() {
    let bytes = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
    let (first, second) = tdbin::scalar::bytes16_words(&bytes);
    assert_eq!(tdbin::scalar::bytes16_from_words(first, second), bytes);
}
