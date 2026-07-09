//! The single-pass decoder/verifier: bounds-checked reads with depth and
//! amplification budgets ([TDBIN-SAFE]). Generated ADT code calls the public
//! methods; decode materializes straight into the typed value, with no
//! intermediate dynamic representation.

use core::cell::Cell;
use std::rc::Rc;

use crate::error::DecodeError;
use crate::layout::{self, WORD_BYTES};
use crate::pointer::{self, Pointer, ELEM_BYTE};
use crate::{Struct, MAX_DEPTH};

/// A bounds-checked view over an encoded message ([TDBIN-SAFE-BOUNDS]).
#[derive(Debug)]
pub struct Reader<'a> {
    /// The complete message bytes.
    bytes: &'a [u8],
    /// Remaining struct-nesting depth ([TDBIN-SAFE-DEPTH]).
    depth: u32,
    /// Shared remaining struct-follow budget ([TDBIN-SAFE-AMPLIFY]).
    budget: Rc<Cell<u64>>,
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
        let word_count = u64::try_from(len / WORD_BYTES).map_err(|_| DecodeError::BadLength)?;
        let budget = Rc::new(Cell::new(word_count));
        let head = layout::read_word(bytes, 0)?;
        match pointer::decode(head)? {
            Pointer::Struct { offset, .. } => {
                let at = layout::target(0, offset)
                    .ok_or(DecodeError::PointerOutOfBounds { word_index: 0 })?;
                let reader = Self {
                    bytes,
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
        let idx = at
            .checked_add(usize::from(slot))
            .ok_or(DecodeError::PointerOutOfBounds { word_index: at })?;
        layout::read_word(self.bytes, idx)
    }

    /// Read an optional UTF-8 string from pointer `slot` ([TDBIN-PRIM-MAP]).
    ///
    /// # Errors
    /// Returns [`DecodeError`] on malformed input or invalid UTF-8.
    pub fn string(
        &self,
        at: usize,
        data_words: u16,
        slot: u16,
    ) -> Result<Option<String>, DecodeError> {
        match self.read_bytes(at, data_words, slot)? {
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
        data_words: u16,
        slot: u16,
    ) -> Result<Option<Vec<u8>>, DecodeError> {
        self.read_bytes(at, data_words, slot)
    }

    /// Read an optional child struct from pointer `slot` ([TDBIN-PTR-STRUCT]).
    ///
    /// # Errors
    /// Returns [`DecodeError`] on malformed input, depth, or amplification.
    pub fn child<C: Struct>(
        &self,
        at: usize,
        data_words: u16,
        slot: u16,
    ) -> Result<Option<C>, DecodeError> {
        let ptr_word = Self::ptr_index(at, data_words, slot)?;
        match pointer::decode(layout::read_word(self.bytes, ptr_word)?)? {
            Pointer::Null => Ok(None),
            Pointer::Struct { offset, .. } => self.follow_struct::<C>(ptr_word, offset).map(Some),
            Pointer::List { .. } => Err(DecodeError::PointerKindMismatch),
        }
    }

    /// Read an optional raw byte list from pointer `slot`.
    fn read_bytes(
        &self,
        at: usize,
        data_words: u16,
        slot: u16,
    ) -> Result<Option<Vec<u8>>, DecodeError> {
        let ptr_word = Self::ptr_index(at, data_words, slot)?;
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

    /// Follow a struct pointer, enforcing depth and amplification budgets.
    fn follow_struct<C: Struct>(&self, ptr_word: usize, offset: i64) -> Result<C, DecodeError> {
        let target = layout::target(ptr_word, offset).ok_or(DecodeError::PointerOutOfBounds {
            word_index: ptr_word,
        })?;
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

    /// Absolute word index of pointer `slot`.
    fn ptr_index(at: usize, data_words: u16, slot: u16) -> Result<usize, DecodeError> {
        layout::ptr_word(at, data_words, usize::from(slot))
            .ok_or(DecodeError::PointerOutOfBounds { word_index: at })
    }
}
