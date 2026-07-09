//! The word-arena encoder: preorder allocation with in-message back-patching
//! ([TDBIN-ENC-ORDER]). Generated ADT code calls the public methods; the
//! private helpers keep the pointer math in one place.

use crate::error::EncodeError;
use crate::layout::{self, WORD_BYTES};
use crate::pointer::{self, ELEM_BYTE};
use crate::Struct;

/// Upper bound on message body words (a safety cap for the encoder).
const MAX_WORDS: usize = 1 << 26;
/// Bytes packed per word when laying out a byte list.
const BYTES_PER_WORD: usize = WORD_BYTES;

/// Accumulates message body words while encoding a value tree.
#[derive(Debug)]
pub struct Writer {
    /// The message body, one entry per 8-byte word.
    body: Vec<u64>,
}

impl Writer {
    /// Create an empty writer.
    fn new() -> Self {
        Self { body: Vec::new() }
    }

    /// Encode a root value into a complete message ([TDBIN-MSG-BARE]).
    ///
    /// # Errors
    /// Returns [`EncodeError`] if the value exceeds a wire-format limit.
    pub(crate) fn message<T: Struct>(value: &T) -> Result<Vec<u8>, EncodeError> {
        let mut writer = Self::new();
        let _root = writer.reserve(1)?;
        let words = T::body_words().ok_or(EncodeError::LimitExceeded)?;
        let root_at = writer.reserve(words)?;
        value.write_struct(&mut writer, root_at)?;
        let offset = rel_offset(root_at, 0)?;
        let ptr = pointer::encode_struct(offset, T::DATA_WORDS, T::PTR_WORDS)?;
        writer.set(0, ptr)?;
        Ok(writer.into_bytes())
    }

    /// Reserve `words` zeroed words, returning the start index.
    fn reserve(&mut self, words: usize) -> Result<usize, EncodeError> {
        let start = self.body.len();
        let end = start.checked_add(words).ok_or(EncodeError::LimitExceeded)?;
        if end > MAX_WORDS {
            Err(EncodeError::LimitExceeded)
        } else {
            self.body.resize(end, 0);
            Ok(start)
        }
    }

    /// Overwrite the word at absolute index `idx`.
    fn set(&mut self, idx: usize, value: u64) -> Result<(), EncodeError> {
        let cell = self.body.get_mut(idx).ok_or(EncodeError::LimitExceeded)?;
        *cell = value;
        Ok(())
    }

    /// Write a scalar into data `slot` of the struct at `at` ([TDBIN-REC-ALLOC]).
    ///
    /// # Errors
    /// Returns [`EncodeError`] if the slot index overflows.
    pub fn scalar(&mut self, at: usize, slot: u16, bits: u64) -> Result<(), EncodeError> {
        let idx = at
            .checked_add(usize::from(slot))
            .ok_or(EncodeError::LimitExceeded)?;
        self.set(idx, bits)
    }

    /// Write an optional UTF-8 string into pointer `slot` ([TDBIN-PRIM-MAP]).
    ///
    /// # Errors
    /// Returns [`EncodeError`] if the message exceeds a wire-format limit.
    pub fn string(
        &mut self,
        at: usize,
        data_words: u16,
        slot: u16,
        value: Option<&str>,
    ) -> Result<(), EncodeError> {
        let ptr_word = Self::ptr_index(at, data_words, slot)?;
        match value {
            None => self.set(ptr_word, 0),
            Some(text) => self.write_byte_list(ptr_word, text.as_bytes()),
        }
    }

    /// Write optional raw bytes into pointer `slot` ([TDBIN-PRIM-MAP]).
    ///
    /// # Errors
    /// Returns [`EncodeError`] if the message exceeds a wire-format limit.
    pub fn bytes(
        &mut self,
        at: usize,
        data_words: u16,
        slot: u16,
        value: Option<&[u8]>,
    ) -> Result<(), EncodeError> {
        let ptr_word = Self::ptr_index(at, data_words, slot)?;
        match value {
            None => self.set(ptr_word, 0),
            Some(raw) => self.write_byte_list(ptr_word, raw),
        }
    }

    /// Write an optional child struct into pointer `slot` ([TDBIN-PTR-STRUCT]).
    ///
    /// # Errors
    /// Returns [`EncodeError`] if the message exceeds a wire-format limit.
    pub fn child<C: Struct>(
        &mut self,
        at: usize,
        data_words: u16,
        slot: u16,
        value: Option<&C>,
    ) -> Result<(), EncodeError> {
        let ptr_word = Self::ptr_index(at, data_words, slot)?;
        match value {
            None => self.set(ptr_word, 0),
            Some(child) => self.write_child(ptr_word, child),
        }
    }

    /// Absolute word index of pointer `slot`.
    fn ptr_index(at: usize, data_words: u16, slot: u16) -> Result<usize, EncodeError> {
        layout::ptr_word(at, data_words, usize::from(slot)).ok_or(EncodeError::LimitExceeded)
    }

    /// Append a child struct body and patch its pointer word.
    fn write_child<C: Struct>(&mut self, ptr_word: usize, child: &C) -> Result<(), EncodeError> {
        let words = C::body_words().ok_or(EncodeError::LimitExceeded)?;
        let child_at = self.reserve(words)?;
        child.write_struct(self, child_at)?;
        let offset = rel_offset(child_at, ptr_word)?;
        let ptr = pointer::encode_struct(offset, C::DATA_WORDS, C::PTR_WORDS)?;
        self.set(ptr_word, ptr)
    }

    /// Append a byte-list body and patch its list pointer word.
    fn write_byte_list(&mut self, ptr_word: usize, data: &[u8]) -> Result<(), EncodeError> {
        let words = data
            .len()
            .checked_add(BYTES_PER_WORD - 1)
            .ok_or(EncodeError::LimitExceeded)?
            >> 3;
        let start = self.reserve(words)?;
        self.pack_bytes(start, data)?;
        let offset = rel_offset(start, ptr_word)?;
        let ptr = pointer::encode_list(offset, ELEM_BYTE, data.len())?;
        self.set(ptr_word, ptr)
    }

    /// Pack raw bytes little-endian into words beginning at `start`.
    fn pack_bytes(&mut self, start: usize, data: &[u8]) -> Result<(), EncodeError> {
        for (i, chunk) in data.chunks(BYTES_PER_WORD).enumerate() {
            let mut buf = [0u8; BYTES_PER_WORD];
            let dst = buf
                .get_mut(..chunk.len())
                .ok_or(EncodeError::LimitExceeded)?;
            dst.copy_from_slice(chunk);
            let idx = start.checked_add(i).ok_or(EncodeError::LimitExceeded)?;
            self.set(idx, u64::from_le_bytes(buf))?;
        }
        Ok(())
    }

    /// Flatten the body to a little-endian byte vector ([TDBIN-ENC-CANON]).
    fn into_bytes(self) -> Vec<u8> {
        let mut out = Vec::new();
        for word in self.body {
            out.extend_from_slice(&word.to_le_bytes());
        }
        out
    }
}

/// Relative offset (in words) from the end of a pointer word to a target.
fn rel_offset(target_word: usize, ptr_word: usize) -> Result<i64, EncodeError> {
    let target = i64::try_from(target_word).map_err(|_| EncodeError::LimitExceeded)?;
    let base = i64::try_from(ptr_word)
        .map_err(|_| EncodeError::LimitExceeded)?
        .checked_add(1)
        .ok_or(EncodeError::LimitExceeded)?;
    target.checked_sub(base).ok_or(EncodeError::LimitExceeded)
}
