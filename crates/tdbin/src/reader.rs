//! The single-pass decoder/verifier: bounds-checked reads with depth and
//! amplification budgets ([TDBIN-SAFE]). Generated ADT code calls the public
//! methods; decode materializes straight into the typed value, with no
//! intermediate dynamic representation.

use core::cell::Cell;
use std::rc::Rc;

use crate::error::DecodeError;
use crate::layout::{self, WORD_BYTES};
use crate::pointer::{
    self, Pointer, ELEM_BIT, ELEM_BYTE, ELEM_COMPOSITE, ELEM_EIGHT_BYTES, ELEM_POINTER,
};
use crate::{Struct, MAX_DEPTH};

/// A bounds-checked view over an encoded message ([TDBIN-SAFE-BOUNDS]).
#[derive(Debug)]
pub struct Reader<'a> {
    /// The complete message bytes.
    bytes: &'a [u8],
    /// Actual data-section words declared by the struct pointer.
    data_words: u16,
    /// Actual pointer-section words declared by the struct pointer.
    ptr_words: u16,
    /// Remaining struct-nesting depth ([TDBIN-SAFE-DEPTH]).
    depth: u32,
    /// Shared remaining struct-follow budget ([TDBIN-SAFE-AMPLIFY]).
    budget: Rc<Cell<u64>>,
}

/// Decoded metadata for a composite list body ([TDBIN-LIST-COMPOSITE]).
#[derive(Debug, Clone, Copy)]
struct CompositeList {
    /// Word index of the first element body.
    first: usize,
    /// Number of elements in the list.
    count: usize,
    /// Data-section words per element.
    data_words: u16,
    /// Pointer-section words per element.
    ptr_words: u16,
    /// Total words per element.
    stride: usize,
}

impl<'a> Reader<'a> {
    /// Decode a root value from a complete message ([TDBIN-MSG-BARE]).
    ///
    /// # Errors
    /// Returns [`DecodeError`] on malformed or out-of-bounds input.
    pub(crate) fn message<T: Struct>(bytes: &'a [u8]) -> Result<T, DecodeError> {
        let len = bytes.len();
        ((len != 0) && len.is_multiple_of(WORD_BYTES))
            .then_some(())
            .ok_or(DecodeError::BadLength)?;
        crate::verify::message(bytes)?;
        let word_count = u64::try_from(len / WORD_BYTES).map_err(|_| DecodeError::BadLength)?;
        let budget = Rc::new(Cell::new(word_count));
        let head = layout::read_word(bytes, 0)?;
        match pointer::decode(head)? {
            Pointer::Struct {
                offset,
                data_words,
                ptr_words,
            } => {
                let at = layout::target(0, offset)
                    .ok_or(DecodeError::PointerOutOfBounds { word_index: 0 })?;
                Self::require_struct_bounds(bytes, at, data_words, ptr_words)?;
                let reader = Self {
                    bytes,
                    data_words,
                    ptr_words,
                    depth: MAX_DEPTH,
                    budget,
                };
                T::read_struct(&reader, at)
            }
            Pointer::Null => Err(DecodeError::NullRoot),
            Pointer::List { .. } => Err(DecodeError::PointerKindMismatch),
        }
    }

    /// Read a scalar data word from `slot` of the struct at `at`.
    ///
    /// # Errors
    /// Returns [`DecodeError`] if the word is out of bounds.
    pub fn scalar(&self, at: usize, slot: u16) -> Result<u64, DecodeError> {
        if slot >= self.data_words {
            return Ok(0);
        }
        let idx = at
            .checked_add(usize::from(slot))
            .ok_or(DecodeError::PointerOutOfBounds { word_index: at })?;
        layout::read_word(self.bytes, idx)
    }

    /// Read one packed Bool bit from a data word ([TDBIN-REC-XOR]).
    ///
    /// # Errors
    /// Returns [`DecodeError`] if the slot is out of bounds or the bit is invalid.
    pub fn bool_bit(&self, at: usize, slot: u16, bit: u8) -> Result<bool, DecodeError> {
        let mask = 1_u64
            .checked_shl(u32::from(bit))
            .ok_or(DecodeError::LimitExceeded)?;
        self.scalar(at, slot).map(|word| word & mask != 0)
    }

    /// Read an optional UTF-8 string from pointer `slot` ([TDBIN-PRIM-MAP]).
    ///
    /// # Errors
    /// Returns [`DecodeError`] on malformed input or invalid UTF-8.
    pub fn string(
        &self,
        at: usize,
        _data_words: u16,
        slot: u16,
    ) -> Result<Option<String>, DecodeError> {
        match self.read_bytes(at, slot)? {
            None => Ok(None),
            Some(raw) => String::from_utf8(raw)
                .map(Some)
                .map_err(|_| DecodeError::InvalidUtf8),
        }
    }

    /// Read an optional raw byte list from pointer `slot` ([TDBIN-PRIM-MAP]).
    ///
    /// # Errors
    /// Returns [`DecodeError`] on malformed input.
    pub fn bytes(
        &self,
        at: usize,
        _data_words: u16,
        slot: u16,
    ) -> Result<Option<Vec<u8>>, DecodeError> {
        self.read_bytes(at, slot)
    }

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
        self.read_list(at, slot, ELEM_EIGHT_BYTES, Self::read_word_body)
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
        self.read_pointer_list(at, slot, Self::read_bytes_pointer)
    }

    /// Read an optional child struct from pointer `slot` ([TDBIN-PTR-STRUCT]).
    ///
    /// # Errors
    /// Returns [`DecodeError`] on malformed input, depth, or amplification.
    pub fn child<C: Struct>(
        &self,
        at: usize,
        _data_words: u16,
        slot: u16,
    ) -> Result<Option<C>, DecodeError> {
        if slot >= self.ptr_words {
            return Ok(None);
        }
        let ptr_word = self.ptr_index(at, slot)?;
        match pointer::decode(layout::read_word(self.bytes, ptr_word)?)? {
            Pointer::Null => Ok(None),
            Pointer::Struct {
                offset,
                data_words,
                ptr_words,
            } => self
                .follow_struct::<C>(ptr_word, offset, data_words, ptr_words)
                .map(Some),
            Pointer::List { .. } => Err(DecodeError::PointerKindMismatch),
        }
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

    /// Require an inactive union pointer slot to remain null.
    ///
    /// # Errors
    /// Returns [`DecodeError::PointerKindMismatch`] for a non-null slot.
    pub fn require_null_pointer(&self, at: usize, slot: u16) -> Result<(), DecodeError> {
        if slot >= self.ptr_words {
            return Ok(());
        }
        let ptr_word = self.ptr_index(at, slot)?;
        match pointer::decode(layout::read_word(self.bytes, ptr_word)?)? {
            Pointer::Null => Ok(()),
            Pointer::Struct { .. } | Pointer::List { .. } => Err(DecodeError::PointerKindMismatch),
        }
    }

    /// Read an optional raw byte list from pointer `slot`.
    fn read_bytes(&self, at: usize, slot: u16) -> Result<Option<Vec<u8>>, DecodeError> {
        if slot >= self.ptr_words {
            return Ok(None);
        }
        let ptr_word = self.ptr_index(at, slot)?;
        match pointer::decode(layout::read_word(self.bytes, ptr_word)?)? {
            Pointer::Null => Ok(None),
            Pointer::List {
                offset,
                elem,
                count,
            } => self
                .read_list_bytes(ptr_word, offset, elem, count)
                .map(Some),
            Pointer::Struct { .. } => Err(DecodeError::PointerKindMismatch),
        }
    }

    /// Read a non-composite list body using `read_body`.
    fn read_list<T, F>(
        &self,
        at: usize,
        slot: u16,
        expected_elem: u8,
        read_body: F,
    ) -> Result<Option<T>, DecodeError>
    where
        F: Fn(&Self, usize, i64, u32) -> Result<T, DecodeError>,
    {
        if slot >= self.ptr_words {
            return Ok(None);
        }
        let ptr_word = self.ptr_index(at, slot)?;
        match pointer::decode(layout::read_word(self.bytes, ptr_word)?)? {
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
    fn read_composite<T, F>(
        &self,
        at: usize,
        slot: u16,
        read_body: F,
    ) -> Result<Option<T>, DecodeError>
    where
        F: Fn(&Self, CompositeList) -> Result<T, DecodeError>,
    {
        if slot >= self.ptr_words {
            return Ok(None);
        }
        let ptr_word = self.ptr_index(at, slot)?;
        match pointer::decode(layout::read_word(self.bytes, ptr_word)?)? {
            Pointer::Null => Ok(None),
            Pointer::List {
                offset,
                elem: ELEM_COMPOSITE,
                count,
            } => self
                .read_composite_header(ptr_word, offset, count)
                .and_then(|info| read_body(self, info))
                .map(Some),
            Pointer::List { .. } | Pointer::Struct { .. } => Err(DecodeError::PointerKindMismatch),
        }
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

    /// Follow a struct pointer, enforcing depth and amplification budgets.
    fn follow_struct<C: Struct>(
        &self,
        ptr_word: usize,
        offset: i64,
        data_words: u16,
        ptr_words: u16,
    ) -> Result<C, DecodeError> {
        let target = layout::target(ptr_word, offset).ok_or(DecodeError::PointerOutOfBounds {
            word_index: ptr_word,
        })?;
        Self::require_struct_bounds(self.bytes, target, data_words, ptr_words)?;
        let depth = self
            .depth
            .checked_sub(1)
            .ok_or(DecodeError::DepthExceeded)?;
        let left = self
            .budget
            .get()
            .checked_sub(1)
            .ok_or(DecodeError::AmplificationExceeded)?;
        self.budget.set(left);
        let child = Self {
            bytes: self.bytes,
            data_words,
            ptr_words,
            depth,
            budget: Rc::clone(&self.budget),
        };
        C::read_struct(&child, target)
    }

    /// Read one inline composite element, enforcing depth and amplification.
    fn read_inline_struct<C: Struct>(
        &self,
        target: usize,
        data_words: u16,
        ptr_words: u16,
    ) -> Result<C, DecodeError> {
        Self::require_struct_bounds(self.bytes, target, data_words, ptr_words)?;
        let depth = self
            .depth
            .checked_sub(1)
            .ok_or(DecodeError::DepthExceeded)?;
        let left = self
            .budget
            .get()
            .checked_sub(1)
            .ok_or(DecodeError::AmplificationExceeded)?;
        self.budget.set(left);
        let child = Self {
            bytes: self.bytes,
            data_words,
            ptr_words,
            depth,
            budget: Rc::clone(&self.budget),
        };
        C::read_struct(&child, target)
    }

    /// Read `count` bytes referenced by a byte-list pointer.
    fn read_list_bytes(
        &self,
        ptr_word: usize,
        offset: i64,
        elem: u8,
        count: u32,
    ) -> Result<Vec<u8>, DecodeError> {
        if elem == ELEM_BYTE {
            let start_word =
                layout::target(ptr_word, offset).ok_or(DecodeError::PointerOutOfBounds {
                    word_index: ptr_word,
                })?;
            let start =
                start_word
                    .checked_mul(WORD_BYTES)
                    .ok_or(DecodeError::PointerOutOfBounds {
                        word_index: start_word,
                    })?;
            let len = usize::try_from(count).map_err(|_| DecodeError::LimitExceeded)?;
            let end = start
                .checked_add(len)
                .ok_or(DecodeError::PointerOutOfBounds {
                    word_index: start_word,
                })?;
            let slice = self
                .bytes
                .get(start..end)
                .ok_or(DecodeError::PointerOutOfBounds {
                    word_index: start_word,
                })?;
            Ok(slice.to_vec())
        } else {
            Err(DecodeError::PointerKindMismatch)
        }
    }

    /// Read a bit-packed Bool list body.
    fn read_bool_body(
        &self,
        ptr_word: usize,
        offset: i64,
        count: u32,
    ) -> Result<Vec<bool>, DecodeError> {
        let start = Self::list_start(ptr_word, offset)?;
        let len = usize::try_from(count).map_err(|_| DecodeError::LimitExceeded)?;
        let words = len
            .checked_add(WORD_BITS - 1)
            .ok_or(DecodeError::LimitExceeded)?
            / WORD_BITS;
        Self::require_word_range(self.bytes, start, words)?;
        self.unpack_bools(start, len)
    }

    /// Read a raw word list body.
    fn read_word_body(
        &self,
        ptr_word: usize,
        offset: i64,
        count: u32,
    ) -> Result<Vec<u64>, DecodeError> {
        let start = Self::list_start(ptr_word, offset)?;
        let len = usize::try_from(count).map_err(|_| DecodeError::LimitExceeded)?;
        Self::require_word_range(self.bytes, start, len)?;
        let bytes = self.word_body_bytes(start, len)?;
        Self::decode_words(bytes, len, start)
    }

    /// Borrow a validated raw-word list body as bytes.
    fn word_body_bytes(&self, start: usize, len: usize) -> Result<&[u8], DecodeError> {
        let start_byte = start
            .checked_mul(WORD_BYTES)
            .ok_or(DecodeError::LimitExceeded)?;
        let byte_len = len
            .checked_mul(WORD_BYTES)
            .ok_or(DecodeError::LimitExceeded)?;
        let end_byte = start_byte
            .checked_add(byte_len)
            .ok_or(DecodeError::LimitExceeded)?;
        self.bytes
            .get(start_byte..end_byte)
            .ok_or(DecodeError::PointerOutOfBounds { word_index: start })
    }

    /// Materialize little-endian words from one validated byte slice.
    fn decode_words(bytes: &[u8], len: usize, start: usize) -> Result<Vec<u64>, DecodeError> {
        let mut out = Vec::with_capacity(len);
        for chunk in bytes.chunks_exact(WORD_BYTES) {
            let word = <[u8; WORD_BYTES]>::try_from(chunk)
                .map_err(|_| DecodeError::PointerOutOfBounds { word_index: start })?;
            out.push(u64::from_le_bytes(word));
        }
        Ok(out)
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
        Self::require_word_range(self.bytes, start, len)?;
        let mut out = Vec::with_capacity(len);
        for i in 0..len {
            let idx = start.checked_add(i).ok_or(DecodeError::LimitExceeded)?;
            out.push(read_one(self, idx)?);
        }
        Ok(out)
    }

    /// Read one string element from a pointer-list body.
    fn read_string_pointer(&self, ptr_word: usize) -> Result<String, DecodeError> {
        match self.read_bytes_pointer(ptr_word)? {
            raw if raw.is_empty() => Ok(String::new()),
            raw => String::from_utf8(raw).map_err(|_| DecodeError::InvalidUtf8),
        }
    }

    /// Read one byte-array element from a pointer-list body.
    fn read_bytes_pointer(&self, ptr_word: usize) -> Result<Vec<u8>, DecodeError> {
        match pointer::decode(layout::read_word(self.bytes, ptr_word)?)? {
            Pointer::Null => Ok(Vec::new()),
            Pointer::List {
                offset,
                elem,
                count,
            } => self.read_list_bytes(ptr_word, offset, elem, count),
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
                layout::read_word(self.bytes, at)?,
                layout::read_word(self.bytes, hi_at)?,
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

    /// Decode and validate a composite list tag word.
    fn read_composite_header(
        &self,
        ptr_word: usize,
        offset: i64,
        count: u32,
    ) -> Result<CompositeList, DecodeError> {
        let tag_at = Self::list_start(ptr_word, offset)?;
        match pointer::decode(layout::read_word(self.bytes, tag_at)?)? {
            Pointer::Struct {
                offset,
                data_words,
                ptr_words,
            } => Self::composite_info(self.bytes, tag_at, offset, data_words, ptr_words, count),
            Pointer::Null | Pointer::List { .. } => Err(DecodeError::PointerKindMismatch),
        }
    }

    /// Build validated composite list metadata from a decoded tag.
    fn composite_info(
        bytes: &[u8],
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
        Self::require_word_range(
            bytes,
            tag_at,
            expected.checked_add(1).ok_or(DecodeError::LimitExceeded)?,
        )?;
        Ok(CompositeList {
            first,
            count,
            data_words,
            ptr_words,
            stride,
        })
    }

    /// Resolve a list pointer target.
    fn list_start(ptr_word: usize, offset: i64) -> Result<usize, DecodeError> {
        layout::target(ptr_word, offset).ok_or(DecodeError::PointerOutOfBounds {
            word_index: ptr_word,
        })
    }

    /// Unpack `count` bools from a bit-packed list body.
    fn unpack_bools(&self, start: usize, count: usize) -> Result<Vec<bool>, DecodeError> {
        let mut out = Vec::with_capacity(count);
        for word_offset in 0..count.div_ceil(WORD_BITS) {
            let idx = start
                .checked_add(word_offset)
                .ok_or(DecodeError::LimitExceeded)?;
            let word = layout::read_word(self.bytes, idx)?;
            let remaining = count
                .checked_sub(out.len())
                .ok_or(DecodeError::LimitExceeded)?
                .min(WORD_BITS);
            Self::append_bool_word(&mut out, word, remaining)?;
        }
        Ok(out)
    }

    /// Append the requested low bits from one packed Bool word.
    fn append_bool_word(out: &mut Vec<bool>, word: u64, count: usize) -> Result<(), DecodeError> {
        for bit in 0..count {
            let shift = u32::try_from(bit).map_err(|_| DecodeError::LimitExceeded)?;
            let mask = 1_u64.checked_shl(shift).ok_or(DecodeError::LimitExceeded)?;
            out.push(word & mask != 0);
        }
        Ok(())
    }

    /// Absolute word index of pointer `slot`.
    fn ptr_index(&self, at: usize, slot: u16) -> Result<usize, DecodeError> {
        layout::ptr_word(at, self.data_words, usize::from(slot))
            .ok_or(DecodeError::PointerOutOfBounds { word_index: at })
    }

    /// Require a struct body to fit inside the message.
    fn require_struct_bounds(
        bytes: &[u8],
        at: usize,
        data_words: u16,
        ptr_words: u16,
    ) -> Result<(), DecodeError> {
        let words = usize::from(data_words)
            .checked_add(usize::from(ptr_words))
            .ok_or(DecodeError::LimitExceeded)?;
        let end = at.checked_add(words).ok_or(DecodeError::LimitExceeded)?;
        (end <= bytes.len() / WORD_BYTES)
            .then_some(())
            .ok_or(DecodeError::PointerOutOfBounds { word_index: at })
    }

    /// Require `words` words starting at `at` to fit inside the message.
    fn require_word_range(bytes: &[u8], at: usize, words: usize) -> Result<(), DecodeError> {
        let end = at.checked_add(words).ok_or(DecodeError::LimitExceeded)?;
        (end <= bytes.len() / WORD_BYTES)
            .then_some(())
            .ok_or(DecodeError::PointerOutOfBounds { word_index: at })
    }
}

/// Bits packed per word when reading a bool list.
const WORD_BITS: usize = WORD_BYTES * 8;

impl CompositeList {
    /// Absolute word index of element `i`.
    fn elem_at(self, i: usize) -> Result<usize, DecodeError> {
        let offset = self
            .stride
            .checked_mul(i)
            .ok_or(DecodeError::LimitExceeded)?;
        self.first
            .checked_add(offset)
            .ok_or(DecodeError::LimitExceeded)
    }
}
