//! The word-arena encoder: preorder allocation with in-message back-patching
//! ([TDBIN-ENC-ORDER]). Generated ADT code calls the public methods; the
//! private helpers keep the pointer math in one place.

use crate::error::EncodeError;
use crate::layout::{self, WORD_BYTES};
use crate::pointer::{self, ELEM_BIT, ELEM_BYTE, ELEM_COMPOSITE, ELEM_EIGHT_BYTES, ELEM_POINTER};
use crate::Struct;

/// Upper bound on message body words (a safety cap for the encoder).
const MAX_WORDS: usize = 1 << 26;
/// Bytes packed per word when laying out a byte list.
const BYTES_PER_WORD: usize = WORD_BYTES;
/// Bits packed per word when laying out a bool list.
const BITS_PER_WORD: usize = WORD_BYTES * 8;

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
        let cell = self.body.get_mut(idx).ok_or(EncodeError::LimitExceeded)?;
        if value {
            *cell |= mask;
        } else {
            *cell &= !mask;
        }
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
        let ptr_word = Self::ptr_index(at, data_words, slot)?;
        match value {
            None => self.set(ptr_word, 0),
            Some(raw) => self.write_byte_list(ptr_word, raw),
        }
    }

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
            Some(words) => self.write_word_list(ptr_word, words),
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
            Some(items) => self.write_string_list(ptr_word, items),
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
            Some(items) => self.write_bytes_list(ptr_word, items),
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

    /// Append a bit-packed Bool list body and patch its list pointer word.
    fn write_bool_list(&mut self, ptr_word: usize, values: &[bool]) -> Result<(), EncodeError> {
        let words = values
            .len()
            .checked_add(BITS_PER_WORD - 1)
            .ok_or(EncodeError::LimitExceeded)?
            / BITS_PER_WORD;
        let start = self.reserve(words)?;
        self.pack_bools(start, values)?;
        self.set_list_ptr(ptr_word, start, ELEM_BIT, values.len())
    }

    /// Append a raw word list body and patch its list pointer word.
    fn write_word_list(&mut self, ptr_word: usize, values: &[u64]) -> Result<(), EncodeError> {
        let start = self.reserve(values.len())?;
        for (i, word) in values.iter().copied().enumerate() {
            let idx = start.checked_add(i).ok_or(EncodeError::LimitExceeded)?;
            self.set(idx, word)?;
        }
        self.set_list_ptr(ptr_word, start, ELEM_EIGHT_BYTES, values.len())
    }

    /// Append a list whose elements are pointer words.
    fn write_pointer_list<T, F>(
        &mut self,
        ptr_word: usize,
        values: &[T],
        mut write_one: F,
    ) -> Result<(), EncodeError>
    where
        F: FnMut(&mut Self, usize, &T) -> Result<(), EncodeError>,
    {
        let start = self.reserve(values.len())?;
        self.set_list_ptr(ptr_word, start, ELEM_POINTER, values.len())?;
        for (i, value) in values.iter().enumerate() {
            let idx = start.checked_add(i).ok_or(EncodeError::LimitExceeded)?;
            write_one(self, idx, value)?;
        }
        Ok(())
    }

    /// Append a pointer list whose elements point at UTF-8 byte lists.
    fn write_string_list(&mut self, ptr_word: usize, values: &[String]) -> Result<(), EncodeError> {
        self.write_pointer_list(ptr_word, values, |writer, idx, value| {
            writer.write_byte_list(idx, value.as_bytes())
        })
    }

    /// Append a pointer list whose elements point at raw byte lists.
    fn write_bytes_list(&mut self, ptr_word: usize, values: &[Vec<u8>]) -> Result<(), EncodeError> {
        self.write_pointer_list(ptr_word, values, |writer, idx, value| {
            writer.write_byte_list(idx, value)
        })
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
        self.write_composite_items(start, stride, values)?;
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
        self.write_bytes16_items(start, values)?;
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
    fn write_composite_tag(
        &mut self,
        start: usize,
        count: usize,
        data_words: u16,
        ptr_words: u16,
    ) -> Result<(), EncodeError> {
        let count_i64 = i64::try_from(count).map_err(|_| EncodeError::LimitExceeded)?;
        let tag = pointer::encode_struct(count_i64, data_words, ptr_words)?;
        self.set(start, tag)
    }

    /// Write every item into an already-reserved composite list body.
    fn write_composite_items<C: Struct>(
        &mut self,
        start: usize,
        stride: usize,
        values: &[C],
    ) -> Result<(), EncodeError> {
        for (i, value) in values.iter().enumerate() {
            let offset = stride.checked_mul(i).ok_or(EncodeError::LimitExceeded)?;
            let at = start
                .checked_add(1)
                .and_then(|body| body.checked_add(offset))
                .ok_or(EncodeError::LimitExceeded)?;
            value.write_struct(self, at)?;
        }
        Ok(())
    }

    /// Write every 16-byte scalar into an already-reserved composite list body.
    fn write_bytes16_items(
        &mut self,
        start: usize,
        values: &[(u64, u64)],
    ) -> Result<(), EncodeError> {
        for (i, (lo, hi)) in values.iter().copied().enumerate() {
            let at = start
                .checked_add(1)
                .and_then(|body| body.checked_add(i.checked_mul(2)?))
                .ok_or(EncodeError::LimitExceeded)?;
            self.set(at, lo)?;
            self.set(at.checked_add(1).ok_or(EncodeError::LimitExceeded)?, hi)?;
        }
        Ok(())
    }

    /// Patch a list pointer word after appending its body.
    fn set_list_ptr(
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

    /// Pack bools little-endian into words beginning at `start`.
    fn pack_bools(&mut self, start: usize, values: &[bool]) -> Result<(), EncodeError> {
        for (i, value) in values.iter().copied().enumerate() {
            if value {
                let word = i / BITS_PER_WORD;
                let bit =
                    u32::try_from(i % BITS_PER_WORD).map_err(|_| EncodeError::LimitExceeded)?;
                let idx = start.checked_add(word).ok_or(EncodeError::LimitExceeded)?;
                let mask = 1_u64.checked_shl(bit).ok_or(EncodeError::LimitExceeded)?;
                let cell = self.body.get_mut(idx).ok_or(EncodeError::LimitExceeded)?;
                *cell |= mask;
            }
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
