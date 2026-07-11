//! Columnar encode: column groups for repeated ADT data ([TDBIN-COL-GROUP],
//! [TDBIN-COL-PLAN]); columns append in slot order after the group struct
//! ([TDBIN-COL-ORDER]). A `List<record>`/`List<union>` under layout major 2
//! becomes one struct whose data word is the row count and whose pointer
//! slots are per-field columns — struct-of-arrays instead of per-element
//! structs (research §3.5). Decode lives in `column_read.rs`.

use crate::error::EncodeError;
use crate::pointer::{self, ELEM_BIT, ELEM_BYTE, ELEM_FOUR_BYTES};
use crate::reader::Reader;
use crate::writer::{rel_offset, Writer};
use crate::DecodeError;

/// Bytes per word.
const WORD_BYTES: usize = 8;
/// Maximum rows in one column group ([TDBIN-WIRE-LIMITS]).
pub(crate) const MAX_GROUP_ROWS: usize = (1 << 29) - 1;

/// A type encodable as a column group: typeDiagram codegen emits one impl per
/// record/union reached by a columnar list ([TDBIN-COL-PLAN]). The column
/// layout is baked in at generation time, exactly like [`crate::Struct`].
pub trait ColumnGroup: Sized {
    /// Pointer slots in the column-group struct (one per column).
    const COLUMNS: u16;

    /// Write every row's columns into the group at word `at`.
    ///
    /// # Errors
    /// Returns [`EncodeError`] if the message exceeds a wire-format limit.
    fn write_group<'v, I>(
        items: I,
        count: usize,
        w: &mut Writer,
        at: usize,
    ) -> Result<(), EncodeError>
    where
        I: Iterator<Item = &'v Self> + Clone,
        Self: 'v;

    /// Materialize `count` rows from the group at word `at`.
    ///
    /// # Errors
    /// Returns [`DecodeError`] on malformed or out-of-bounds input.
    fn read_group(r: &Reader<'_>, at: usize, count: usize) -> Result<Vec<Self>, DecodeError>;
}

impl Writer {
    /// Write a required columnar list into pointer `slot`: an empty list is
    /// the null pointer, its schema default ([TDBIN-COL-GROUP]).
    ///
    /// # Errors
    /// Returns [`EncodeError`] if the message exceeds a wire-format limit.
    pub fn column_list<C: ColumnGroup>(
        &mut self,
        at: usize,
        data_words: u16,
        slot: u16,
        value: Option<&[C]>,
    ) -> Result<(), EncodeError> {
        let ptr_word = Self::ptr_index(at, data_words, slot)?;
        match value {
            None | Some([]) => self.set(ptr_word, 0),
            Some(items) => self.write_group(ptr_word, items.len(), items.iter()),
        }
    }

    /// Write an `Option<List<...>>` columnar list into pointer `slot`:
    /// `None` is null, `Some(empty)` is a zero-count group ([TDBIN-COL-GROUP]).
    ///
    /// # Errors
    /// Returns [`EncodeError`] if the message exceeds a wire-format limit.
    pub fn opt_column_list<C: ColumnGroup>(
        &mut self,
        at: usize,
        data_words: u16,
        slot: u16,
        value: Option<&[C]>,
    ) -> Result<(), EncodeError> {
        let ptr_word = Self::ptr_index(at, data_words, slot)?;
        match value {
            None => self.set(ptr_word, 0),
            Some(items) => self.write_group(ptr_word, items.len(), items.iter()),
        }
    }

    /// Append a column-group struct and patch its pointer word.
    pub(crate) fn write_group<'v, C, I>(
        &mut self,
        ptr_word: usize,
        count: usize,
        items: I,
    ) -> Result<(), EncodeError>
    where
        C: ColumnGroup + 'v,
        I: Iterator<Item = &'v C> + Clone,
    {
        if count > MAX_GROUP_ROWS {
            return Err(EncodeError::LimitExceeded);
        }
        let words = usize::from(C::COLUMNS)
            .checked_add(1)
            .ok_or(EncodeError::LimitExceeded)?;
        let group_at = self.reserve(words)?;
        let rows = u64::try_from(count).map_err(|_| EncodeError::LimitExceeded)?;
        self.set(group_at, rows)?;
        self.with_descended(|w| C::write_group(items, count, w, group_at))?;
        let offset = rel_offset(group_at, ptr_word)?;
        let ptr = pointer::encode_struct(offset, 1, C::COLUMNS)?;
        self.set(ptr_word, ptr)
    }

    /// Absolute word index of column `slot` in the struct at `group_at`.
    fn group_slot(group_at: usize, data_words: u16, slot: u16) -> Result<usize, EncodeError> {
        Self::ptr_index(group_at, data_words, slot)
    }

    /// Write a bit column: one bit per row ([TDBIN-COL-VALIDITY]).
    ///
    /// # Errors
    /// Returns [`EncodeError`] if the message exceeds a wire-format limit.
    pub fn bit_column(
        &mut self,
        group_at: usize,
        data_words: u16,
        slot: u16,
        count: usize,
        values: impl Iterator<Item = bool>,
    ) -> Result<(), EncodeError> {
        let ptr_word = Self::group_slot(group_at, data_words, slot)?;
        if count == 0 {
            return self.set(ptr_word, 0);
        }
        let start = self.reserve(count.div_ceil(WORD_BYTES * 8))?;
        self.pack_bits(start, values)?;
        self.set_list_ptr(ptr_word, start, ELEM_BIT, count)
    }

    /// Write a raw word column: one 8-byte value per row ([TDBIN-COL-PLAN]).
    ///
    /// # Errors
    /// Returns [`EncodeError`] if the message exceeds a wire-format limit.
    pub fn word_column(
        &mut self,
        group_at: usize,
        data_words: u16,
        slot: u16,
        count: usize,
        values: impl Iterator<Item = u64>,
    ) -> Result<(), EncodeError> {
        let ptr_word = Self::group_slot(group_at, data_words, slot)?;
        match count {
            0 => self.set(ptr_word, 0),
            _ => self.write_words(ptr_word, count, values),
        }
    }

    /// Write an `i64` column ([TDBIN-COL-PLAN]).
    ///
    /// # Errors
    /// Returns [`EncodeError`] if the message exceeds a wire-format limit.
    pub fn i64_column(
        &mut self,
        group_at: usize,
        data_words: u16,
        slot: u16,
        count: usize,
        values: impl Iterator<Item = i64>,
    ) -> Result<(), EncodeError> {
        self.word_column(
            group_at,
            data_words,
            slot,
            count,
            values.map(crate::scalar::i64_bits),
        )
    }

    /// Write an `f64` column ([TDBIN-COL-PLAN]).
    ///
    /// # Errors
    /// Returns [`EncodeError`] if the message exceeds a wire-format limit.
    pub fn f64_column(
        &mut self,
        group_at: usize,
        data_words: u16,
        slot: u16,
        count: usize,
        values: impl Iterator<Item = f64>,
    ) -> Result<(), EncodeError> {
        self.word_column(
            group_at,
            data_words,
            slot,
            count,
            values.map(crate::scalar::f64_bits),
        )
    }

    /// Write a byte column: union tags and enum ordinals ([TDBIN-COL-UNION]).
    ///
    /// # Errors
    /// Returns [`EncodeError`] if the message exceeds a wire-format limit.
    pub fn byte_column(
        &mut self,
        group_at: usize,
        data_words: u16,
        slot: u16,
        count: usize,
        values: impl Iterator<Item = u8>,
    ) -> Result<(), EncodeError> {
        let ptr_word = Self::group_slot(group_at, data_words, slot)?;
        if count == 0 {
            return self.set(ptr_word, 0);
        }
        let start = self.reserve(count.div_ceil(WORD_BYTES))?;
        let dst = self.bytes_mut(start, count)?;
        for (cell, value) in dst.iter_mut().zip(values) {
            *cell = value;
        }
        self.set_list_ptr(ptr_word, start, ELEM_BYTE, count)
    }

    /// Write a u32 column: var-column lengths and nested-list row counts
    /// ([TDBIN-COL-VAR]).
    ///
    /// # Errors
    /// Returns [`EncodeError`] if the message exceeds a wire-format limit.
    pub fn u32_column(
        &mut self,
        group_at: usize,
        data_words: u16,
        slot: u16,
        count: usize,
        values: impl Iterator<Item = u32>,
    ) -> Result<(), EncodeError> {
        let ptr_word = Self::group_slot(group_at, data_words, slot)?;
        if count == 0 {
            return self.set(ptr_word, 0);
        }
        let bytes = count.checked_mul(4).ok_or(EncodeError::LimitExceeded)?;
        let start = self.reserve(bytes.div_ceil(WORD_BYTES))?;
        let dst = self.bytes_mut(start, bytes)?;
        for (chunk, value) in dst.chunks_exact_mut(4).zip(values) {
            chunk.copy_from_slice(&value.to_le_bytes());
        }
        self.set_list_ptr(ptr_word, start, ELEM_FOUR_BYTES, count)
    }

    /// Write a required `List<String>` field as a var column pair: an empty
    /// list is null lengths and null payload ([TDBIN-COL-VAR]).
    ///
    /// # Errors
    /// Returns [`EncodeError`] if the message exceeds a wire-format limit.
    pub fn string_var_list(
        &mut self,
        at: usize,
        data_words: u16,
        len_slot: u16,
        payload_slot: u16,
        value: Option<&[String]>,
    ) -> Result<(), EncodeError> {
        match value {
            None | Some([]) => self.null_var_list(at, data_words, len_slot, payload_slot),
            Some(items) => self.var_column(
                at,
                data_words,
                len_slot,
                payload_slot,
                items.len(),
                items.iter().map(String::as_bytes),
            ),
        }
    }

    /// Write a required `List<Bytes>` field as a var column pair.
    ///
    /// # Errors
    /// Returns [`EncodeError`] if the message exceeds a wire-format limit.
    pub fn bytes_var_list(
        &mut self,
        at: usize,
        data_words: u16,
        len_slot: u16,
        payload_slot: u16,
        value: Option<&[Vec<u8>]>,
    ) -> Result<(), EncodeError> {
        match value {
            None | Some([]) => self.null_var_list(at, data_words, len_slot, payload_slot),
            Some(items) => self.var_column(
                at,
                data_words,
                len_slot,
                payload_slot,
                items.len(),
                items.iter().map(Vec::as_slice),
            ),
        }
    }

    /// Null both slots of a var column pair.
    fn null_var_list(
        &mut self,
        at: usize,
        data_words: u16,
        len_slot: u16,
        payload_slot: u16,
    ) -> Result<(), EncodeError> {
        self.set(Self::ptr_index(at, data_words, len_slot)?, 0)?;
        self.set(Self::ptr_index(at, data_words, payload_slot)?, 0)
    }

    /// Write a length column at the minimal canonical width covering its
    /// largest row: u8, u16, or u32 elements ([TDBIN-COL-VAR]).
    ///
    /// # Errors
    /// Returns [`EncodeError`] if the message exceeds a wire-format limit.
    pub fn len_column(
        &mut self,
        group_at: usize,
        data_words: u16,
        slot: u16,
        lengths: &[u32],
    ) -> Result<(), EncodeError> {
        let widest = lengths.iter().copied().max().unwrap_or(0);
        if widest < 1 << 8 {
            let bytes = lengths.iter().map(|len| u8::try_from(*len).unwrap_or(0));
            self.byte_column(group_at, data_words, slot, lengths.len(), bytes)
        } else if widest < 1 << 16 {
            self.u16_column(group_at, data_words, slot, lengths)
        } else {
            self.u32_column(
                group_at,
                data_words,
                slot,
                lengths.len(),
                lengths.iter().copied(),
            )
        }
    }

    /// Write a u16 column (elem-3 list) for mid-width lengths.
    fn u16_column(
        &mut self,
        group_at: usize,
        data_words: u16,
        slot: u16,
        lengths: &[u32],
    ) -> Result<(), EncodeError> {
        let ptr_word = Self::group_slot(group_at, data_words, slot)?;
        if lengths.is_empty() {
            return self.set(ptr_word, 0);
        }
        let bytes = lengths
            .len()
            .checked_mul(2)
            .ok_or(EncodeError::LimitExceeded)?;
        let start = self.reserve(bytes.div_ceil(8))?;
        let dst = self.bytes_mut(start, bytes)?;
        for (chunk, len) in dst.chunks_exact_mut(2).zip(lengths) {
            chunk.copy_from_slice(&u16::try_from(*len).unwrap_or(0).to_le_bytes());
        }
        self.set_list_ptr(
            ptr_word,
            start,
            crate::pointer::ELEM_TWO_BYTES,
            lengths.len(),
        )
    }

    /// Write a var column: an adaptive-width length per row then the
    /// concatenated payload bytes ([TDBIN-COL-VAR]).
    ///
    /// # Errors
    /// Returns [`EncodeError`] if a row exceeds `u32` or a limit is exceeded.
    pub fn var_column<'v>(
        &mut self,
        group_at: usize,
        data_words: u16,
        len_slot: u16,
        payload_slot: u16,
        count: usize,
        values: impl Iterator<Item = &'v [u8]> + Clone,
    ) -> Result<(), EncodeError> {
        let (lengths, total) = var_lengths(count, values.clone())?;
        self.len_column(group_at, data_words, len_slot, &lengths)?;
        let ptr_word = Self::group_slot(group_at, data_words, payload_slot)?;
        if total == 0 {
            return self.set(ptr_word, 0);
        }
        let start = self.append_concat(total, values)?;
        self.set_list_ptr(ptr_word, start, ELEM_BYTE, total)
    }

    /// Write an integer column or `List<Int>` field as a delta bit-packed
    /// block inside a byte list ([TDBIN-COL-INTBLOCK]); empty is null.
    ///
    /// # Errors
    /// Returns [`EncodeError`] if the message exceeds a wire-format limit.
    pub fn i64_block_column(
        &mut self,
        group_at: usize,
        data_words: u16,
        slot: u16,
        count: usize,
        values: impl Iterator<Item = i64>,
    ) -> Result<(), EncodeError> {
        let ptr_word = Self::group_slot(group_at, data_words, slot)?;
        if count == 0 {
            return self.set(ptr_word, 0);
        }
        let items = values.collect::<Vec<_>>();
        if items.len() != count {
            return Err(EncodeError::LimitExceeded);
        }
        let block = crate::intblock::encode(&items)?;
        self.write_byte_list(ptr_word, &block)
    }

    /// Write a 16-byte semantic-scalar column ([TDBIN-COL-PLAN]).
    ///
    /// # Errors
    /// Returns [`EncodeError`] if the message exceeds a wire-format limit.
    pub fn bytes16_column(
        &mut self,
        group_at: usize,
        data_words: u16,
        slot: u16,
        count: usize,
        values: impl Iterator<Item = (u64, u64)>,
    ) -> Result<(), EncodeError> {
        if count == 0 {
            let ptr_word = Self::group_slot(group_at, data_words, slot)?;
            return self.set(ptr_word, 0);
        }
        let items = values.collect::<Vec<_>>();
        self.bytes16_list(group_at, data_words, slot, Some(&items))
    }

    /// Write a required `List<Int>` field as a delta bit-packed block; empty
    /// is null ([TDBIN-COL-INTBLOCK]).
    ///
    /// # Errors
    /// Returns [`EncodeError`] if the message exceeds a wire-format limit.
    pub fn i64_block_list(
        &mut self,
        at: usize,
        data_words: u16,
        slot: u16,
        value: Option<&[i64]>,
    ) -> Result<(), EncodeError> {
        let ptr_word = Self::group_slot(at, data_words, slot)?;
        match value {
            None | Some([]) => self.set(ptr_word, 0),
            Some(items) => {
                let block = crate::intblock::encode(items)?;
                self.write_byte_list(ptr_word, &block)
            }
        }
    }

    /// Write a dense child group: only present rows contribute, in row order
    /// ([TDBIN-COL-UNION], [TDBIN-COL-VALIDITY]).
    ///
    /// # Errors
    /// Returns [`EncodeError`] if the message exceeds a wire-format limit.
    pub fn dense_group<'v, C, I>(
        &mut self,
        group_at: usize,
        data_words: u16,
        slot: u16,
        count: usize,
        items: I,
    ) -> Result<(), EncodeError>
    where
        C: ColumnGroup + 'v,
        I: Iterator<Item = &'v C> + Clone,
    {
        let ptr_word = Self::group_slot(group_at, data_words, slot)?;
        match count {
            0 => self.set(ptr_word, 0),
            _ => self.write_group(ptr_word, count, items),
        }
    }
}

/// Collect per-row u32 lengths and the checked total payload size.
fn var_lengths<'v>(
    count: usize,
    values: impl Iterator<Item = &'v [u8]>,
) -> Result<(Vec<u32>, usize), EncodeError> {
    let mut lengths = Vec::with_capacity(count);
    let mut total = 0_usize;
    for item in values {
        let len = u32::try_from(item.len()).map_err(|_| EncodeError::LimitExceeded)?;
        total = total
            .checked_add(item.len())
            .ok_or(EncodeError::LimitExceeded)?;
        lengths.push(len);
    }
    Ok((lengths, total))
}
