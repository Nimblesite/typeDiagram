//! List-decoding methods of [`Reader`] ([TDBIN-LIST], [TDBIN-LIST-ELEM],
//! [TDBIN-LIST-COMPOSITE]; bodies are raw, never XOR-adjusted,
//! [TDBIN-LIST-RAW]): flat scalar lists as bulk word loads, pointer
//! lists, and row-wise composite lists. Every body is charged to the
//! amplification budget before it is materialized ([TDBIN-SAFE-AMPLIFY]).

use crate::error::DecodeError;
use crate::layout::{self, WORD_BYTES};
use crate::pointer::{self, Pointer, ELEM_BIT, ELEM_COMPOSITE, ELEM_EIGHT_BYTES, ELEM_POINTER};
use crate::reader::Reader;
use crate::Struct;

/// Bits packed per word when reading a bool list.
const WORD_BITS: usize = WORD_BYTES * 8;

/// Decoded metadata for a composite list body ([TDBIN-LIST-COMPOSITE]).
#[derive(Debug, Clone, Copy)]
pub(crate) struct CompositeList {
    /// Word index of the first element body.
    pub(crate) first: usize,
    /// Number of elements in the list.
    pub(crate) count: usize,
    /// Data-section words per element.
    pub(crate) data_words: u16,
    /// Pointer-section words per element.
    pub(crate) ptr_words: u16,
    /// Total words per element.
    pub(crate) stride: usize,
}

impl<'a> Reader<'a> {
    /// Read an optional raw byte list from pointer `slot` ([TDBIN-LIST-ELEM]).
    ///
    /// # Errors
    /// Returns [`DecodeError`] on malformed input.
    pub fn byte_list(
        &self,
        at: usize,
        _data_words: u16,
        slot: u16,
    ) -> Result<Option<Vec<u8>>, DecodeError> {
        self.read_bytes(at, slot)
    }

    /// Read an optional bit-packed Bool list from pointer `slot`.
    ///
    /// # Errors
    /// Returns [`DecodeError`] on malformed input.
    pub fn bool_list(
        &self,
        at: usize,
        _data_words: u16,
        slot: u16,
    ) -> Result<Option<Vec<bool>>, DecodeError> {
        self.read_list(at, slot, ELEM_BIT, Self::read_bool_body)
    }

    /// Read an optional raw 64-bit word list from pointer `slot`.
    ///
    /// # Errors
    /// Returns [`DecodeError`] on malformed input.
    pub fn word_list(
        &self,
        at: usize,
        _data_words: u16,
        slot: u16,
    ) -> Result<Option<Vec<u64>>, DecodeError> {
        self.read_list(at, slot, ELEM_EIGHT_BYTES, |r, p, o, c| {
            r.read_word_body(p, o, c, u64::from_le_bytes)
        })
    }

    /// Read an optional `i64` list from pointer `slot` ([TDBIN-LIST-ELEM]).
    ///
    /// # Errors
    /// Returns [`DecodeError`] on malformed input.
    pub fn i64_list(
        &self,
        at: usize,
        _data_words: u16,
        slot: u16,
    ) -> Result<Option<Vec<i64>>, DecodeError> {
        self.read_list(at, slot, ELEM_EIGHT_BYTES, |r, p, o, c| {
            r.read_word_body(p, o, c, i64::from_le_bytes)
        })
    }

    /// Read an optional `f64` list from pointer `slot` ([TDBIN-LIST-ELEM]).
    ///
    /// # Errors
    /// Returns [`DecodeError`] on malformed input.
    pub fn f64_list(
        &self,
        at: usize,
        _data_words: u16,
        slot: u16,
    ) -> Result<Option<Vec<f64>>, DecodeError> {
        self.read_list(at, slot, ELEM_EIGHT_BYTES, |r, p, o, c| {
            r.read_word_body(p, o, c, f64::from_le_bytes)
        })
    }

    /// Read an optional list of 16-byte scalar words from pointer `slot`.
    ///
    /// # Errors
    /// Returns [`DecodeError`] on malformed input.
    pub fn bytes16_list(
        &self,
        at: usize,
        _data_words: u16,
        slot: u16,
    ) -> Result<Option<Vec<(u64, u64)>>, DecodeError> {
        self.read_composite(at, slot, Self::read_bytes16_body)
    }

    /// Read an optional list of strings from pointer `slot`.
    ///
    /// # Errors
    /// Returns [`DecodeError`] on malformed input or invalid UTF-8.
    pub fn string_list(
        &self,
        at: usize,
        _data_words: u16,
        slot: u16,
    ) -> Result<Option<Vec<String>>, DecodeError> {
        self.read_pointer_list(at, slot, Self::read_string_pointer)
    }

    /// Read an optional list of byte arrays from pointer `slot`.
    ///
    /// # Errors
    /// Returns [`DecodeError`] on malformed input.
    pub fn bytes_list(
        &self,
        at: usize,
        _data_words: u16,
        slot: u16,
    ) -> Result<Option<Vec<Vec<u8>>>, DecodeError> {
        self.read_pointer_list(at, slot, |reader, ptr_word| {
            reader.read_bytes_pointer(ptr_word).map(<[u8]>::to_vec)
        })
    }

    /// Read an optional composite list of child structs from pointer `slot`.
    ///
    /// # Errors
    /// Returns [`DecodeError`] on malformed input, depth, or amplification.
    pub fn child_list<C: Struct>(
        &self,
        at: usize,
        _data_words: u16,
        slot: u16,
    ) -> Result<Option<Vec<C>>, DecodeError> {
        self.read_composite(at, slot, Self::read_child_body::<C>)
    }

    /// Read a non-composite list body using `read_body`.
    pub(crate) fn read_list<T, F>(
        &self,
        at: usize,
        slot: u16,
        expected_elem: u8,
        read_body: F,
    ) -> Result<Option<T>, DecodeError>
    where
        F: Fn(&Self, usize, i64, u32) -> Result<T, DecodeError>,
    {
        if slot >= self.wire_ptr_words() {
            return Ok(None);
        }
        let ptr_word = self.ptr_index(at, slot)?;
        match pointer::decode(layout::read_word(self.wire(), ptr_word)?)? {
            Pointer::Null => Ok(None),
            Pointer::List {
                offset,
                elem,
                count,
            } if elem == expected_elem => read_body(self, ptr_word, offset, count).map(Some),
            Pointer::List { .. } | Pointer::Struct { .. } => Err(DecodeError::PointerKindMismatch),
        }
    }

    /// Read a composite list body using `read_body`.
    pub(crate) fn read_composite<T, F>(
        &self,
        at: usize,
        slot: u16,
        read_body: F,
    ) -> Result<Option<T>, DecodeError>
    where
        F: Fn(&Self, CompositeList) -> Result<T, DecodeError>,
    {
        self.read_list(
            at,
            slot,
            ELEM_COMPOSITE,
            |reader, ptr_word, offset, count| {
                reader
                    .read_composite_header(ptr_word, offset, count)
                    .and_then(|info| read_body(reader, info))
            },
        )
    }

    /// Read a pointer list body using `read_one` for each element pointer.
    fn read_pointer_list<T, F>(
        &self,
        at: usize,
        slot: u16,
        read_one: F,
    ) -> Result<Option<Vec<T>>, DecodeError>
    where
        F: Fn(&Self, usize) -> Result<T, DecodeError>,
    {
        self.read_list(at, slot, ELEM_POINTER, |reader, ptr_word, offset, count| {
            reader.read_pointer_body(ptr_word, offset, count, &read_one)
        })
    }

    /// Read a bit-packed Bool list body.
    pub(crate) fn read_bool_body(
        &self,
        ptr_word: usize,
        offset: i64,
        count: u32,
    ) -> Result<Vec<bool>, DecodeError> {
        let start = Self::list_start(ptr_word, offset)?;
        let len = usize::try_from(count).map_err(|_| DecodeError::LimitExceeded)?;
        let words = len.div_ceil(WORD_BITS);
        Self::require_word_range(self.wire(), start, words)?;
        self.charge(words)?;
        self.unpack_bools(start, len)
    }

    /// Read a raw word list body, converting each word with `convert`
    /// (generic so the conversion inlines into the bulk loop).
    pub(crate) fn read_word_body<T>(
        &self,
        ptr_word: usize,
        offset: i64,
        count: u32,
        convert: impl Fn([u8; WORD_BYTES]) -> T,
    ) -> Result<Vec<T>, DecodeError> {
        let start = Self::list_start(ptr_word, offset)?;
        let len = usize::try_from(count).map_err(|_| DecodeError::LimitExceeded)?;
        Self::require_word_range(self.wire(), start, len)?;
        self.charge(len)?;
        let bytes = self.word_body_bytes(start, len)?;
        Ok(bytes
            .chunks_exact(WORD_BYTES)
            .map(|chunk| convert(word_array(chunk)))
            .collect())
    }

    /// Borrow a validated raw-word list body as bytes.
    fn word_body_bytes(&self, start: usize, len: usize) -> Result<&'a [u8], DecodeError> {
        let start_byte = start
            .checked_mul(WORD_BYTES)
            .ok_or(DecodeError::LimitExceeded)?;
        let byte_len = len
            .checked_mul(WORD_BYTES)
            .ok_or(DecodeError::LimitExceeded)?;
        let end_byte = start_byte
            .checked_add(byte_len)
            .ok_or(DecodeError::LimitExceeded)?;
        self.wire()
            .get(start_byte..end_byte)
            .ok_or(DecodeError::PointerOutOfBounds { word_index: start })
    }

    /// Read a pointer list body.
    fn read_pointer_body<T, F>(
        &self,
        ptr_word: usize,
        offset: i64,
        count: u32,
        read_one: &F,
    ) -> Result<Vec<T>, DecodeError>
    where
        F: Fn(&Self, usize) -> Result<T, DecodeError>,
    {
        let start = Self::list_start(ptr_word, offset)?;
        let len = usize::try_from(count).map_err(|_| DecodeError::LimitExceeded)?;
        Self::require_word_range(self.wire(), start, len)?;
        self.charge(len)?;
        let mut out = Vec::with_capacity(len);
        for i in 0..len {
            let idx = start.checked_add(i).ok_or(DecodeError::LimitExceeded)?;
            out.push(read_one(self, idx)?);
        }
        Ok(out)
    }

    /// Read one string element from a pointer-list body.
    fn read_string_pointer(&self, ptr_word: usize) -> Result<String, DecodeError> {
        let raw = self.read_bytes_pointer(ptr_word)?;
        core::str::from_utf8(raw)
            .map(str::to_owned)
            .map_err(|_| DecodeError::InvalidUtf8)
    }

    /// Borrow one byte-array element from a pointer-list body.
    fn read_bytes_pointer(&self, ptr_word: usize) -> Result<&'a [u8], DecodeError> {
        match pointer::decode(layout::read_word(self.wire(), ptr_word)?)? {
            Pointer::Null => Ok(&[]),
            Pointer::List {
                offset,
                elem,
                count,
            } => self.read_byte_slice(ptr_word, offset, elem, count),
            Pointer::Struct { .. } => Err(DecodeError::PointerKindMismatch),
        }
    }

    /// Read a 16-byte semantic-scalar composite list body.
    fn read_bytes16_body(&self, info: CompositeList) -> Result<Vec<(u64, u64)>, DecodeError> {
        if info.data_words != 2 || info.ptr_words != 0 {
            return Err(DecodeError::PointerKindMismatch);
        }
        let mut out = Vec::with_capacity(info.count);
        for i in 0..info.count {
            let at = info.elem_at(i)?;
            let hi_at = at.checked_add(1).ok_or(DecodeError::LimitExceeded)?;
            out.push((
                layout::read_word(self.wire(), at)?,
                layout::read_word(self.wire(), hi_at)?,
            ));
        }
        Ok(out)
    }

    /// Read a child-struct composite list body.
    fn read_child_body<C: Struct>(&self, info: CompositeList) -> Result<Vec<C>, DecodeError> {
        let mut out = Vec::with_capacity(info.count);
        for i in 0..info.count {
            out.push(self.read_inline_struct::<C>(
                info.elem_at(i)?,
                info.data_words,
                info.ptr_words,
            )?);
        }
        Ok(out)
    }

    /// Decode, validate, and charge a composite list tag word.
    pub(crate) fn read_composite_header(
        &self,
        ptr_word: usize,
        offset: i64,
        count: u32,
    ) -> Result<CompositeList, DecodeError> {
        let tag_at = Self::list_start(ptr_word, offset)?;
        match pointer::decode(layout::read_word(self.wire(), tag_at)?)? {
            Pointer::Struct {
                offset,
                data_words,
                ptr_words,
            } => self.composite_info(tag_at, offset, data_words, ptr_words, count),
            Pointer::Null | Pointer::List { .. } => Err(DecodeError::PointerKindMismatch),
        }
    }

    /// Build validated composite list metadata from a decoded tag.
    fn composite_info(
        &self,
        tag_at: usize,
        count: i64,
        data_words: u16,
        ptr_words: u16,
        elem_words: u32,
    ) -> Result<CompositeList, DecodeError> {
        let count = usize::try_from(count).map_err(|_| DecodeError::PointerKindMismatch)?;
        let stride = usize::from(data_words)
            .checked_add(usize::from(ptr_words))
            .ok_or(DecodeError::LimitExceeded)?;
        let expected = stride
            .checked_mul(count)
            .ok_or(DecodeError::LimitExceeded)?;
        let actual = usize::try_from(elem_words).map_err(|_| DecodeError::LimitExceeded)?;
        if expected != actual || (stride == 0 && count != 0) {
            return Err(DecodeError::MalformedCompositeTag);
        }
        let first = tag_at.checked_add(1).ok_or(DecodeError::LimitExceeded)?;
        let total = expected.checked_add(1).ok_or(DecodeError::LimitExceeded)?;
        Self::require_word_range(self.wire(), tag_at, total)?;
        self.charge(total)?;
        Ok(CompositeList {
            first,
            count,
            data_words,
            ptr_words,
            stride,
        })
    }

    /// Unpack `count` bools from an already-charged bit-packed list body.
    fn unpack_bools(&self, start: usize, count: usize) -> Result<Vec<bool>, DecodeError> {
        let mut out = Vec::with_capacity(count);
        for word_offset in 0..count.div_ceil(WORD_BITS) {
            let idx = start
                .checked_add(word_offset)
                .ok_or(DecodeError::LimitExceeded)?;
            let word = layout::read_word(self.wire(), idx)?;
            let remaining = count.saturating_sub(out.len()).min(WORD_BITS);
            append_bool_word(&mut out, word, remaining);
        }
        Ok(out)
    }
}

/// Append the requested low bits from one packed Bool word.
fn append_bool_word(out: &mut Vec<bool>, word: u64, count: usize) {
    let mut mask = 1_u64;
    for _ in 0..count {
        out.push(word & mask != 0);
        mask = mask.rotate_left(1);
    }
}

/// Convert an exact 8-byte chunk to an array (total for `chunks_exact` output).
fn word_array(chunk: &[u8]) -> [u8; WORD_BYTES] {
    <[u8; WORD_BYTES]>::try_from(chunk).unwrap_or([0; WORD_BYTES])
}

impl CompositeList {
    /// Absolute word index of element `i`.
    pub(crate) fn elem_at(self, i: usize) -> Result<usize, DecodeError> {
        let offset = self
            .stride
            .checked_mul(i)
            .ok_or(DecodeError::LimitExceeded)?;
        self.first
            .checked_add(offset)
            .ok_or(DecodeError::LimitExceeded)
    }
}
