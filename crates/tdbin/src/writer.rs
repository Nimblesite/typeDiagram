//! The word-arena encoder: preorder allocation with in-message back-patching
//! ([TDBIN-ENC-ORDER]); identical values produce byte-identical bodies
//! ([TDBIN-ENC-CANON]). Generated ADT code calls the public methods; the
//! private helpers keep the pointer math in one place. List encoding lives in
//! `writer_lists.rs`; columnar encoding in `column.rs`.
//!
//! The arena is a flat little-endian byte vector, so finishing a message is
//! free and string/list bodies are single bulk copies. An optional byte
//! `prefix` reserves room for a frame header so framed encodes never re-copy
//! the body.

use crate::error::EncodeError;
use crate::layout::WORD_BYTES;
use crate::pointer::{self, ELEM_BYTE};
use crate::{Struct, MAX_DEPTH};

/// Upper bound on message body words (a safety cap for the encoder).
const MAX_WORDS: usize = 1 << 26;
/// Initial arena capacity: covers small messages with one allocation.
const INITIAL_CAPACITY: usize = 256;

/// Accumulates message body words while encoding a value tree.
#[derive(Debug)]
pub struct Writer {
    /// The message: `prefix` reserved bytes then the little-endian body.
    body: Vec<u8>,
    /// Byte offset where body word 0 starts.
    prefix: usize,
    /// Remaining recursive child-pointer depth.
    depth: u32,
}

impl Writer {
    /// Create an empty writer with `prefix` reserved header bytes.
    fn new(prefix: usize) -> Self {
        let mut body = Vec::with_capacity(INITIAL_CAPACITY.max(prefix));
        body.resize(prefix, 0);
        Self {
            body,
            prefix,
            depth: MAX_DEPTH,
        }
    }

    /// Encode a root value into a complete message ([TDBIN-MSG-BARE]).
    ///
    /// # Errors
    /// Returns [`EncodeError`] if the value exceeds a wire-format limit.
    pub(crate) fn message<T: Struct>(value: &T) -> Result<Vec<u8>, EncodeError> {
        Self::message_with_prefix(value, 0)
    }

    /// Encode a message after `prefix` reserved zero bytes ([TDBIN-MSG-FRAME]).
    pub(crate) fn message_with_prefix<T: Struct>(
        value: &T,
        prefix: usize,
    ) -> Result<Vec<u8>, EncodeError> {
        let mut writer = Self::new(prefix);
        let _root = writer.reserve(1)?;
        let words = T::body_words().ok_or(EncodeError::LimitExceeded)?;
        let root_at = match words {
            0 => 0,
            _ => writer.reserve(words)?,
        };
        value.write_struct(&mut writer, root_at)?;
        let offset = rel_offset(root_at, 0)?;
        let ptr = pointer::encode_struct(offset, T::DATA_WORDS, T::PTR_WORDS)?;
        writer.set(0, ptr)?;
        Ok(writer.body)
    }

    /// Reserve `words` zeroed words, returning the start word index.
    pub(crate) fn reserve(&mut self, words: usize) -> Result<usize, EncodeError> {
        let start = self.next_word()?;
        let end = self.end_of(start, words)?;
        self.grow_for(end);
        self.body.resize(end, 0);
        Ok(start)
    }

    /// Append `data` as one whole reservation of `words` words: a single
    /// bulk copy plus a zeroed padding tail, never touching memory twice.
    pub(crate) fn append_reserved(
        &mut self,
        words: usize,
        data: &[u8],
    ) -> Result<usize, EncodeError> {
        let start = self.next_word()?;
        let end = self.end_of(start, words)?;
        let data_end = self
            .body
            .len()
            .checked_add(data.len())
            .filter(|byte| *byte <= end)
            .ok_or(EncodeError::LimitExceeded)?;
        self.grow_for(end);
        self.body.extend_from_slice(data);
        self.body.resize(end.max(data_end), 0);
        Ok(start)
    }

    /// Append every row's bytes end-to-end as one reservation: pure appends,
    /// no pre-zeroing, one zeroed padding tail.
    pub(crate) fn append_concat<'v>(
        &mut self,
        total: usize,
        values: impl Iterator<Item = &'v [u8]>,
    ) -> Result<usize, EncodeError> {
        let start = self.next_word()?;
        let end = self.end_of(start, total.div_ceil(WORD_BYTES))?;
        self.grow_for(end);
        let expected = self
            .body
            .len()
            .checked_add(total)
            .ok_or(EncodeError::LimitExceeded)?;
        for row in values {
            self.body.extend_from_slice(row);
        }
        if self.body.len() != expected {
            return Err(EncodeError::LimitExceeded);
        }
        self.body.resize(end, 0);
        Ok(start)
    }

    /// The next unreserved word index.
    fn next_word(&self) -> Result<usize, EncodeError> {
        Ok(
            (self.body.len().checked_sub(self.prefix)).ok_or(EncodeError::LimitExceeded)?
                / WORD_BYTES,
        )
    }

    /// The byte length after reserving `words` words at `start`.
    fn end_of(&self, start: usize, words: usize) -> Result<usize, EncodeError> {
        let end_words = start.checked_add(words).ok_or(EncodeError::LimitExceeded)?;
        if end_words > MAX_WORDS {
            return Err(EncodeError::LimitExceeded);
        }
        end_words
            .checked_mul(WORD_BYTES)
            .and_then(|bytes| bytes.checked_add(self.prefix))
            .ok_or(EncodeError::LimitExceeded)
    }

    /// Grow capacity ahead of `end` aggressively so bulk encodes do not pay
    /// repeated doubling copies.
    fn grow_for(&mut self, end: usize) {
        if end > self.body.capacity() {
            let ahead = end.max(self.body.capacity().wrapping_mul(4));
            self.body.reserve(ahead.saturating_sub(self.body.len()));
        }
    }

    /// Mutable view of the word at absolute index `idx`.
    fn word_mut(&mut self, idx: usize) -> Result<&mut [u8], EncodeError> {
        self.bytes_mut(idx, WORD_BYTES)
    }

    /// Mutable view of `len` body bytes starting at word `idx`.
    pub(crate) fn bytes_mut(&mut self, idx: usize, len: usize) -> Result<&mut [u8], EncodeError> {
        let start = idx
            .checked_mul(WORD_BYTES)
            .and_then(|bytes| bytes.checked_add(self.prefix))
            .ok_or(EncodeError::LimitExceeded)?;
        let end = start.checked_add(len).ok_or(EncodeError::LimitExceeded)?;
        self.body
            .get_mut(start..end)
            .ok_or(EncodeError::LimitExceeded)
    }

    /// Overwrite the word at absolute index `idx`.
    pub(crate) fn set(&mut self, idx: usize, value: u64) -> Result<(), EncodeError> {
        self.word_mut(idx)?.copy_from_slice(&value.to_le_bytes());
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

    /// Write one packed Bool bit into a data word ([TDBIN-REC-XOR]).
    ///
    /// # Errors
    /// Returns [`EncodeError`] if the slot index overflows or the bit is invalid.
    pub fn bool_bit(
        &mut self,
        at: usize,
        slot: u16,
        bit: u8,
        value: bool,
    ) -> Result<(), EncodeError> {
        let idx = at
            .checked_add(usize::from(slot))
            .ok_or(EncodeError::LimitExceeded)?;
        let mask = 1_u64
            .checked_shl(u32::from(bit))
            .ok_or(EncodeError::LimitExceeded)?;
        let cell = self.word_mut(idx)?;
        let word = word_of(cell)?;
        let updated = if value { word | mask } else { word & !mask };
        cell.copy_from_slice(&updated.to_le_bytes());
        Ok(())
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
        self.byte_list(at, data_words, slot, value)
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
    pub(crate) fn ptr_index(at: usize, data_words: u16, slot: u16) -> Result<usize, EncodeError> {
        crate::layout::ptr_word(at, data_words, usize::from(slot)).ok_or(EncodeError::LimitExceeded)
    }

    /// Append a child struct body and patch its pointer word.
    fn write_child<C: Struct>(&mut self, ptr_word: usize, child: &C) -> Result<(), EncodeError> {
        let words = C::body_words().ok_or(EncodeError::LimitExceeded)?;
        let child_at = match words {
            0 => ptr_word,
            _ => self.reserve(words)?,
        };
        self.with_descended(|writer| child.write_struct(writer, child_at))?;
        let offset = rel_offset(child_at, ptr_word)?;
        let ptr = pointer::encode_struct(offset, C::DATA_WORDS, C::PTR_WORDS)?;
        self.set(ptr_word, ptr)
    }

    /// Append a byte-list body with one bulk copy and patch its pointer word.
    pub(crate) fn write_byte_list(
        &mut self,
        ptr_word: usize,
        data: &[u8],
    ) -> Result<(), EncodeError> {
        let words = data.len().div_ceil(WORD_BYTES);
        let start = self.append_reserved(words, data)?;
        self.set_list_ptr(ptr_word, start, ELEM_BYTE, data.len())
    }

    /// Patch a list pointer word after appending its body.
    pub(crate) fn set_list_ptr(
        &mut self,
        ptr_word: usize,
        start: usize,
        elem: u8,
        count: usize,
    ) -> Result<(), EncodeError> {
        let offset = rel_offset(start, ptr_word)?;
        let ptr = pointer::encode_list(offset, elem, count)?;
        self.set(ptr_word, ptr)
    }

    /// Pack bits little-endian into already-reserved words at `start`.
    pub(crate) fn pack_bits(
        &mut self,
        start: usize,
        values: impl Iterator<Item = bool>,
    ) -> Result<(), EncodeError> {
        let byte_start = start
            .checked_mul(WORD_BYTES)
            .and_then(|bytes| bytes.checked_add(self.prefix))
            .ok_or(EncodeError::LimitExceeded)?;
        let dst = self
            .body
            .get_mut(byte_start..)
            .ok_or(EncodeError::LimitExceeded)?;
        for (i, value) in values.enumerate() {
            let cell = dst.get_mut(i / 8).ok_or(EncodeError::LimitExceeded)?;
            let mask = 1_u8.wrapping_shl(u32::try_from(i % 8).unwrap_or(0));
            *cell |= mask & u8::from(value).wrapping_neg();
        }
        Ok(())
    }

    /// Run one nested struct write with the pointer-depth budget decremented.
    pub(crate) fn with_descended<T>(
        &mut self,
        write: impl FnOnce(&mut Self) -> Result<T, EncodeError>,
    ) -> Result<T, EncodeError> {
        let previous = self.depth;
        self.depth = previous.checked_sub(1).ok_or(EncodeError::LimitExceeded)?;
        let result = write(self);
        self.depth = previous;
        result
    }
}

/// Read a word back out of a mutable cell.
fn word_of(cell: &[u8]) -> Result<u64, EncodeError> {
    <[u8; WORD_BYTES]>::try_from(cell)
        .map(u64::from_le_bytes)
        .map_err(|_| EncodeError::LimitExceeded)
}

/// Relative offset (in words) from the end of a pointer word to a target.
pub(crate) fn rel_offset(target_word: usize, ptr_word: usize) -> Result<i64, EncodeError> {
    let target = i64::try_from(target_word).map_err(|_| EncodeError::LimitExceeded)?;
    let base = i64::try_from(ptr_word)
        .map_err(|_| EncodeError::LimitExceeded)?
        .checked_add(1)
        .ok_or(EncodeError::LimitExceeded)?;
    target.checked_sub(base).ok_or(EncodeError::LimitExceeded)
}
