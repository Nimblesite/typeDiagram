//! List-encoding methods of [`Writer`] ([TDBIN-LIST], [TDBIN-LIST-ELEM],
//! [TDBIN-LIST-COMPOSITE]): flat scalar lists as bulk word copies, pointer
//! lists, and row-wise composite lists. Split from `writer.rs` to keep both
//! files within the repository size budget.

use crate::error::EncodeError;
use crate::layout::WORD_BYTES;
use crate::pointer::{ELEM_BIT, ELEM_COMPOSITE, ELEM_EIGHT_BYTES, ELEM_POINTER};
use crate::writer::Writer;
use crate::Struct;

/// Bits packed per word when laying out a bool list.
const BITS_PER_WORD: usize = WORD_BYTES * 8;

impl Writer {
    /// Write an optional raw byte list into pointer `slot` ([TDBIN-LIST-ELEM]).
    ///
    /// # Errors
    /// Returns [`EncodeError`] if the message exceeds a wire-format limit.
    pub fn byte_list(
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

    /// Write an optional bit-packed Bool list into pointer `slot`.
    ///
    /// # Errors
    /// Returns [`EncodeError`] if the message exceeds a wire-format limit.
    pub fn bool_list(
        &mut self,
        at: usize,
        data_words: u16,
        slot: u16,
        value: Option<&[bool]>,
    ) -> Result<(), EncodeError> {
        let ptr_word = Self::ptr_index(at, data_words, slot)?;
        match value {
            None => self.set(ptr_word, 0),
            Some(bits) => self.write_bool_list(ptr_word, bits),
        }
    }

    /// Write an optional raw 64-bit word list into pointer `slot`.
    ///
    /// # Errors
    /// Returns [`EncodeError`] if the message exceeds a wire-format limit.
    pub fn word_list(
        &mut self,
        at: usize,
        data_words: u16,
        slot: u16,
        value: Option<&[u64]>,
    ) -> Result<(), EncodeError> {
        let ptr_word = Self::ptr_index(at, data_words, slot)?;
        match value {
            None => self.set(ptr_word, 0),
            Some(words) => self.write_words(ptr_word, words.len(), words.iter().copied()),
        }
    }

    /// Write an optional `i64` list into pointer `slot` ([TDBIN-LIST-ELEM]).
    ///
    /// # Errors
    /// Returns [`EncodeError`] if the message exceeds a wire-format limit.
    pub fn i64_list(
        &mut self,
        at: usize,
        data_words: u16,
        slot: u16,
        value: Option<&[i64]>,
    ) -> Result<(), EncodeError> {
        let ptr_word = Self::ptr_index(at, data_words, slot)?;
        match value {
            None => self.set(ptr_word, 0),
            Some(values) => self.write_words(
                ptr_word,
                values.len(),
                values.iter().map(|v| crate::scalar::i64_bits(*v)),
            ),
        }
    }

    /// Write an optional `f64` list into pointer `slot` ([TDBIN-LIST-ELEM]).
    ///
    /// # Errors
    /// Returns [`EncodeError`] if the message exceeds a wire-format limit.
    pub fn f64_list(
        &mut self,
        at: usize,
        data_words: u16,
        slot: u16,
        value: Option<&[f64]>,
    ) -> Result<(), EncodeError> {
        let ptr_word = Self::ptr_index(at, data_words, slot)?;
        match value {
            None => self.set(ptr_word, 0),
            Some(values) => self.write_words(
                ptr_word,
                values.len(),
                values.iter().map(|v| crate::scalar::f64_bits(*v)),
            ),
        }
    }

    /// Write an optional list of 16-byte scalar values into pointer `slot`.
    ///
    /// # Errors
    /// Returns [`EncodeError`] if the message exceeds a wire-format limit.
    pub fn bytes16_list(
        &mut self,
        at: usize,
        data_words: u16,
        slot: u16,
        value: Option<&[(u64, u64)]>,
    ) -> Result<(), EncodeError> {
        let ptr_word = Self::ptr_index(at, data_words, slot)?;
        match value {
            None => self.set(ptr_word, 0),
            Some(words) => self.write_bytes16_list(ptr_word, words),
        }
    }

    /// Write an optional list of strings into pointer `slot`.
    ///
    /// # Errors
    /// Returns [`EncodeError`] if the message exceeds a wire-format limit.
    pub fn string_list(
        &mut self,
        at: usize,
        data_words: u16,
        slot: u16,
        value: Option<&[String]>,
    ) -> Result<(), EncodeError> {
        let ptr_word = Self::ptr_index(at, data_words, slot)?;
        match value {
            None => self.set(ptr_word, 0),
            Some(items) => self.write_pointer_list(ptr_word, items.len(), |writer, idx, i| {
                let text = items.get(i).ok_or(EncodeError::LimitExceeded)?;
                writer.write_byte_list(idx, text.as_bytes())
            }),
        }
    }

    /// Write an optional list of byte arrays into pointer `slot`.
    ///
    /// # Errors
    /// Returns [`EncodeError`] if the message exceeds a wire-format limit.
    pub fn bytes_list(
        &mut self,
        at: usize,
        data_words: u16,
        slot: u16,
        value: Option<&[Vec<u8>]>,
    ) -> Result<(), EncodeError> {
        let ptr_word = Self::ptr_index(at, data_words, slot)?;
        match value {
            None => self.set(ptr_word, 0),
            Some(items) => self.write_pointer_list(ptr_word, items.len(), |writer, idx, i| {
                let raw = items.get(i).ok_or(EncodeError::LimitExceeded)?;
                writer.write_byte_list(idx, raw)
            }),
        }
    }

    /// Write an optional composite list of child structs into pointer `slot`.
    ///
    /// # Errors
    /// Returns [`EncodeError`] if the message exceeds a wire-format limit.
    pub fn child_list<C: Struct>(
        &mut self,
        at: usize,
        data_words: u16,
        slot: u16,
        value: Option<&[C]>,
    ) -> Result<(), EncodeError> {
        let ptr_word = Self::ptr_index(at, data_words, slot)?;
        match value {
            None => self.set(ptr_word, 0),
            Some(items) => self.write_composite_list(ptr_word, items),
        }
    }

    /// Append a bit-packed Bool list body and patch its list pointer word.
    fn write_bool_list(&mut self, ptr_word: usize, values: &[bool]) -> Result<(), EncodeError> {
        let words = values.len().div_ceil(BITS_PER_WORD);
        let start = self.reserve(words)?;
        self.pack_bits(start, values.iter().copied())?;
        self.set_list_ptr(ptr_word, start, ELEM_BIT, values.len())
    }

    /// Append a raw word-list body from an exact-length iterator.
    pub(crate) fn write_words(
        &mut self,
        ptr_word: usize,
        count: usize,
        values: impl Iterator<Item = u64>,
    ) -> Result<(), EncodeError> {
        let start = self.reserve(count)?;
        let len = count
            .checked_mul(WORD_BYTES)
            .ok_or(EncodeError::LimitExceeded)?;
        let dst = self.bytes_mut(start, len)?;
        for (chunk, value) in dst.chunks_exact_mut(WORD_BYTES).zip(values) {
            chunk.copy_from_slice(&value.to_le_bytes());
        }
        self.set_list_ptr(ptr_word, start, ELEM_EIGHT_BYTES, count)
    }

    /// Append a list whose elements are pointer words.
    pub(crate) fn write_pointer_list<F>(
        &mut self,
        ptr_word: usize,
        count: usize,
        mut write_one: F,
    ) -> Result<(), EncodeError>
    where
        F: FnMut(&mut Self, usize, usize) -> Result<(), EncodeError>,
    {
        let start = self.reserve(count)?;
        self.set_list_ptr(ptr_word, start, ELEM_POINTER, count)?;
        for i in 0..count {
            let idx = start.checked_add(i).ok_or(EncodeError::LimitExceeded)?;
            write_one(self, idx, i)?;
        }
        Ok(())
    }

    /// Append a composite list body and patch its list pointer word.
    fn write_composite_list<C: Struct>(
        &mut self,
        ptr_word: usize,
        values: &[C],
    ) -> Result<(), EncodeError> {
        let stride = C::body_words().ok_or(EncodeError::LimitExceeded)?;
        if stride == 0 {
            return Err(EncodeError::LimitExceeded);
        }
        let elem_words = stride
            .checked_mul(values.len())
            .ok_or(EncodeError::LimitExceeded)?;
        let start = self.reserve_tagged_list(elem_words)?;
        self.write_composite_tag(start, values.len(), C::DATA_WORDS, C::PTR_WORDS)?;
        self.with_descended(|writer| writer.write_composite_items(start, stride, values))?;
        self.set_list_ptr(ptr_word, start, ELEM_COMPOSITE, elem_words)
    }

    /// Append a 16-byte scalar composite list and patch its list pointer word.
    fn write_bytes16_list(
        &mut self,
        ptr_word: usize,
        values: &[(u64, u64)],
    ) -> Result<(), EncodeError> {
        let elem_words = values
            .len()
            .checked_mul(2)
            .ok_or(EncodeError::LimitExceeded)?;
        let start = self.reserve_tagged_list(elem_words)?;
        self.write_composite_tag(start, values.len(), 2, 0)?;
        let len = elem_words
            .checked_mul(WORD_BYTES)
            .ok_or(EncodeError::LimitExceeded)?;
        let first = start.checked_add(1).ok_or(EncodeError::LimitExceeded)?;
        let body = self.bytes_mut(first, len)?.chunks_exact_mut(WORD_BYTES * 2);
        for (chunk, (lo, hi)) in body.zip(values.iter().copied()) {
            write_pair(chunk, lo, hi);
        }
        self.set_list_ptr(ptr_word, start, ELEM_COMPOSITE, elem_words)
    }

    /// Reserve the tag word plus `elem_words` for a composite list.
    fn reserve_tagged_list(&mut self, elem_words: usize) -> Result<usize, EncodeError> {
        let words = elem_words
            .checked_add(1)
            .ok_or(EncodeError::LimitExceeded)?;
        self.reserve(words)
    }

    /// Write the struct-shaped composite tag word.
    pub(crate) fn write_composite_tag(
        &mut self,
        start: usize,
        count: usize,
        data_words: u16,
        ptr_words: u16,
    ) -> Result<(), EncodeError> {
        let count_i64 = i64::try_from(count).map_err(|_| EncodeError::LimitExceeded)?;
        let tag = crate::pointer::encode_struct(count_i64, data_words, ptr_words)?;
        self.set(start, tag)
    }

    /// Write every item into an already-reserved composite list body.
    fn write_composite_items<C: Struct>(
        &mut self,
        start: usize,
        stride: usize,
        values: &[C],
    ) -> Result<(), EncodeError> {
        let first = start.checked_add(1).ok_or(EncodeError::LimitExceeded)?;
        for (i, value) in values.iter().enumerate() {
            let offset = stride.checked_mul(i).ok_or(EncodeError::LimitExceeded)?;
            let at = first
                .checked_add(offset)
                .ok_or(EncodeError::LimitExceeded)?;
            value.write_struct(self, at)?;
        }
        Ok(())
    }
}

/// Write one 16-byte pair into a mutable chunk.
fn write_pair(chunk: &mut [u8], lo: u64, hi: u64) {
    let (a, b) = chunk.split_at_mut(WORD_BYTES.min(chunk.len()));
    if a.len() == WORD_BYTES && b.len() == WORD_BYTES {
        a.copy_from_slice(&lo.to_le_bytes());
        b.copy_from_slice(&hi.to_le_bytes());
    }
}
