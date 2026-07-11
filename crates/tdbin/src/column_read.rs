//! Columnar decode ([TDBIN-COL-GROUP]): bulk per-column reads that
//! materialize rows with sequential, branch-light traversal. Null columns
//! read as all-default rows, which is what makes appended fields
//! backward-compatible ([TDBIN-COL-EVOLVE]). Encode lives in `column.rs`.

use crate::column::{ColumnGroup, MAX_GROUP_ROWS};
use crate::error::DecodeError;
use crate::layout::{self, WORD_BYTES};
use crate::pointer::{
    self, Pointer, ELEM_BIT, ELEM_BYTE, ELEM_EIGHT_BYTES, ELEM_FOUR_BYTES, ELEM_TWO_BYTES,
};
use crate::reader::Reader;

/// A decoded var column: derived-offset slices over one contiguous payload
/// ([TDBIN-COL-VAR]).
#[derive(Debug)]
pub struct VarColumn<'a> {
    /// The borrowed length column at its wire width.
    lengths: LenColumn<'a>,
    /// Every row's bytes, concatenated in row order.
    payload: &'a [u8],
}

/// A borrowed length column: widths decode on the fly, no widening buffer.
#[derive(Debug, Clone, Copy)]
enum LenColumn<'a> {
    /// A missing column: every row reads length zero ([TDBIN-COL-EVOLVE]).
    Absent(usize),
    /// One byte per row.
    Narrow(&'a [u8]),
    /// Two LE bytes per row.
    Mid(&'a [u8]),
    /// Four LE bytes per row.
    Wide(&'a [u8]),
}

impl LenColumn<'_> {
    /// Number of rows.
    fn len(self) -> usize {
        match self {
            Self::Absent(rows) => rows,
            Self::Narrow(bytes) => bytes.len(),
            Self::Mid(bytes) => bytes.len() / 2,
            Self::Wide(bytes) => bytes.len() / 4,
        }
    }

    /// The length at row `i` (rows past the end read zero).
    fn get(self, i: usize) -> usize {
        match self {
            Self::Absent(_) => 0,
            Self::Narrow(bytes) => bytes.get(i).copied().map_or(0, usize::from),
            Self::Mid(bytes) => read_le(bytes, i.wrapping_mul(2), 2),
            Self::Wide(bytes) => read_le(bytes, i.wrapping_mul(4), 4),
        }
    }

    /// Overflow-checked sum of every row length.
    fn total(self) -> Option<usize> {
        (0..self.len()).try_fold(0_usize, |sum, i| sum.checked_add(self.get(i)))
    }
}

/// Read an unsigned little-endian integer of `width` bytes at `at`.
fn read_le(bytes: &[u8], at: usize, width: usize) -> usize {
    bytes.get(at..at.wrapping_add(width)).map_or(0, |slice| {
        slice
            .iter()
            .rev()
            .fold(0_usize, |acc, byte| (acc << 8) | usize::from(*byte))
    })
}

impl<'a> Reader<'a> {
    /// Read an optional columnar list from pointer `slot` ([TDBIN-COL-GROUP]).
    ///
    /// # Errors
    /// Returns [`DecodeError`] on malformed input, depth, or amplification.
    pub fn column_list<C: ColumnGroup>(
        &self,
        at: usize,
        _data_words: u16,
        slot: u16,
    ) -> Result<Option<Vec<C>>, DecodeError> {
        if slot >= self.wire_ptr_words() {
            return Ok(None);
        }
        let ptr_word = self.ptr_index(at, slot)?;
        match pointer::decode(layout::read_word(self.wire(), ptr_word)?)? {
            Pointer::Null => Ok(None),
            Pointer::Struct {
                offset,
                data_words,
                ptr_words,
            } => self
                .read_group_ptr::<C>(ptr_word, offset, data_words, ptr_words)
                .map(Some),
            Pointer::List { .. } => Err(DecodeError::PointerKindMismatch),
        }
    }

    /// Follow a column-group struct pointer and materialize its rows.
    fn read_group_ptr<C: ColumnGroup>(
        &self,
        ptr_word: usize,
        offset: i64,
        data_words: u16,
        ptr_words: u16,
    ) -> Result<Vec<C>, DecodeError> {
        let target = Self::list_start(ptr_word, offset)?;
        Self::require_struct_bounds(self.wire(), target, data_words, ptr_words)?;
        let child = self.descend(data_words, ptr_words)?;
        let sections = usize::from(data_words)
            .checked_add(usize::from(ptr_words))
            .ok_or(DecodeError::LimitExceeded)?;
        child.charge(sections)?;
        let count = usize::try_from(child.scalar(target, 0)?)
            .ok()
            .filter(|rows| *rows <= MAX_GROUP_ROWS)
            .ok_or(DecodeError::MalformedColumn)?;
        child.charge_materialized(count)?;
        let rows = C::read_group(&child, target, count)?;
        child.verify_slots_from(target, C::COLUMNS)?;
        (rows.len() == count)
            .then_some(rows)
            .ok_or(DecodeError::MalformedColumn)
    }

    /// Read a bit column as one bool per row ([TDBIN-COL-VALIDITY]).
    ///
    /// # Errors
    /// Returns [`DecodeError`] on malformed input.
    pub fn bit_column(&self, at: usize, slot: u16, count: usize) -> Result<Vec<bool>, DecodeError> {
        self.read_list(at, slot, ELEM_BIT, |r, p, o, c| {
            require_count(c, count)?;
            r.read_bool_body(p, o, c)
        })
        .map(|column| column.unwrap_or_else(|| vec![false; count]))
    }

    /// Read a raw word column ([TDBIN-COL-PLAN]).
    ///
    /// # Errors
    /// Returns [`DecodeError`] on malformed input.
    pub fn word_column(&self, at: usize, slot: u16, count: usize) -> Result<Vec<u64>, DecodeError> {
        self.read_list(at, slot, ELEM_EIGHT_BYTES, |r, p, o, c| {
            require_count(c, count)?;
            r.read_word_body(p, o, c, u64::from_le_bytes)
        })
        .map(|column| column.unwrap_or_else(|| vec![0; count]))
    }

    /// Read an `i64` column ([TDBIN-COL-PLAN]).
    ///
    /// # Errors
    /// Returns [`DecodeError`] on malformed input.
    pub fn i64_column(&self, at: usize, slot: u16, count: usize) -> Result<Vec<i64>, DecodeError> {
        self.read_list(at, slot, ELEM_EIGHT_BYTES, |r, p, o, c| {
            require_count(c, count)?;
            r.read_word_body(p, o, c, i64::from_le_bytes)
        })
        .map(|column| column.unwrap_or_else(|| vec![0; count]))
    }

    /// Read an `f64` column ([TDBIN-COL-PLAN]).
    ///
    /// # Errors
    /// Returns [`DecodeError`] on malformed input.
    pub fn f64_column(&self, at: usize, slot: u16, count: usize) -> Result<Vec<f64>, DecodeError> {
        self.read_list(at, slot, ELEM_EIGHT_BYTES, |r, p, o, c| {
            require_count(c, count)?;
            r.read_word_body(p, o, c, f64::from_le_bytes)
        })
        .map(|column| column.unwrap_or_else(|| vec![0.0; count]))
    }

    /// Read a byte column: union tags and enum ordinals ([TDBIN-COL-UNION]).
    ///
    /// # Errors
    /// Returns [`DecodeError`] on malformed input.
    pub fn byte_column(&self, at: usize, slot: u16, count: usize) -> Result<Vec<u8>, DecodeError> {
        self.read_list(at, slot, ELEM_BYTE, |r, p, o, c| {
            require_count(c, count)?;
            r.read_byte_slice(p, o, ELEM_BYTE, c).map(<[u8]>::to_vec)
        })
        .map(|column| column.unwrap_or_else(|| vec![0; count]))
    }

    /// Read a u32 column: var lengths and nested row counts ([TDBIN-COL-VAR]).
    ///
    /// # Errors
    /// Returns [`DecodeError`] on malformed input.
    pub fn u32_column(&self, at: usize, slot: u16, count: usize) -> Result<Vec<u32>, DecodeError> {
        self.read_list(at, slot, ELEM_FOUR_BYTES, |r, p, o, c| {
            require_count(c, count)?;
            r.read_u32_body(p, o, c)
        })
        .map(|column| column.unwrap_or_else(|| vec![0; count]))
    }

    /// Read a var column: lengths plus contiguous payload ([TDBIN-COL-VAR]).
    ///
    /// # Errors
    /// Returns [`DecodeError`] when lengths and payload disagree.
    pub fn var_column(
        &self,
        at: usize,
        len_slot: u16,
        payload_slot: u16,
        count: usize,
    ) -> Result<VarColumn<'a>, DecodeError> {
        let lengths = self
            .len_source(at, len_slot, Some(count))?
            .unwrap_or(LenColumn::Absent(count));
        (lengths.len() == count)
            .then_some(())
            .ok_or(DecodeError::MalformedColumn)?;
        self.assemble_var(at, payload_slot, lengths, count)
    }

    /// Borrow an adaptive-width length column; `expected` pins the row count.
    fn len_source(
        &self,
        at: usize,
        slot: u16,
        expected: Option<usize>,
    ) -> Result<Option<LenColumn<'a>>, DecodeError> {
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
            } => {
                if let Some(rows) = expected {
                    require_count(count, rows)?;
                }
                self.borrow_len_body(ptr_word, offset, elem, count)
                    .map(Some)
            }
            Pointer::Struct { .. } => Err(DecodeError::PointerKindMismatch),
        }
    }

    /// Borrow a length column body at its wire width.
    fn borrow_len_body(
        &self,
        ptr_word: usize,
        offset: i64,
        elem: u8,
        count: u32,
    ) -> Result<LenColumn<'a>, DecodeError> {
        match elem {
            ELEM_BYTE => Ok(LenColumn::Narrow(
                self.read_byte_slice(ptr_word, offset, elem, count)?,
            )),
            ELEM_TWO_BYTES => self
                .borrow_raw(ptr_word, offset, count, 2)
                .map(LenColumn::Mid),
            ELEM_FOUR_BYTES => self
                .borrow_raw(ptr_word, offset, count, 4)
                .map(LenColumn::Wide),
            _ => Err(DecodeError::PointerKindMismatch),
        }
    }

    /// Borrow and charge a raw fixed-width list body.
    fn borrow_raw(
        &self,
        ptr_word: usize,
        offset: i64,
        count: u32,
        width: usize,
    ) -> Result<&'a [u8], DecodeError> {
        let start = Self::list_start(ptr_word, offset)?;
        let len = usize::try_from(count).map_err(|_| DecodeError::LimitExceeded)?;
        let bytes = len.checked_mul(width).ok_or(DecodeError::LimitExceeded)?;
        let words = bytes.div_ceil(WORD_BYTES);
        Self::require_word_range(self.wire(), start, words)?;
        self.charge(words)?;
        let start_byte = start
            .checked_mul(WORD_BYTES)
            .ok_or(DecodeError::LimitExceeded)?;
        let end_byte = start_byte
            .checked_add(bytes)
            .ok_or(DecodeError::LimitExceeded)?;
        self.wire()
            .get(start_byte..end_byte)
            .ok_or(DecodeError::PointerOutOfBounds { word_index: start })
    }

    /// Read a length column at whatever canonical width it was written:
    /// u8, u16, or u32 elements ([TDBIN-COL-VAR]).
    ///
    /// # Errors
    /// Returns [`DecodeError`] on malformed input or a count mismatch.
    pub fn len_column(&self, at: usize, slot: u16, count: usize) -> Result<Vec<u32>, DecodeError> {
        self.len_source(at, slot, Some(count))?.map_or_else(
            || Ok(vec![0; count]),
            |lengths| {
                Ok((0..lengths.len())
                    .map(|i| u32::try_from(lengths.get(i)).unwrap_or(u32::MAX))
                    .collect())
            },
        )
    }

    /// Read an optional `List<String>`/`List<Bytes>` field encoded as a var
    /// column pair; the length column carries the row count ([TDBIN-COL-VAR]).
    ///
    /// # Errors
    /// Returns [`DecodeError`] when lengths and payload disagree.
    pub fn var_list(
        &self,
        at: usize,
        _data_words: u16,
        len_slot: u16,
        payload_slot: u16,
    ) -> Result<Option<VarColumn<'a>>, DecodeError> {
        match self.len_source(at, len_slot, None)? {
            None => Ok(None),
            Some(lengths) => {
                let count = lengths.len();
                self.assemble_var(at, payload_slot, lengths, count)
                    .map(Some)
            }
        }
    }

    /// Pair borrowed lengths with their payload column.
    fn assemble_var(
        &self,
        at: usize,
        payload_slot: u16,
        lengths: LenColumn<'a>,
        _count: usize,
    ) -> Result<VarColumn<'a>, DecodeError> {
        let payload = self
            .read_list(at, payload_slot, ELEM_BYTE, |r, p, o, c| {
                r.read_byte_slice(p, o, ELEM_BYTE, c)
            })?
            .unwrap_or(&[]);
        (lengths.total() == Some(payload.len()))
            .then_some(VarColumn { lengths, payload })
            .ok_or(DecodeError::MalformedColumn)
    }

    /// Read a delta bit-packed integer column ([TDBIN-COL-INTBLOCK]).
    ///
    /// # Errors
    /// Returns [`DecodeError::MalformedColumn`] when the block disagrees with
    /// the row count.
    pub fn i64_block_column(
        &self,
        at: usize,
        slot: u16,
        count: usize,
    ) -> Result<Vec<i64>, DecodeError> {
        let block = self.read_list(at, slot, ELEM_BYTE, |r, p, o, c| {
            r.read_byte_slice(p, o, ELEM_BYTE, c)
        })?;
        match block {
            None => Ok(vec![0; count]),
            Some(block) => {
                let values = crate::intblock::decode(block)?;
                (values.len() == count)
                    .then_some(values)
                    .ok_or(DecodeError::MalformedColumn)
            }
        }
    }

    /// Read an optional `List<Int>` field stored as a delta bit-packed block
    /// ([TDBIN-COL-INTBLOCK]).
    ///
    /// # Errors
    /// Returns [`DecodeError`] on a malformed block or amplification.
    pub fn i64_block_list(
        &self,
        at: usize,
        _data_words: u16,
        slot: u16,
    ) -> Result<Option<Vec<i64>>, DecodeError> {
        let block = self.read_list(at, slot, ELEM_BYTE, |r, p, o, c| {
            r.read_byte_slice(p, o, ELEM_BYTE, c)
        })?;
        match block {
            None => Ok(None),
            Some(block) => {
                let count = crate::intblock::peek_count(block)?;
                self.charge_materialized(count)?;
                crate::intblock::decode(block).map(Some)
            }
        }
    }

    /// Read a 16-byte semantic-scalar column ([TDBIN-COL-PLAN]).
    ///
    /// # Errors
    /// Returns [`DecodeError`] on malformed input.
    pub fn bytes16_column(
        &self,
        at: usize,
        slot: u16,
        count: usize,
    ) -> Result<Vec<(u64, u64)>, DecodeError> {
        self.bytes16_list(at, 1, slot)?.map_or_else(
            || Ok(vec![(0, 0); count]),
            |column| {
                (column.len() == count)
                    .then_some(column)
                    .ok_or(DecodeError::MalformedColumn)
            },
        )
    }

    /// Read a dense child group of exactly `count` rows; a null column is
    /// `count` default rows ([TDBIN-COL-UNION], [TDBIN-COL-EVOLVE]).
    ///
    /// # Errors
    /// Returns [`DecodeError`] when the group's row count disagrees.
    pub fn dense_group<C: ColumnGroup + Default>(
        &self,
        at: usize,
        slot: u16,
        count: usize,
    ) -> Result<Vec<C>, DecodeError> {
        let rows = self.column_list::<C>(at, 1, slot)?;
        match rows {
            None => Ok((0..count).map(|_| C::default()).collect()),
            Some(rows) => (rows.len() == count)
                .then_some(rows)
                .ok_or(DecodeError::MalformedColumn),
        }
    }

    /// Read a raw u32 list body.
    fn read_u32_body(
        &self,
        ptr_word: usize,
        offset: i64,
        count: u32,
    ) -> Result<Vec<u32>, DecodeError> {
        let start = Self::list_start(ptr_word, offset)?;
        let len = usize::try_from(count).map_err(|_| DecodeError::LimitExceeded)?;
        let bytes = len.checked_mul(4).ok_or(DecodeError::LimitExceeded)?;
        let words = bytes.div_ceil(WORD_BYTES);
        Self::require_word_range(self.wire(), start, words)?;
        self.charge(words)?;
        let start_byte = start
            .checked_mul(WORD_BYTES)
            .ok_or(DecodeError::LimitExceeded)?;
        let end_byte = start_byte
            .checked_add(bytes)
            .ok_or(DecodeError::LimitExceeded)?;
        let src = self
            .wire()
            .get(start_byte..end_byte)
            .ok_or(DecodeError::PointerOutOfBounds { word_index: start })?;
        Ok(src
            .chunks_exact(4)
            .map(|chunk| u32::from_le_bytes(<[u8; 4]>::try_from(chunk).unwrap_or([0; 4])))
            .collect())
    }
}

impl<'a> VarColumn<'a> {
    /// Number of rows in the column.
    #[must_use]
    pub fn len(&self) -> usize {
        self.lengths.len()
    }

    /// Whether the column has no rows.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.lengths.len() == 0
    }

    /// Materialize every row as an owned UTF-8 string ([TDBIN-SAFE-UTF8]).
    ///
    /// The whole payload is validated once; each row then only needs a
    /// char-boundary check (`str::get`), so short strings skip repeated
    /// validation passes. A row cut mid-character fails the boundary check.
    ///
    /// # Errors
    /// Returns [`DecodeError::InvalidUtf8`] when any row is not UTF-8.
    pub fn into_strings(self) -> Result<Vec<String>, DecodeError> {
        let text = core::str::from_utf8(self.payload).map_err(|_| DecodeError::InvalidUtf8)?;
        let rows = self.lengths.len();
        let mut out = Vec::with_capacity(rows);
        let mut cursor = 0_usize;
        for i in 0..rows {
            let end = cursor
                .checked_add(self.lengths.get(i))
                .ok_or(DecodeError::LimitExceeded)?;
            let slice = text.get(cursor..end).ok_or(DecodeError::InvalidUtf8)?;
            out.push(slice.to_owned());
            cursor = end;
        }
        Ok(out)
    }

    /// Materialize every row as an owned byte vector.
    ///
    /// # Errors
    /// Returns [`DecodeError`] when lengths and payload disagree.
    pub fn into_byte_vecs(self) -> Result<Vec<Vec<u8>>, DecodeError> {
        self.map_rows(|slice| Ok(slice.to_vec()))
    }

    /// Walk the derived row offsets, mapping each payload slice.
    fn map_rows<T>(
        self,
        map: impl Fn(&'a [u8]) -> Result<T, DecodeError>,
    ) -> Result<Vec<T>, DecodeError> {
        let rows = self.lengths.len();
        let mut out = Vec::with_capacity(rows);
        let mut cursor = 0_usize;
        for i in 0..rows {
            let end = cursor
                .checked_add(self.lengths.get(i))
                .ok_or(DecodeError::LimitExceeded)?;
            let slice = self
                .payload
                .get(cursor..end)
                .ok_or(DecodeError::MalformedColumn)?;
            out.push(map(slice)?);
            cursor = end;
        }
        Ok(out)
    }
}

/// Sum a nested-list row-count column with overflow checking
/// ([TDBIN-COL-PLAN]).
///
/// # Errors
/// Returns [`DecodeError::LimitExceeded`] on overflow.
pub fn column_total(counts: &[u32]) -> Result<usize, DecodeError> {
    counts
        .iter()
        .try_fold(0_usize, |sum, count| {
            sum.checked_add(usize::try_from(*count).ok()?)
        })
        .ok_or(DecodeError::LimitExceeded)
}

/// Require a column's element count to equal the group's row count.
fn require_count(actual: u32, expected: usize) -> Result<(), DecodeError> {
    (usize::try_from(actual) == Ok(expected))
        .then_some(())
        .ok_or(DecodeError::MalformedColumn)
}
