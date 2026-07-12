//! [TDBIN-PTR-LIST] [TDBIN-UNION-ENUM] [TDBIN-LIST-ELEM] / [TDBIN-LIST-RAW] / [TDBIN-LIST-COMPOSITE] runtime
//! coverage for generated-style list codecs.

use tdbin::{DecodeError, EncodeError, Reader, Struct, TdBin, Writer};

/// Boxed-error alias for fallible tests.
type TestResult = Result<(), Box<dyn std::error::Error>>;

/// Bytes per TDBIN word.
const WORD_BYTES: usize = 8;
/// List element-kind code for Bool lists.
const ELEM_BIT: u64 = 1;
/// List element-kind code for byte lists.
const ELEM_BYTE: u64 = 2;
/// List element-kind code for 64-bit raw lists.
const ELEM_EIGHT_BYTES: u64 = 5;
/// List element-kind code for pointer lists.
const ELEM_POINTER: u64 = 6;
/// List element-kind code for composite lists.
const ELEM_COMPOSITE: u64 = 7;

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

/// Element kind encoded in a list pointer.
fn elem_kind(word: u64) -> u64 {
    (word >> 32) & 0b111
}

/// Unsigned positive target of a forward list pointer in this test corpus.
fn forward_target(ptr_word: usize, word: u64) -> Result<usize, Box<dyn std::error::Error>> {
    let offset = usize::try_from((word >> 2) & 0x3FFF_FFFF)?;
    ptr_word
        .checked_add(1)
        .and_then(|base| base.checked_add(offset))
        .ok_or_else(|| "target overflow".into())
}

/// Generated-style child struct used in a composite list.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Point {
    /// X coordinate.
    x: i64,
    /// Y coordinate.
    y: i64,
}

impl Struct for Point {
    const DATA_WORDS: u16 = 2;
    const PTR_WORDS: u16 = 0;

    fn write_struct(&self, w: &mut Writer, at: usize) -> Result<(), EncodeError> {
        w.scalar(at, 0, tdbin::scalar::i64_bits(self.x))?;
        w.scalar(at, 1, tdbin::scalar::i64_bits(self.y))
    }

    fn read_struct(r: &Reader<'_>, at: usize) -> Result<Self, DecodeError> {
        let x = tdbin::scalar::i64_from(r.scalar(at, 0)?);
        let y = tdbin::scalar::i64_from(r.scalar(at, 1)?);
        Ok(Self { x, y })
    }
}

/// Generated-style enum-union encoded as one byte per list element.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Color {
    /// First ordinal.
    Red,
    /// Second ordinal.
    Green,
}

/// Generated-style record exercising every emitted list helper.
#[derive(Debug, Clone, PartialEq, Eq)]
struct ListFixture {
    /// Bit-packed booleans.
    flags: Vec<bool>,
    /// Raw 64-bit integer values.
    scores: Vec<i64>,
    /// Pointer-list string values.
    names: Vec<String>,
    /// Pointer-list byte values.
    blobs: Vec<Vec<u8>>,
    /// Composite child structs.
    points: Vec<Point>,
    /// Composite 16-byte semantic scalar words.
    tokens: Vec<(u64, u64)>,
    /// One-byte enum-list values.
    colors: Vec<Color>,
    /// Optional raw list.
    maybe_scores: Option<Vec<i64>>,
}

impl Struct for ListFixture {
    const DATA_WORDS: u16 = 0;
    const PTR_WORDS: u16 = 8;

    fn write_struct(&self, w: &mut Writer, at: usize) -> Result<(), EncodeError> {
        let scores = self
            .scores
            .iter()
            .map(|value| tdbin::scalar::i64_bits(*value))
            .collect::<Vec<_>>();
        let colors = self.colors.iter().map(color_ordinal).collect::<Vec<_>>();
        let maybe_scores = self.maybe_scores.as_ref().map(|values| {
            values
                .iter()
                .map(|value| tdbin::scalar::i64_bits(*value))
                .collect::<Vec<_>>()
        });
        w.bool_list(at, Self::DATA_WORDS, 0, Some(&self.flags))?;
        w.word_list(at, Self::DATA_WORDS, 1, Some(&scores))?;
        w.string_list(at, Self::DATA_WORDS, 2, Some(&self.names))?;
        w.bytes_list(at, Self::DATA_WORDS, 3, Some(&self.blobs))?;
        w.child_list(at, Self::DATA_WORDS, 4, Some(&self.points))?;
        w.bytes16_list(at, Self::DATA_WORDS, 5, Some(&self.tokens))?;
        w.byte_list(at, Self::DATA_WORDS, 6, Some(&colors))?;
        w.word_list(at, Self::DATA_WORDS, 7, maybe_scores.as_deref())
    }

    fn read_struct(r: &Reader<'_>, at: usize) -> Result<Self, DecodeError> {
        let flags = r.bool_list(at, Self::DATA_WORDS, 0)?.unwrap_or_default();
        let scores = words_to_i64(r.word_list(at, Self::DATA_WORDS, 1)?.unwrap_or_default());
        let names = r.string_list(at, Self::DATA_WORDS, 2)?.unwrap_or_default();
        let blobs = r.bytes_list(at, Self::DATA_WORDS, 3)?.unwrap_or_default();
        let points = r
            .child_list::<Point>(at, Self::DATA_WORDS, 4)?
            .unwrap_or_default();
        let tokens = r.bytes16_list(at, Self::DATA_WORDS, 5)?.unwrap_or_default();
        let colors = bytes_to_colors(r.byte_list(at, Self::DATA_WORDS, 6)?.unwrap_or_default())?;
        let maybe_scores = r.word_list(at, Self::DATA_WORDS, 7)?.map(words_to_i64);
        Ok(Self {
            flags,
            scores,
            names,
            blobs,
            points,
            tokens,
            colors,
            maybe_scores,
        })
    }
}

/// Map a generated enum value to its one-byte ordinal.
fn color_ordinal(color: &Color) -> u8 {
    match color {
        Color::Red => 0,
        Color::Green => 1,
    }
}

/// Decode generated enum-list ordinals, rejecting unknown values.
fn bytes_to_colors(values: Vec<u8>) -> Result<Vec<Color>, DecodeError> {
    values
        .into_iter()
        .map(|ordinal| match ordinal {
            0 => Ok(Color::Red),
            1 => Ok(Color::Green),
            ordinal => Err(DecodeError::UnknownVariant {
                ordinal: u64::from(ordinal),
            }),
        })
        .collect()
}

/// Decode raw integer words.
fn words_to_i64(values: Vec<u64>) -> Vec<i64> {
    values.into_iter().map(tdbin::scalar::i64_from).collect()
}

/// A fixture with non-empty values in every list form.
fn fixture() -> ListFixture {
    ListFixture {
        flags: vec![true, false, true, true, false, false, true, false, true],
        scores: vec![7, -8, 9],
        names: vec!["ada".to_owned(), String::new(), "alan".to_owned()],
        blobs: vec![vec![1, 2, 3], Vec::new(), vec![4, 5]],
        points: vec![Point { x: 1, y: 2 }, Point { x: -3, y: 4 }],
        tokens: vec![(0x0102, 0x0304), (0x0506, 0x0708)],
        colors: vec![Color::Red, Color::Green, Color::Red],
        maybe_scores: Some(vec![10, 11]),
    }
}

/// Lists round-trip through every runtime helper.
#[test]
fn list_forms_round_trip() -> TestResult {
    let value = fixture();
    let bytes = value.to_bytes()?;
    assert_eq!(ListFixture::from_bytes(&bytes)?, value);
    assert_eq!(ListFixture::from_bytes(&bytes)?.to_bytes()?, bytes);
    Ok(())
}

/// Pointer element kinds and the composite tag word match the wire spec.
#[test]
fn list_element_kinds_and_composite_tag_are_encoded() -> TestResult {
    let bytes = fixture().to_bytes()?;
    assert_eq!(elem_kind(read_word(&bytes, 1)?), ELEM_BIT);
    assert_eq!(elem_kind(read_word(&bytes, 2)?), ELEM_EIGHT_BYTES);
    assert_eq!(elem_kind(read_word(&bytes, 3)?), ELEM_POINTER);
    assert_eq!(elem_kind(read_word(&bytes, 4)?), ELEM_POINTER);
    let point_ptr = read_word(&bytes, 5)?;
    assert_eq!(elem_kind(point_ptr), ELEM_COMPOSITE);
    assert_eq!(elem_kind(read_word(&bytes, 6)?), ELEM_COMPOSITE);
    assert_eq!(elem_kind(read_word(&bytes, 7)?), ELEM_BYTE);
    let tag = read_word(&bytes, forward_target(5, point_ptr)?)?;
    assert_eq!(tag & 0b11, 0);
    assert_eq!((tag >> 2) & 0x3FFF_FFFF, 2);
    assert_eq!((tag >> 32) & 0xFFFF, 2);
    assert_eq!((tag >> 48) & 0xFFFF, 0);
    Ok(())
}

/// Missing list pointer slots decode as default empty lists or `None`.
#[test]
fn null_list_pointer_decodes_to_default_or_none() -> TestResult {
    let mut bytes = fixture().to_bytes()?;
    for word_index in [1_usize, 8] {
        let start = word_index
            .checked_mul(WORD_BYTES)
            .ok_or("word offset overflow")?;
        let end = start.checked_add(WORD_BYTES).ok_or("word end overflow")?;
        bytes
            .get_mut(start..end)
            .ok_or("word out of bounds")?
            .fill(0);
    }
    let decoded = ListFixture::from_bytes(&bytes)?;
    assert_eq!(decoded.flags, Vec::<bool>::new());
    assert_eq!(decoded.maybe_scores, None);
    Ok(())
}

/// One-byte enum lists reject ordinals with no declared variant.
#[test]
fn enum_list_rejects_unknown_one_byte_ordinal() -> TestResult {
    let mut bytes = fixture().to_bytes()?;
    let color_ptr = read_word(&bytes, 7)?;
    let color_start_word = forward_target(7, color_ptr)?;
    let color_start = color_start_word
        .checked_mul(WORD_BYTES)
        .ok_or("byte offset overflow")?;
    let slot = bytes
        .get_mut(color_start)
        .ok_or("color byte out of bounds")?;
    *slot = 9;
    assert_eq!(
        ListFixture::from_bytes(&bytes),
        Err(DecodeError::UnknownVariant { ordinal: 9 })
    );
    Ok(())
}
