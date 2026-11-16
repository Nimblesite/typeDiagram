//! [TDBIN-WIDTH-LIST] Width-refined integer lists use the element codes the
//! wire format reserves for them ([TDBIN-PTR-LIST]): `List<U16>` is elem 3
//! (2 bytes), `List<U32>` / `List<I32>` are elem 4 (4 bytes), all little-endian.
//! `List<U8>` reuses the byte list and `List<U64>` the word list; `List<Size>`
//! is a word list with checked narrowing on decode.

use crate::error::{DecodeError, EncodeError};
use crate::layout::WORD_BYTES;
use crate::pointer::{ELEM_EIGHT_BYTES, ELEM_FOUR_BYTES, ELEM_TWO_BYTES};
use crate::reader::Reader;
use crate::scalar;
use crate::writer::Writer;

impl Writer {
    /// Append a fixed-width little-endian list body and patch its pointer.
    fn write_le_list<const N: usize, T: Copy>(
        &mut self,
        ptr_word: usize,
        values: &[T],
        elem: u8,
        le: impl Fn(T) -> [u8; N],
    ) -> Result<(), EncodeError> {
        let bytes = values
            .len()
            .checked_mul(N)
            .ok_or(EncodeError::LimitExceeded)?;
        let start = self.reserve(bytes.div_ceil(WORD_BYTES))?;
        let dst = self.bytes_mut(start, bytes)?;
        for (chunk, value) in dst.as_chunks_mut::<N>().0.iter_mut().zip(values) {
            chunk.copy_from_slice(&le(*value));
        }
        self.set_list_ptr(ptr_word, start, elem, values.len())
    }

    /// Write an optional `List<U16>` into pointer `slot`.
    ///
    /// # Errors
    /// Returns [`EncodeError`] if the message exceeds a wire-format limit.
    pub fn u16_list(
        &mut self,
        at: usize,
        data_words: u16,
        slot: u16,
        value: Option<&[u16]>,
    ) -> Result<(), EncodeError> {
        self.write_list_slot(at, data_words, slot, value, |w, ptr, v| {
            w.write_le_list(ptr, v, ELEM_TWO_BYTES, u16::to_le_bytes)
        })
    }

    /// Write an optional `List<U32>` into pointer `slot`.
    ///
    /// # Errors
    /// Returns [`EncodeError`] if the message exceeds a wire-format limit.
    pub fn u32_list(
        &mut self,
        at: usize,
        data_words: u16,
        slot: u16,
        value: Option<&[u32]>,
    ) -> Result<(), EncodeError> {
        self.write_list_slot(at, data_words, slot, value, |w, ptr, v| {
            w.write_le_list(ptr, v, ELEM_FOUR_BYTES, u32::to_le_bytes)
        })
    }

    /// Write an optional `List<I32>` into pointer `slot`.
    ///
    /// # Errors
    /// Returns [`EncodeError`] if the message exceeds a wire-format limit.
    pub fn i32_list(
        &mut self,
        at: usize,
        data_words: u16,
        slot: u16,
        value: Option<&[i32]>,
    ) -> Result<(), EncodeError> {
        self.write_list_slot(at, data_words, slot, value, |w, ptr, v| {
            w.write_le_list(ptr, v, ELEM_FOUR_BYTES, i32::to_le_bytes)
        })
    }

    /// Write an optional `List<Size>` into pointer `slot` as 8-byte words.
    ///
    /// # Errors
    /// Returns [`EncodeError`] if the message exceeds a wire-format limit.
    pub fn usize_list(
        &mut self,
        at: usize,
        data_words: u16,
        slot: u16,
        value: Option<&[usize]>,
    ) -> Result<(), EncodeError> {
        self.write_list_slot(at, data_words, slot, value, |w, ptr, v| {
            w.write_le_list(ptr, v, ELEM_EIGHT_BYTES, |x| {
                scalar::usize_bits(x).to_le_bytes()
            })
        })
    }
}

impl Reader<'_> {
    /// Read a fixed-width little-endian list body.
    fn read_le_list<const N: usize, T>(
        &self,
        at: usize,
        slot: u16,
        elem: u8,
        from: impl Fn([u8; N]) -> T,
    ) -> Result<Option<Vec<T>>, DecodeError> {
        self.read_list(at, slot, elem, |r, ptr, offset, count| {
            let raw = r.borrow_raw(ptr, offset, count, N)?;
            Ok(raw.as_chunks::<N>().0.iter().copied().map(&from).collect())
        })
    }

    /// Read an optional `List<U16>` from pointer `slot`.
    ///
    /// # Errors
    /// Returns [`DecodeError`] on malformed input.
    pub fn u16_list(
        &self,
        at: usize,
        _data_words: u16,
        slot: u16,
    ) -> Result<Option<Vec<u16>>, DecodeError> {
        self.read_le_list(at, slot, ELEM_TWO_BYTES, u16::from_le_bytes)
    }

    /// Read an optional `List<U32>` from pointer `slot`.
    ///
    /// # Errors
    /// Returns [`DecodeError`] on malformed input.
    pub fn u32_list(
        &self,
        at: usize,
        _data_words: u16,
        slot: u16,
    ) -> Result<Option<Vec<u32>>, DecodeError> {
        self.read_le_list(at, slot, ELEM_FOUR_BYTES, u32::from_le_bytes)
    }

    /// Read an optional `List<I32>` from pointer `slot`.
    ///
    /// # Errors
    /// Returns [`DecodeError`] on malformed input.
    pub fn i32_list(
        &self,
        at: usize,
        _data_words: u16,
        slot: u16,
    ) -> Result<Option<Vec<i32>>, DecodeError> {
        self.read_le_list(at, slot, ELEM_FOUR_BYTES, i32::from_le_bytes)
    }

    /// Read an optional `List<Size>` from pointer `slot`, narrowing each word.
    ///
    /// # Errors
    /// Returns [`DecodeError::ValueOutOfRange`] for a word this target cannot address.
    pub fn usize_list(
        &self,
        at: usize,
        _data_words: u16,
        slot: u16,
    ) -> Result<Option<Vec<usize>>, DecodeError> {
        self.read_le_list(at, slot, ELEM_EIGHT_BYTES, u64::from_le_bytes)?
            .map(|words| words.into_iter().map(scalar::usize_from).collect())
            .transpose()
    }
}
