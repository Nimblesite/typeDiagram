//! [TDBIN-COL-GROUP] [TDBIN-COL-PLAN] [TDBIN-COL-VAR] [TDBIN-COL-VALIDITY]
//! [TDBIN-COL-UNION] [TDBIN-COL-EVOLVE] Columnar runtime conformance: a
//! generated-style record/union column group round-trips through every column
//! form (var, bit, word, validity, dense child group, dense union payloads,
//! nested list), null columns decode to defaults across schema evolution, and
//! malformed columns surface typed errors — never panics.

use tdbin::{ColumnGroup, DecodeError, EncodeError, Reader, Struct, TdBin, Writer};

/// A nested record reached through a dense group.
#[derive(Debug, Clone, PartialEq, Default)]
struct Home {
    /// Street line.
    street: String,
    /// Postal code.
    zip: i64,
}

/// A payload-bearing union stored as a dense union column group.
#[derive(Debug, Clone, PartialEq)]
enum Kind {
    /// Payload variant.
    Housed(Home),
    /// Bare variant.
    Roaming,
}

impl Default for Kind {
    fn default() -> Self {
        Self::Housed(Home::default())
    }
}

/// The columnar row type exercising every column form.
#[derive(Debug, Clone, PartialEq, Default)]
struct Row {
    /// Var column (slots 0-1).
    name: String,
    /// Word column (slot 2).
    age: i64,
    /// Bit column (slot 3).
    flag: bool,
    /// Validity (slot 4) + var column (slots 5-6).
    nick: Option<String>,
    /// Validity (slot 7) + dense child group (slot 8).
    home: Option<Home>,
    /// Dense union group (slot 9).
    kind: Kind,
    /// Nested list: row counts (slot 10) + var column (slots 11-12).
    tags: Vec<String>,
}

/// Root wrapper holding the columnar list.
#[derive(Debug, Clone, PartialEq, Default)]
struct Batch {
    /// The columnar rows.
    rows: Vec<Row>,
}

impl ColumnGroup for Home {
    const COLUMNS: u16 = 3;

    fn write_group<'v, I>(
        items: I,
        count: usize,
        w: &mut Writer,
        at: usize,
    ) -> Result<(), EncodeError>
    where
        I: Iterator<Item = &'v Self> + Clone,
        Self: 'v,
    {
        w.var_column(
            at,
            1,
            0,
            1,
            count,
            items.clone().map(|row| row.street.as_bytes()),
        )?;
        w.i64_column(at, 1, 2, count, items.clone().map(|row| row.zip))
    }

    fn read_group(r: &Reader<'_>, at: usize, count: usize) -> Result<Vec<Self>, DecodeError> {
        let street = r.var_column(at, 0, 1, count)?.into_strings()?;
        let zip = r.i64_column(at, 2, count)?;
        Ok(street
            .into_iter()
            .zip(zip)
            .map(|(street, zip)| Self { street, zip })
            .collect())
    }
}

impl ColumnGroup for Kind {
    const COLUMNS: u16 = 2;

    fn write_group<'v, I>(
        items: I,
        count: usize,
        w: &mut Writer,
        at: usize,
    ) -> Result<(), EncodeError>
    where
        I: Iterator<Item = &'v Self> + Clone,
        Self: 'v,
    {
        w.byte_column(
            at,
            1,
            0,
            count,
            items.clone().map(|row| match row {
                Self::Housed(_) => 0_u8,
                Self::Roaming => 1_u8,
            }),
        )?;
        let housed_count = items
            .clone()
            .filter(|row| matches!(row, Self::Housed(_)))
            .count();
        w.dense_group(
            at,
            1,
            1,
            housed_count,
            items.clone().filter_map(|row| match row {
                Self::Housed(payload) => Some(payload),
                Self::Roaming => None,
            }),
        )
    }

    fn read_group(r: &Reader<'_>, at: usize, count: usize) -> Result<Vec<Self>, DecodeError> {
        let tags = r.byte_column(at, 0, count)?;
        let housed_count = tags.iter().map(|tag| usize::from(*tag == 0)).sum();
        let mut housed = r.dense_group::<Home>(at, 1, housed_count)?.into_iter();
        let mut rows = Vec::with_capacity(count);
        for tag in tags {
            rows.push(match tag {
                0 => Self::Housed(housed.next().ok_or(DecodeError::MalformedColumn)?),
                1 => Self::Roaming,
                ordinal => {
                    return Err(DecodeError::UnknownVariant {
                        ordinal: u64::from(ordinal),
                    });
                }
            });
        }
        Ok(rows)
    }
}

impl ColumnGroup for Row {
    const COLUMNS: u16 = 13;

    fn write_group<'v, I>(
        items: I,
        count: usize,
        w: &mut Writer,
        at: usize,
    ) -> Result<(), EncodeError>
    where
        I: Iterator<Item = &'v Self> + Clone,
        Self: 'v,
    {
        w.var_column(
            at,
            1,
            0,
            1,
            count,
            items.clone().map(|row| row.name.as_bytes()),
        )?;
        w.i64_block_column(at, 1, 2, count, items.clone().map(|row| row.age))?;
        w.bit_column(at, 1, 3, count, items.clone().map(|row| row.flag))?;
        w.bit_column(at, 1, 4, count, items.clone().map(|row| row.nick.is_some()))?;
        w.var_column(
            at,
            1,
            5,
            6,
            count,
            items
                .clone()
                .map(|row| row.nick.as_deref().unwrap_or_default().as_bytes()),
        )?;
        w.bit_column(at, 1, 7, count, items.clone().map(|row| row.home.is_some()))?;
        let home_count = items.clone().filter(|row| row.home.is_some()).count();
        w.dense_group(
            at,
            1,
            8,
            home_count,
            items.clone().filter_map(|row| row.home.as_ref()),
        )?;
        w.dense_group(at, 1, 9, count, items.clone().map(|row| &row.kind))?;
        write_tags(items, count, w, at)
    }

    fn read_group(r: &Reader<'_>, at: usize, count: usize) -> Result<Vec<Self>, DecodeError> {
        let columns = RowColumns::read(r, at, count)?;
        columns.build(count)
    }
}

/// Write the nested `tags` list: a row-count column then one var column over
/// the concatenated tags of every row ([TDBIN-COL-PLAN]).
fn write_tags<'v, I>(items: I, count: usize, w: &mut Writer, at: usize) -> Result<(), EncodeError>
where
    I: Iterator<Item = &'v Row> + Clone,
{
    let counts = items
        .clone()
        .map(|row| u32::try_from(row.tags.len()))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| EncodeError::LimitExceeded)?;
    w.u32_column(at, 1, 10, count, counts.iter().copied())?;
    let total = items
        .clone()
        .map(|row| row.tags.len())
        .try_fold(0_usize, usize::checked_add)
        .ok_or(EncodeError::LimitExceeded)?;
    w.var_column(
        at,
        1,
        11,
        12,
        total,
        items.flat_map(|row| row.tags.iter()).map(String::as_bytes),
    )
}

/// Materialized columns of a [`Row`] group, ready to zip into rows.
struct RowColumns {
    /// Decoded `name` values in row order.
    name: std::vec::IntoIter<String>,
    /// Aligned `age` column.
    age: Vec<i64>,
    /// Aligned `flag` column.
    flag: Vec<bool>,
    /// `nick` validity bits.
    nick_valid: Vec<bool>,
    /// Aligned `nick` values (empty for absent rows).
    nick: std::vec::IntoIter<String>,
    /// `home` validity bits.
    home_valid: Vec<bool>,
    /// Dense `home` rows.
    home: std::vec::IntoIter<Home>,
    /// Aligned `kind` rows.
    kind: std::vec::IntoIter<Kind>,
    /// Per-row `tags` counts.
    tags_counts: Vec<u32>,
    /// Concatenated `tags` values.
    tags: std::vec::IntoIter<String>,
}

impl RowColumns {
    /// Bulk-read every column of the group.
    fn read(r: &Reader<'_>, at: usize, count: usize) -> Result<Self, DecodeError> {
        let home_valid = r.bit_column(at, 7, count)?;
        let home_count = home_valid.iter().filter(|present| **present).count();
        let tags_counts = r.u32_column(at, 10, count)?;
        let tags_total = tdbin::column_total(&tags_counts)?;
        Ok(Self {
            name: r.var_column(at, 0, 1, count)?.into_strings()?.into_iter(),
            age: r.i64_block_column(at, 2, count)?,
            flag: r.bit_column(at, 3, count)?,
            nick_valid: r.bit_column(at, 4, count)?,
            nick: r.var_column(at, 5, 6, count)?.into_strings()?.into_iter(),
            home_valid,
            home: r.dense_group::<Home>(at, 8, home_count)?.into_iter(),
            kind: r.dense_group::<Kind>(at, 9, count)?.into_iter(),
            tags_counts,
            tags: r
                .var_column(at, 11, 12, tags_total)?
                .into_strings()?
                .into_iter(),
        })
    }

    /// Zip the columns back into rows.
    fn build(mut self, count: usize) -> Result<Vec<Row>, DecodeError> {
        let mut rows = Vec::with_capacity(count);
        for i in 0..count {
            rows.push(self.build_row(i)?);
        }
        Ok(rows)
    }

    /// Build row `i`, consuming aligned and dense cursors.
    fn build_row(&mut self, i: usize) -> Result<Row, DecodeError> {
        let nick_text = self.nick.next().ok_or(DecodeError::MalformedColumn)?;
        let home = if self.home_valid.get(i).copied().unwrap_or_default() {
            Some(self.home.next().ok_or(DecodeError::MalformedColumn)?)
        } else {
            None
        };
        let tags_len = usize::try_from(self.tags_counts.get(i).copied().unwrap_or_default())
            .map_err(|_| DecodeError::LimitExceeded)?;
        let tags = (0..tags_len)
            .map(|_| self.tags.next().ok_or(DecodeError::MalformedColumn))
            .collect::<Result<Vec<_>, _>>()?;
        Ok(Row {
            name: self.name.next().ok_or(DecodeError::MalformedColumn)?,
            age: self.age.get(i).copied().unwrap_or_default(),
            flag: self.flag.get(i).copied().unwrap_or_default(),
            nick: self
                .nick_valid
                .get(i)
                .copied()
                .unwrap_or_default()
                .then_some(nick_text),
            home,
            kind: self.kind.next().ok_or(DecodeError::MalformedColumn)?,
            tags,
        })
    }
}

impl Struct for Batch {
    const DATA_WORDS: u16 = 0;
    const PTR_WORDS: u16 = 1;

    fn write_struct(&self, w: &mut Writer, at: usize) -> Result<(), EncodeError> {
        w.column_list(at, Self::DATA_WORDS, 0, Some(&self.rows))
    }

    fn read_struct(r: &Reader<'_>, at: usize) -> Result<Self, DecodeError> {
        let rows = r
            .column_list::<Row>(at, Self::DATA_WORDS, 0)?
            .unwrap_or_default();
        Ok(Self { rows })
    }
}

/// An older Row schema knowing only the first two columns ([TDBIN-COL-EVOLVE]).
#[derive(Debug, Clone, PartialEq, Default)]
struct RowV0 {
    /// Var column (slots 0-1).
    name: String,
    /// Word column (slot 2).
    age: i64,
}

impl ColumnGroup for RowV0 {
    const COLUMNS: u16 = 3;

    fn write_group<'v, I>(
        items: I,
        count: usize,
        w: &mut Writer,
        at: usize,
    ) -> Result<(), EncodeError>
    where
        I: Iterator<Item = &'v Self> + Clone,
        Self: 'v,
    {
        w.var_column(
            at,
            1,
            0,
            1,
            count,
            items.clone().map(|row| row.name.as_bytes()),
        )?;
        w.i64_block_column(at, 1, 2, count, items.clone().map(|row| row.age))
    }

    fn read_group(r: &Reader<'_>, at: usize, count: usize) -> Result<Vec<Self>, DecodeError> {
        let name = r.var_column(at, 0, 1, count)?.into_strings()?;
        let age = r.i64_block_column(at, 2, count)?;
        Ok(name
            .into_iter()
            .zip(age)
            .map(|(name, age)| Self { name, age })
            .collect())
    }
}

/// Older batch schema over [`RowV0`].
#[derive(Debug, Clone, PartialEq, Default)]
struct BatchV0 {
    /// The columnar rows.
    rows: Vec<RowV0>,
}

impl Struct for BatchV0 {
    const DATA_WORDS: u16 = 0;
    const PTR_WORDS: u16 = 1;

    fn write_struct(&self, w: &mut Writer, at: usize) -> Result<(), EncodeError> {
        w.column_list(at, Self::DATA_WORDS, 0, Some(&self.rows))
    }

    fn read_struct(r: &Reader<'_>, at: usize) -> Result<Self, DecodeError> {
        let rows = r
            .column_list::<RowV0>(at, Self::DATA_WORDS, 0)?
            .unwrap_or_default();
        Ok(Self { rows })
    }
}

/// A writer that lies about its lengths column ([TDBIN-COL-VAR] violation).
#[derive(Debug, Clone, PartialEq, Default)]
struct LyingRow {
    /// Var column whose lengths column is written one row short.
    name: String,
}

impl ColumnGroup for LyingRow {
    const COLUMNS: u16 = 2;

    fn write_group<'v, I>(
        items: I,
        count: usize,
        w: &mut Writer,
        at: usize,
    ) -> Result<(), EncodeError>
    where
        I: Iterator<Item = &'v Self> + Clone,
        Self: 'v,
    {
        let short = count.saturating_sub(1);
        w.var_column(
            at,
            1,
            0,
            1,
            short,
            items.take(short).map(|row| row.name.as_bytes()),
        )
    }

    fn read_group(r: &Reader<'_>, at: usize, count: usize) -> Result<Vec<Self>, DecodeError> {
        let name = r.var_column(at, 0, 1, count)?.into_strings()?;
        Ok(name.into_iter().map(|name| Self { name }).collect())
    }
}

/// Root over the lying rows.
#[derive(Debug, Clone, PartialEq, Default)]
struct LyingBatch {
    /// The malformed rows.
    rows: Vec<LyingRow>,
}

impl Struct for LyingBatch {
    const DATA_WORDS: u16 = 0;
    const PTR_WORDS: u16 = 1;

    fn write_struct(&self, w: &mut Writer, at: usize) -> Result<(), EncodeError> {
        w.column_list(at, Self::DATA_WORDS, 0, Some(&self.rows))
    }

    fn read_struct(r: &Reader<'_>, at: usize) -> Result<Self, DecodeError> {
        let rows = r
            .column_list::<LyingRow>(at, Self::DATA_WORDS, 0)?
            .unwrap_or_default();
        Ok(Self { rows })
    }
}

/// Build a value-dense fixture batch covering presence, unicode, and empties.
fn fixture_batch() -> Batch {
    Batch {
        rows: vec![
            Row {
                name: "Ada".to_owned(),
                age: 36,
                flag: true,
                nick: Some("Countess".to_owned()),
                home: Some(Home {
                    street: "1 Analytical Way".to_owned(),
                    zip: 1815,
                }),
                kind: Kind::Housed(Home {
                    street: "Über-Straße 12 🚀".to_owned(),
                    zip: -7,
                }),
                tags: vec!["math".to_owned(), String::new(), "poetry".to_owned()],
            },
            Row {
                name: String::new(),
                age: -1,
                flag: false,
                nick: Some(String::new()),
                home: None,
                kind: Kind::Roaming,
                tags: Vec::new(),
            },
            Row {
                name: "Grace".to_owned(),
                age: 85,
                flag: true,
                nick: None,
                home: None,
                kind: Kind::Roaming,
                tags: vec!["navy".to_owned()],
            },
        ],
    }
}

#[test]
fn columnar_batch_round_trips_every_column_form() {
    let batch = fixture_batch();
    let bare = batch.to_bytes().unwrap_or_default();
    assert!(!bare.is_empty(), "[TDBIN-COL-GROUP] bare encode succeeds");
    assert_eq!(bare.len() % 8, 0, "[TDBIN-WIRE-WORD] word-aligned body");
    let decoded = Batch::from_bytes(&bare).unwrap_or_default();
    assert_eq!(decoded, batch, "[TDBIN-COL-GROUP] value identity");
    let reencoded = decoded.to_bytes().unwrap_or_default();
    assert_eq!(
        reencoded, bare,
        "[TDBIN-ENC-CANON] byte-identical re-encode"
    );
    let framed = batch.to_framed_bytes(None).unwrap_or_default();
    assert_eq!(
        Batch::from_framed_bytes(&framed).ok(),
        Some(batch.clone()),
        "[TDBIN-MSG-FRAME] framed round trip"
    );
    let packed = batch.to_packed_framed_bytes(None).unwrap_or_default();
    assert!(
        packed.len() < framed.len(),
        "[TDBIN-PACK] packing shrinks the columnar body"
    );
    assert_eq!(
        Batch::from_framed_bytes(&packed).ok(),
        Some(batch.clone()),
        "[TDBIN-PACK] packed framed round trip"
    );
    let empty = Batch { rows: Vec::new() };
    let empty_bare = empty.to_bytes().unwrap_or_default();
    assert_eq!(
        empty_bare.len(),
        16,
        "[TDBIN-COL-GROUP] empty required list is the null pointer"
    );
    assert_eq!(Batch::from_bytes(&empty_bare).ok(), Some(empty));
    let distinct = Batch {
        rows: vec![Row::default()],
    };
    assert_ne!(
        distinct.to_bytes().unwrap_or_default(),
        bare,
        "distinct values encode distinctly"
    );
}

#[test]
fn null_columns_decode_to_defaults_across_evolution() {
    let old = BatchV0 {
        rows: vec![
            RowV0 {
                name: "Ada".to_owned(),
                age: 36,
            },
            RowV0 {
                name: "Alan".to_owned(),
                age: 41,
            },
        ],
    };
    let bytes = old.to_bytes().unwrap_or_default();
    let upgraded = Batch::from_bytes(&bytes).unwrap_or_default();
    assert_eq!(upgraded.rows.len(), 2, "[TDBIN-COL-EVOLVE] row count kept");
    let first = upgraded.rows.first().cloned().unwrap_or_default();
    assert_eq!(first.name, "Ada");
    assert_eq!(first.age, 36);
    assert!(!first.flag, "[TDBIN-COL-EVOLVE] missing bit column");
    assert_eq!(first.nick, None, "[TDBIN-COL-EVOLVE] missing validity");
    assert_eq!(first.home, None);
    assert_eq!(first.kind, Kind::default(), "missing union group defaults");
    assert!(first.tags.is_empty(), "missing nested list defaults");
    let newer = fixture_batch().to_bytes().unwrap_or_default();
    let downgraded = BatchV0::from_bytes(&newer).unwrap_or_default();
    assert_eq!(
        downgraded
            .rows
            .iter()
            .map(|row| row.age)
            .collect::<Vec<_>>(),
        vec![36, -1, 85],
        "[TDBIN-COL-EVOLVE] older reader ignores extension columns"
    );
}

#[test]
fn malformed_columns_surface_typed_errors() {
    let lying = LyingBatch {
        rows: vec![
            LyingRow {
                name: "one".to_owned(),
            },
            LyingRow {
                name: "two".to_owned(),
            },
        ],
    };
    let bytes = lying.to_bytes().unwrap_or_default();
    assert_eq!(
        LyingBatch::from_bytes(&bytes),
        Err(DecodeError::MalformedColumn),
        "[TDBIN-COL-VAR] short lengths column is rejected"
    );
    let batch = fixture_batch();
    let bare = batch.to_bytes().unwrap_or_default();
    for cut in (8..bare.len().min(96)).step_by(8) {
        let truncated = bare.get(..cut).unwrap_or_default();
        assert!(
            Batch::from_bytes(truncated).is_err(),
            "[TDBIN-SAFE-BOUNDS] truncation at {cut} errors, never panics"
        );
    }
}

#[test]
fn unknown_union_tag_is_a_typed_error() {
    let batch = Batch {
        rows: vec![Row {
            kind: Kind::Roaming,
            ..Row::default()
        }],
    };
    let mut bytes = batch.to_bytes().unwrap_or_default();
    let tag_offset = find_tag_offset(&bytes);
    if let Some(cell) = bytes.get_mut(tag_offset) {
        *cell = 9;
    }
    assert_eq!(
        Batch::from_bytes(&bytes),
        Err(DecodeError::UnknownVariant { ordinal: 9 }),
        "[TDBIN-COL-UNION] unknown tag surfaces UnknownVariant"
    );
}

/// Locate the single union tag byte: the encoded fixture stores the tag
/// column as the only byte list holding exactly `1` (the Roaming ordinal),
/// so find the last 0x01 byte whose word is otherwise zero.
fn find_tag_offset(bytes: &[u8]) -> usize {
    let mut offset = 0;
    for (index, chunk) in bytes.chunks_exact(8).enumerate() {
        let word = u64::from_le_bytes(<[u8; 8]>::try_from(chunk).unwrap_or_default());
        if word == 1 {
            offset = index.wrapping_mul(8);
        }
    }
    offset
}

/// Root wrapper around a bare `List<Int>` stored as one delta block.
#[derive(Debug, Clone, PartialEq, Default)]
struct Ints {
    /// The packed integers.
    values: Vec<i64>,
}

impl Struct for Ints {
    const DATA_WORDS: u16 = 0;
    const PTR_WORDS: u16 = 1;

    fn write_struct(&self, w: &mut Writer, at: usize) -> Result<(), EncodeError> {
        w.i64_block_list(at, Self::DATA_WORDS, 0, Some(&self.values))
    }

    fn read_struct(r: &Reader<'_>, at: usize) -> Result<Self, DecodeError> {
        let values = r
            .i64_block_list(at, Self::DATA_WORDS, 0)?
            .unwrap_or_default();
        Ok(Self { values })
    }
}

#[test]
fn int_block_columns_round_trip_every_edge() {
    let vectors: Vec<Vec<i64>> = vec![
        Vec::new(),
        vec![0],
        vec![i64::MIN, i64::MAX, 0, -1, 1],
        (0..4096)
            .map(|i| 0x4000_0000_0000_0000_i64.wrapping_add(i))
            .collect(),
        (0..257).map(|i| i64::from(i % 2) * -987_654_321).collect(),
        vec![42; 1000],
        (0..63).map(|i| 1_i64.wrapping_shl(i)).collect(),
    ];
    for values in vectors {
        let ints = Ints {
            values: values.clone(),
        };
        let bytes = ints.to_bytes().unwrap_or_default();
        assert_eq!(
            Ints::from_bytes(&bytes).ok().map(|decoded| decoded.values),
            Some(values.clone()),
            "[TDBIN-COL-INTBLOCK] round trip for {} values",
            values.len()
        );
        let repacked = Ints::from_bytes(&bytes)
            .unwrap_or_default()
            .to_bytes()
            .unwrap_or_default();
        assert_eq!(repacked, bytes, "[TDBIN-ENC-CANON] canonical block bytes");
    }
    let monotonic = Ints {
        values: (0..4096)
            .map(|i| 0x4000_0000_0000_0000_i64.wrapping_add(i))
            .collect(),
    };
    let bytes = monotonic.to_bytes().unwrap_or_default();
    assert!(
        bytes.len() < 64,
        "[TDBIN-COL-INTBLOCK] 4096 monotonic ids collapse to a header, got {}",
        bytes.len()
    );
}

#[test]
fn malformed_int_blocks_surface_typed_errors() {
    let ints = Ints {
        values: (0..100).collect(),
    };
    let bytes = ints.to_bytes().unwrap_or_default();
    for cut in 8..bytes.len().min(48) {
        let mut truncated = bytes
            .get(..cut.wrapping_mul(8).min(bytes.len()))
            .unwrap_or_default()
            .to_vec();
        truncated.resize(truncated.len().div_ceil(8).wrapping_mul(8), 0);
        assert!(
            Ints::from_bytes(&truncated)
                .ok()
                .map_or(0, |v| v.values.len())
                <= 100,
            "[TDBIN-SAFE] truncation never panics or amplifies"
        );
    }
    let mut forged = bytes.clone();
    if let Some(cell) = forged.get_mut(24) {
        *cell = 0xFF;
    }
    assert!(
        matches!(
            Ints::from_bytes(&forged),
            Ok(_)
                | Err(DecodeError::MalformedColumn
                    | DecodeError::AmplificationExceeded
                    | DecodeError::PointerOutOfBounds { .. })
        ),
        "[TDBIN-COL-INTBLOCK] forged count byte stays a typed result"
    );
    let forged_width = {
        let mut copy = bytes;
        if let Some(cell) = copy.get_mut(36) {
            *cell = 0xF0;
        }
        copy
    };
    assert!(
        Ints::from_bytes(&forged_width).is_err(),
        "[TDBIN-COL-INTBLOCK] impossible width byte is rejected"
    );
}
