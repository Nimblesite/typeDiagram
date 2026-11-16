//! Shared word/offset arithmetic used by both the encoder and decoder,
//! so the pointer math lives in exactly one place ([TDBIN-ENC-ORDER]).

use crate::error::DecodeError;

/// Bytes per word ([TDBIN-WIRE-WORD]).
pub(crate) const WORD_BYTES: usize = 8;

/// Absolute word index of pointer `slot` in a struct whose data section
/// starts at `at`. `None` on overflow.
pub(crate) fn ptr_word(at: usize, data_words: u16, slot: usize) -> Option<usize> {
    at.checked_add(usize::from(data_words))?.checked_add(slot)
}

/// Resolve a relative pointer offset to an absolute word index. `None` on
/// overflow or a negative result ([TDBIN-SAFE-BOUNDS]).
pub(crate) fn target(ptr_word_index: usize, offset: i64) -> Option<usize> {
    let base = i64::try_from(ptr_word_index.checked_add(1)?).ok()?;
    usize::try_from(base.checked_add(offset)?).ok()
}

/// Read the little-endian 64-bit word at `idx`, bounds-checked.
pub(crate) fn read_word(bytes: &[u8], idx: usize) -> Result<u64, DecodeError> {
    let start = idx
        .checked_mul(WORD_BYTES)
        .ok_or(DecodeError::PointerOutOfBounds { word_index: idx })?;
    let end = start
        .checked_add(WORD_BYTES)
        .ok_or(DecodeError::PointerOutOfBounds { word_index: idx })?;
    let slice = bytes
        .get(start..end)
        .ok_or(DecodeError::PointerOutOfBounds { word_index: idx })?;
    let arr = <[u8; WORD_BYTES]>::try_from(slice)
        .map_err(|_| DecodeError::PointerOutOfBounds { word_index: idx })?;
    Ok(u64::from_le_bytes(arr))
}
