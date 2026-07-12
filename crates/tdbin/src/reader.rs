//! The fused single-pass decoder/verifier ([TDBIN-SAFE]): every pointer the
//! typed reader follows is bounds-checked, depth-capped, and charged to the
//! amplification budget, and pointer slots the schema does not visit are
//! walked by the structural verifier ([TDBIN-REC-SHORT],
//! [TDBIN-UNION-UNKNOWN]) — so one traversal both validates and materializes.
//! List decoding lives in `reader_lists.rs`; columnar decoding in `column.rs`.

use core::cell::Cell;

use crate::error::DecodeError;
use crate::layout::{self, WORD_BYTES};
use crate::pointer::{self, Pointer, ELEM_BYTE};
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
    /// Shared remaining traversal budget in words ([TDBIN-SAFE-AMPLIFY]).
    budget: &'a Cell<u64>,
    /// Shared remaining materialization budget in rows/values
    /// ([TDBIN-COL-SAFE]).
    materialize: &'a Cell<u64>,
}

/// Absolute per-message materialization budget: decoded rows and block values
/// may not exceed this, whatever the wire claims ([TDBIN-COL-SAFE]).
const MATERIALIZE_BUDGET: u64 = 1 << 26;

impl<'a> Reader<'a> {
    /// Decode a root value from a complete message ([TDBIN-MSG-BARE]).
    ///
    /// # Errors
    /// Returns [`DecodeError`] on malformed or out-of-bounds input.
    pub(crate) fn message<T: Struct>(bytes: &[u8]) -> Result<T, DecodeError> {
        let len = bytes.len();
        ((len != 0) && len.is_multiple_of(WORD_BYTES))
            .then_some(())
            .ok_or(DecodeError::BadLength)?;
        let words = u64::try_from(len / WORD_BYTES).map_err(|_| DecodeError::BadLength)?;
        let budget = Cell::new(words.checked_sub(1).ok_or(DecodeError::BadLength)?);
        let materialize = Cell::new(MATERIALIZE_BUDGET);
        let head = layout::read_word(bytes, 0)?;
        match pointer::decode(head)? {
            Pointer::Struct {
                offset,
                data_words,
                ptr_words,
            } => Self::read_root(bytes, &budget, &materialize, offset, data_words, ptr_words),
            Pointer::Null => Err(DecodeError::NullRoot),
            Pointer::List { .. } => Err(DecodeError::PointerKindMismatch),
        }
    }

    /// Follow the root struct pointer and materialize the root value.
    fn read_root<T: Struct>(
        bytes: &[u8],
        budget: &Cell<u64>,
        materialize: &Cell<u64>,
        offset: i64,
        data_words: u16,
        ptr_words: u16,
    ) -> Result<T, DecodeError> {
        let at =
            layout::target(0, offset).ok_or(DecodeError::PointerOutOfBounds { word_index: 0 })?;
        Self::require_struct_bounds(bytes, at, data_words, ptr_words)?;
        let reader = Reader {
            bytes,
            data_words,
            ptr_words,
            depth: MAX_DEPTH,
            budget,
            materialize,
        };
        reader.charge(section_words(data_words, ptr_words)?)?;
        reader.read_struct_verified::<T>(at)
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

    /// Structurally verify every actual pointer slot of the struct at `at`.
    ///
    /// Generated union decoders call this before surfacing `UnknownVariant`,
    /// so a message with an unknown discriminant is still fully
    /// pointer-checked ([TDBIN-UNION-UNKNOWN], [TDBIN-SAFE-ZEROSLOT]).
    ///
    /// # Errors
    /// Returns [`DecodeError`] on any structurally invalid slot.
    pub fn verify_struct_slots(&self, at: usize) -> Result<(), DecodeError> {
        self.verify_slots_from(at, 0)
    }

    /// Read a typed struct then verify its schema-unknown extension slots.
    pub(crate) fn read_struct_verified<C: Struct>(&self, at: usize) -> Result<C, DecodeError> {
        let value = C::read_struct(self, at)?;
        self.verify_slots_from(at, C::PTR_WORDS)?;
        Ok(value)
    }

    /// Structurally verify actual pointer slots starting at `from`.
    pub(crate) fn verify_slots_from(&self, at: usize, from: u16) -> Result<(), DecodeError> {
        for slot in from..self.ptr_words {
            let idx = self.ptr_index(at, slot)?;
            crate::verify::pointer_word(self.bytes, idx, self.depth, self.budget)?;
        }
        Ok(())
    }

    /// Read an optional raw byte list from pointer `slot`.
    pub(crate) fn read_bytes(&self, at: usize, slot: u16) -> Result<Option<Vec<u8>>, DecodeError> {
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
                .read_byte_slice(ptr_word, offset, elem, count)
                .map(|slice| Some(slice.to_vec())),
            Pointer::Struct { .. } => Err(DecodeError::PointerKindMismatch),
        }
    }

    /// Borrow the `count` bytes referenced by a byte-list pointer.
    pub(crate) fn read_byte_slice(
        &self,
        ptr_word: usize,
        offset: i64,
        elem: u8,
        count: u32,
    ) -> Result<&'a [u8], DecodeError> {
        if elem != ELEM_BYTE {
            return Err(DecodeError::PointerKindMismatch);
        }
        let start_word = Self::list_start(ptr_word, offset)?;
        let len = usize::try_from(count).map_err(|_| DecodeError::LimitExceeded)?;
        Self::require_word_range(self.bytes, start_word, len.div_ceil(WORD_BYTES))?;
        self.charge(len.div_ceil(WORD_BYTES))?;
        let start = start_word
            .checked_mul(WORD_BYTES)
            .ok_or(DecodeError::PointerOutOfBounds {
                word_index: start_word,
            })?;
        let end = start
            .checked_add(len)
            .ok_or(DecodeError::PointerOutOfBounds {
                word_index: start_word,
            })?;
        self.bytes
            .get(start..end)
            .ok_or(DecodeError::PointerOutOfBounds {
                word_index: start_word,
            })
    }

    /// Follow a struct pointer, enforcing depth and amplification budgets.
    pub(crate) fn follow_struct<C: Struct>(
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
        let child = self.descend(data_words, ptr_words)?;
        child.charge(section_words(data_words, ptr_words)?)?;
        child.read_struct_verified::<C>(target)
    }

    /// Read one inline composite element (its words are already charged).
    pub(crate) fn read_inline_struct<C: Struct>(
        &self,
        target: usize,
        data_words: u16,
        ptr_words: u16,
    ) -> Result<C, DecodeError> {
        Self::require_struct_bounds(self.bytes, target, data_words, ptr_words)?;
        let child = self.descend(data_words, ptr_words)?;
        child.read_struct_verified::<C>(target)
    }

    /// A child view one nesting level down with the given wire sections.
    pub(crate) fn descend(
        &self,
        data_words: u16,
        ptr_words: u16,
    ) -> Result<Reader<'a>, DecodeError> {
        let depth = self
            .depth
            .checked_sub(1)
            .ok_or(DecodeError::DepthExceeded)?;
        Ok(Reader {
            bytes: self.bytes,
            data_words,
            ptr_words,
            depth,
            budget: self.budget,
            materialize: self.materialize,
        })
    }

    /// Deduct `amount` from a budget cell, failing once it would go negative.
    /// Shared by the amplification and materialization budgets.
    fn charge_cell(cell: &Cell<u64>, amount: usize) -> Result<(), DecodeError> {
        let cost = u64::try_from(amount).map_err(|_| DecodeError::LimitExceeded)?;
        let left = cell
            .get()
            .checked_sub(cost)
            .ok_or(DecodeError::AmplificationExceeded)?;
        cell.set(left);
        Ok(())
    }

    /// Charge traversed words to the amplification budget ([TDBIN-SAFE-AMPLIFY]).
    pub(crate) fn charge(&self, words: usize) -> Result<(), DecodeError> {
        Self::charge_cell(self.budget, words)
    }

    /// Charge decoded rows or block values against the absolute
    /// materialization budget ([TDBIN-COL-SAFE]).
    pub(crate) fn charge_materialized(&self, rows: usize) -> Result<(), DecodeError> {
        Self::charge_cell(self.materialize, rows)
    }

    /// The message bytes this reader validates against.
    pub(crate) fn wire(&self) -> &'a [u8] {
        self.bytes
    }

    /// Actual pointer-section width declared by the followed struct pointer.
    pub(crate) fn wire_ptr_words(&self) -> u16 {
        self.ptr_words
    }

    /// Absolute word index of pointer `slot`.
    pub(crate) fn ptr_index(&self, at: usize, slot: u16) -> Result<usize, DecodeError> {
        layout::ptr_word(at, self.data_words, usize::from(slot))
            .ok_or(DecodeError::PointerOutOfBounds { word_index: at })
    }

    /// Resolve a list pointer target.
    pub(crate) fn list_start(ptr_word: usize, offset: i64) -> Result<usize, DecodeError> {
        layout::target(ptr_word, offset).ok_or(DecodeError::PointerOutOfBounds {
            word_index: ptr_word,
        })
    }

    /// Require a struct body to fit inside the message.
    pub(crate) fn require_struct_bounds(
        bytes: &[u8],
        at: usize,
        data_words: u16,
        ptr_words: u16,
    ) -> Result<(), DecodeError> {
        let words = section_words(data_words, ptr_words)?;
        Self::require_word_range(bytes, at, words)
    }

    /// Require `words` words starting at `at` to fit inside the message.
    pub(crate) fn require_word_range(
        bytes: &[u8],
        at: usize,
        words: usize,
    ) -> Result<(), DecodeError> {
        let end = at.checked_add(words).ok_or(DecodeError::LimitExceeded)?;
        (end <= bytes.len() / WORD_BYTES)
            .then_some(())
            .ok_or(DecodeError::PointerOutOfBounds { word_index: at })
    }
}

/// Return a struct's total section width.
fn section_words(data_words: u16, ptr_words: u16) -> Result<usize, DecodeError> {
    usize::from(data_words)
        .checked_add(usize::from(ptr_words))
        .ok_or(DecodeError::LimitExceeded)
}
