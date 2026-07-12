//! Pointer words: the fixed 64-bit descriptors linking a struct to its
//! children ([TDBIN-PTR-STRUCT], [TDBIN-PTR-LIST], [TDBIN-PTR-NULL]). No
//! `as` casts and only constant-amount shifts, so nothing here can panic.

use crate::error::{DecodeError, EncodeError};

/// Kind bits for a struct pointer.
const KIND_STRUCT: u64 = 0;
/// Kind bits for a list pointer.
const KIND_LIST: u64 = 1;
/// Two-bit mask selecting the pointer kind.
const KIND_MASK: u64 = 0b11;
/// List element-kind code for a bit list (`List<Bool>`).
pub(crate) const ELEM_BIT: u8 = 1;
/// List element-kind code for a byte list (String / Bytes / enum lists).
pub(crate) const ELEM_BYTE: u8 = 2;
/// List element-kind code for a two-byte raw list ([TDBIN-COL-VAR] lengths).
pub(crate) const ELEM_TWO_BYTES: u8 = 3;
/// List element-kind code for a four-byte raw list ([TDBIN-COL-VAR] lengths).
pub(crate) const ELEM_FOUR_BYTES: u8 = 4;
/// List element-kind code for an eight-byte raw list.
pub(crate) const ELEM_EIGHT_BYTES: u8 = 5;
/// List element-kind code for a pointer list.
pub(crate) const ELEM_POINTER: u8 = 6;
/// List element-kind code for a composite list.
pub(crate) const ELEM_COMPOSITE: u8 = 7;
/// Most negative offset expressible in the signed 30-bit field.
const OFFSET_MIN: i64 = -(1 << 29);
/// Most positive offset expressible in the signed 30-bit field.
const OFFSET_MAX: i64 = (1 << 29) - 1;
/// Mask for the 30-bit offset field.
const OFFSET_MASK: u64 = 0x3FFF_FFFF;
/// Sign bit within the 30-bit offset field.
const OFFSET_SIGN: u64 = 1 << 29;
/// Value subtracted to sign-extend a negative 30-bit offset.
const OFFSET_SPAN: i64 = 1 << 30;
/// Largest element count expressible in the 29-bit list count field.
const COUNT_MAX: u64 = 0x1FFF_FFFF;
/// Low-16-bit mask for a struct section size.
const SECTION_MASK: u64 = 0xFFFF;
/// Three-bit mask for a list element-kind code.
const ELEM_MASK: u64 = 0b111;

/// A decoded pointer word.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Pointer {
    /// All-zero word: a default / absent value ([TDBIN-PTR-NULL]).
    Null,
    /// Struct pointer with a relative offset and section sizes.
    Struct {
        /// Signed word offset from the end of the pointer word to the target.
        offset: i64,
        /// Data-section word count of the target struct.
        data_words: u16,
        /// Pointer-section word count of the target struct.
        ptr_words: u16,
    },
    /// List pointer with a relative offset, element kind, and element count.
    List {
        /// Signed word offset from the end of the pointer word to the target.
        offset: i64,
        /// Element-kind code.
        elem: u8,
        /// Number of elements.
        count: u32,
    },
}

/// Encode the low 30 bits of a signed offset, validating range.
fn offset_bits(offset: i64) -> Result<u64, EncodeError> {
    if (OFFSET_MIN..=OFFSET_MAX).contains(&offset) {
        Ok(u64::from_le_bytes(offset.to_le_bytes()) & OFFSET_MASK)
    } else {
        Err(EncodeError::OffsetOutOfRange)
    }
}

/// Encode a struct pointer word ([TDBIN-PTR-STRUCT]).
pub(crate) fn encode_struct(
    offset: i64,
    data_words: u16,
    ptr_words: u16,
) -> Result<u64, EncodeError> {
    let bits = offset_bits(offset)?;
    Ok(KIND_STRUCT | (bits << 2) | (u64::from(data_words) << 32) | (u64::from(ptr_words) << 48))
}

/// Encode a list pointer word ([TDBIN-PTR-LIST]).
pub(crate) fn encode_list(offset: i64, elem: u8, count: usize) -> Result<u64, EncodeError> {
    let elems = u64::try_from(count).map_err(|_| EncodeError::LimitExceeded)?;
    if elems > COUNT_MAX {
        Err(EncodeError::LimitExceeded)
    } else {
        let bits = offset_bits(offset)?;
        Ok(KIND_LIST | (bits << 2) | (u64::from(elem) << 32) | (elems << 35))
    }
}

/// Sign-extend a 30-bit offset (already right-shifted into the low bits).
fn sign_extend(shifted: u64) -> Result<i64, DecodeError> {
    let masked = shifted & OFFSET_MASK;
    let base = i64::try_from(masked).map_err(|_| DecodeError::ReservedPointerKind)?;
    match masked & OFFSET_SIGN {
        0 => Ok(base),
        _ => base
            .checked_sub(OFFSET_SPAN)
            .ok_or(DecodeError::ReservedPointerKind),
    }
}

/// Extract a 16-bit section size from an already-shifted word.
fn section(shifted: u64) -> u16 {
    // Masked to 16 bits, so the conversion never fails.
    u16::try_from(shifted & SECTION_MASK).unwrap_or(0)
}

/// Decode a pointer word into its structured form.
pub(crate) fn decode(word: u64) -> Result<Pointer, DecodeError> {
    match word {
        0 => Ok(Pointer::Null),
        _ => decode_nonnull(word),
    }
}

/// Decode a known-nonzero pointer word.
fn decode_nonnull(word: u64) -> Result<Pointer, DecodeError> {
    let offset = sign_extend(word >> 2)?;
    match word & KIND_MASK {
        KIND_STRUCT => Ok(Pointer::Struct {
            offset,
            data_words: section(word >> 32),
            ptr_words: section(word >> 48),
        }),
        KIND_LIST => Ok(decode_list(word, offset)),
        _ => Err(DecodeError::ReservedPointerKind),
    }
}

/// Decode the element kind and count of a list pointer.
fn decode_list(word: u64, offset: i64) -> Pointer {
    // Both fields are masked below their type widths, so conversion is exact.
    let elem = u8::try_from((word >> 32) & ELEM_MASK).unwrap_or(0);
    let count = u32::try_from((word >> 35) & COUNT_MAX).unwrap_or(0);
    Pointer::List {
        offset,
        elem,
        count,
    }
}
