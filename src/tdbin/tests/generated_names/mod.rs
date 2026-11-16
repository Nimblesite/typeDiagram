//! [TDBIN-CODEGEN-LOCALS] GENERATED name-collision fixture: fields and
//! variants named after the codec's own identifiers (`w`, `r`, `at`,
//! `count`, `items`, `rows`, `i`, `tags`, …), emitted by
//! `src/typediagram/src/converters/rust-tdbin.ts` (`generateRustModule`,
//! layout 2) from `src/typediagram/test/converters/fixtures/names.td`.
//! Compiling and round-tripping it under `cargo test` proves no shadowing.
//! Regenerate with `node src/scripts/tdbin/tdbin-regen-fixtures.mjs`.

// <<<GENERATED — rust-tdbin.ts generateRustModule (layout 2); do not edit by hand>>>
/// The `Inner` record.
#[derive(Debug, Clone, PartialEq, Default, serde::Serialize, serde::Deserialize)]
pub struct Inner {
    /// The `at` field.
    pub at: i64,
    /// The `r` field.
    pub r: String,
}

/// The `Pick` union.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum Pick {
    /// The `W` variant.
    W(Inner),
    /// The `Items` variant.
    Items(Inner),
    /// The `Tags` variant.
    Tags,
    /// The `Count` variant.
    Count(Inner),
}

/// The `Names` record.
#[derive(Debug, Clone, PartialEq, Default, serde::Serialize, serde::Deserialize)]
pub struct Names {
    /// The `value` field.
    pub value: String,
    /// The `writer` field.
    pub writer: i64,
    /// The `reader` field.
    pub reader: i64,
    /// The `tdbin` field.
    pub tdbin: i64,
    /// The `ok` field.
    pub ok: bool,
    /// The `w` field.
    pub w: i64,
    /// The `at` field.
    pub at: i64,
    /// The `r` field.
    pub r: i64,
    /// The `count` field.
    pub count: i64,
    /// The `i` field.
    pub i: bool,
    /// The `items` field.
    pub items: Option<Inner>,
    /// The `rows` field.
    pub rows: Vec<Inner>,
    /// The `tags` field.
    pub tags: Vec<String>,
    /// The `x` field.
    pub x: Option<i64>,
    /// The `xPresent` field.
    #[serde(rename = "xPresent")]
    pub x_present: Option<i64>,
    /// The `pick` field.
    pub pick: Pick,
}

/// The `NamesBatch` record.
#[derive(Debug, Clone, PartialEq, Default, serde::Serialize, serde::Deserialize)]
pub struct NamesBatch {
    /// The `names` field.
    pub names: Vec<Names>,
    /// The `picks` field.
    pub picks: Vec<Pick>,
}

impl tdbin::Struct for Inner {
    const DATA_WORDS: u16 = 1;
    const PTR_WORDS: u16 = 1;
    const LAYOUT_HASH: u64 = 0x9fed_05a1_1076_a099;

    fn write_struct(&self, w: &mut tdbin::Writer, at: usize) -> Result<(), tdbin::EncodeError> {
        w.scalar(at, 0, tdbin::scalar::i64_bits(self.at))?;
        w.string(at, Self::DATA_WORDS, 0, Some(&self.r))?;
        Ok(())
    }

    fn read_struct(r: &tdbin::Reader<'_>, at: usize) -> Result<Self, tdbin::DecodeError> {
        let f0 = tdbin::scalar::i64_from(r.scalar(at, 0)?);
        let f1 = r.string(at, Self::DATA_WORDS, 0)?.unwrap_or_default();
        Ok(Self { at: f0, r: f1 })
    }
}

impl tdbin::ColumnGroup for Inner {
    const COLUMNS: u16 = 3;

    fn write_group<'v, I>(
        items: I,
        count: usize,
        w: &mut tdbin::Writer,
        at: usize,
    ) -> Result<(), tdbin::EncodeError>
    where
        I: Iterator<Item = &'v Self> + Clone,
        Self: 'v,
    {
        w.i64_block_column(at, 1, 0, count, items.clone().map(|row| row.at))?;
        w.var_column(
            at,
            1,
            1,
            2,
            count,
            items.clone().map(|row| row.r.as_bytes()),
        )?;
        Ok(())
    }

    fn read_group(
        r: &tdbin::Reader<'_>,
        at: usize,
        count: usize,
    ) -> Result<Vec<Self>, tdbin::DecodeError> {
        let f0 = r.i64_block_column(at, 0, count)?;
        let mut f1 = r.var_column(at, 1, 2, count)?.into_strings()?.into_iter();
        let mut rows = Vec::with_capacity(count);
        for i in 0..count {
            rows.push(Self {
                at: f0.get(i).copied().unwrap_or_default(),
                r: f1.next().ok_or(tdbin::DecodeError::MalformedColumn)?,
            });
        }
        Ok(rows)
    }
}

impl Default for Pick {
    fn default() -> Self {
        Self::W(Inner::default())
    }
}

impl tdbin::Struct for Pick {
    const DATA_WORDS: u16 = 1;
    const PTR_WORDS: u16 = 1;
    const LAYOUT_HASH: u64 = 0x34ca_378b_c921_8786;

    fn write_struct(&self, w: &mut tdbin::Writer, at: usize) -> Result<(), tdbin::EncodeError> {
        match self {
            Self::W(payload) => {
                w.scalar(at, 0, 0)?;
                w.child(at, Self::DATA_WORDS, 0, Some(payload))
            }
            Self::Items(payload) => {
                w.scalar(at, 0, 1)?;
                w.child(at, Self::DATA_WORDS, 0, Some(payload))
            }
            Self::Tags => {
                w.scalar(at, 0, 2)?;
                Ok(())
            }
            Self::Count(payload) => {
                w.scalar(at, 0, 3)?;
                w.child(at, Self::DATA_WORDS, 0, Some(payload))
            }
        }
    }

    fn read_struct(r: &tdbin::Reader<'_>, at: usize) -> Result<Self, tdbin::DecodeError> {
        match r.scalar(at, 0)? {
            0 => Ok(Self::W(
                r.child::<Inner>(at, Self::DATA_WORDS, 0)?
                    .unwrap_or_default(),
            )),
            1 => Ok(Self::Items(
                r.child::<Inner>(at, Self::DATA_WORDS, 0)?
                    .unwrap_or_default(),
            )),
            2 => {
                r.require_null_pointer(at, 0)?;
                Ok(Self::Tags)
            }
            3 => Ok(Self::Count(
                r.child::<Inner>(at, Self::DATA_WORDS, 0)?
                    .unwrap_or_default(),
            )),
            ordinal => {
                r.verify_struct_slots(at)?;
                Err(tdbin::DecodeError::UnknownVariant { ordinal })
            }
        }
    }
}

impl tdbin::ColumnGroup for Pick {
    const COLUMNS: u16 = 4;

    fn write_group<'v, I>(
        items: I,
        count: usize,
        w: &mut tdbin::Writer,
        at: usize,
    ) -> Result<(), tdbin::EncodeError>
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
                Self::W(_) => 0_u8,
                Self::Items(_) => 1_u8,
                Self::Tags => 2_u8,
                Self::Count(_) => 3_u8,
            }),
        )?;
        let v0: Vec<&Inner> = items
            .clone()
            .filter_map(|row| match row {
                Self::W(payload) => Some(payload),
                Self::Items(_) | Self::Tags | Self::Count(_) => None,
            })
            .collect();
        w.dense_group(at, 1, 1, v0.len(), v0.iter().copied())?;
        let v1: Vec<&Inner> = items
            .clone()
            .filter_map(|row| match row {
                Self::Items(payload) => Some(payload),
                Self::W(_) | Self::Tags | Self::Count(_) => None,
            })
            .collect();
        w.dense_group(at, 1, 2, v1.len(), v1.iter().copied())?;
        let v3: Vec<&Inner> = items
            .clone()
            .filter_map(|row| match row {
                Self::Count(payload) => Some(payload),
                Self::W(_) | Self::Items(_) | Self::Tags => None,
            })
            .collect();
        w.dense_group(at, 1, 3, v3.len(), v3.iter().copied())?;
        Ok(())
    }

    fn read_group(
        r: &tdbin::Reader<'_>,
        at: usize,
        count: usize,
    ) -> Result<Vec<Self>, tdbin::DecodeError> {
        let tags = r.byte_column(at, 0, count)?;
        let v0_count = tags.iter().map(|tag| usize::from(*tag == 0)).sum::<usize>();
        let mut v0 = r.dense_group::<Inner>(at, 1, v0_count)?.into_iter();
        let v1_count = tags.iter().map(|tag| usize::from(*tag == 1)).sum::<usize>();
        let mut v1 = r.dense_group::<Inner>(at, 2, v1_count)?.into_iter();
        let v3_count = tags.iter().map(|tag| usize::from(*tag == 3)).sum::<usize>();
        let mut v3 = r.dense_group::<Inner>(at, 3, v3_count)?.into_iter();
        let mut rows = Vec::with_capacity(count);
        for tag in tags {
            rows.push(match tag {
                0 => Self::W(v0.next().ok_or(tdbin::DecodeError::MalformedColumn)?),
                1 => Self::Items(v1.next().ok_or(tdbin::DecodeError::MalformedColumn)?),
                2 => Self::Tags,
                3 => Self::Count(v3.next().ok_or(tdbin::DecodeError::MalformedColumn)?),
                ordinal => {
                    return Err(tdbin::DecodeError::UnknownVariant {
                        ordinal: u64::from(ordinal),
                    });
                }
            });
        }
        Ok(rows)
    }
}

impl tdbin::Struct for Names {
    const DATA_WORDS: u16 = 10;
    const PTR_WORDS: u16 = 6;
    const LAYOUT_HASH: u64 = 0xab27_d651_ddfe_54a4;

    fn write_struct(&self, w: &mut tdbin::Writer, at: usize) -> Result<(), tdbin::EncodeError> {
        w.string(at, Self::DATA_WORDS, 0, Some(&self.value))?;
        w.scalar(at, 0, tdbin::scalar::i64_bits(self.writer))?;
        w.scalar(at, 1, tdbin::scalar::i64_bits(self.reader))?;
        w.scalar(at, 2, tdbin::scalar::i64_bits(self.tdbin))?;
        w.bool_bit(at, 3, 0, self.ok)?;
        w.scalar(at, 4, tdbin::scalar::i64_bits(self.w))?;
        w.scalar(at, 5, tdbin::scalar::i64_bits(self.at))?;
        w.scalar(at, 6, tdbin::scalar::i64_bits(self.r))?;
        w.scalar(at, 7, tdbin::scalar::i64_bits(self.count))?;
        w.bool_bit(at, 3, 1, self.i)?;
        w.child(at, Self::DATA_WORDS, 1, self.items.as_ref())?;
        w.column_list(at, Self::DATA_WORDS, 2, Some(&self.rows))?;
        w.string_var_list(at, Self::DATA_WORDS, 3, 4, Some(&self.tags))?;
        w.bool_bit(at, 3, 2, self.x.is_some())?;
        w.scalar(at, 8, self.x.map_or(0, tdbin::scalar::i64_bits))?;
        w.bool_bit(at, 3, 3, self.x_present.is_some())?;
        w.scalar(at, 9, self.x_present.map_or(0, tdbin::scalar::i64_bits))?;
        w.child(at, Self::DATA_WORDS, 5, Some(&self.pick))?;
        Ok(())
    }

    fn read_struct(r: &tdbin::Reader<'_>, at: usize) -> Result<Self, tdbin::DecodeError> {
        let f0 = r.string(at, Self::DATA_WORDS, 0)?.unwrap_or_default();
        let f1 = tdbin::scalar::i64_from(r.scalar(at, 0)?);
        let f2 = tdbin::scalar::i64_from(r.scalar(at, 1)?);
        let f3 = tdbin::scalar::i64_from(r.scalar(at, 2)?);
        let f4 = r.bool_bit(at, 3, 0)?;
        let f5 = tdbin::scalar::i64_from(r.scalar(at, 4)?);
        let f6 = tdbin::scalar::i64_from(r.scalar(at, 5)?);
        let f7 = tdbin::scalar::i64_from(r.scalar(at, 6)?);
        let f8 = tdbin::scalar::i64_from(r.scalar(at, 7)?);
        let f9 = r.bool_bit(at, 3, 1)?;
        let f10 = r.child::<Inner>(at, Self::DATA_WORDS, 1)?;
        let f11 = r
            .column_list::<Inner>(at, Self::DATA_WORDS, 2)?
            .unwrap_or_default();
        let f12 = match r.var_list(at, Self::DATA_WORDS, 3, 4)? {
            Some(column) => column.into_strings()?,
            None => Vec::new(),
        };
        let f13_present = r.bool_bit(at, 3, 2)?;
        let f13_value = tdbin::scalar::i64_from(r.scalar(at, 8)?);
        let f13 = f13_present.then_some(f13_value);
        let f14_present = r.bool_bit(at, 3, 3)?;
        let f14_value = tdbin::scalar::i64_from(r.scalar(at, 9)?);
        let f14 = f14_present.then_some(f14_value);
        let f15 = r
            .child::<Pick>(at, Self::DATA_WORDS, 5)?
            .unwrap_or_default();
        Ok(Self {
            value: f0,
            writer: f1,
            reader: f2,
            tdbin: f3,
            ok: f4,
            w: f5,
            at: f6,
            r: f7,
            count: f8,
            i: f9,
            items: f10,
            rows: f11,
            tags: f12,
            x: f13,
            x_present: f14,
            pick: f15,
        })
    }
}

impl tdbin::ColumnGroup for Names {
    const COLUMNS: u16 = 23;

    fn write_group<'v, I>(
        items: I,
        count: usize,
        w: &mut tdbin::Writer,
        at: usize,
    ) -> Result<(), tdbin::EncodeError>
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
            items.clone().map(|row| row.value.as_bytes()),
        )?;
        w.i64_block_column(at, 1, 2, count, items.clone().map(|row| row.writer))?;
        w.i64_block_column(at, 1, 3, count, items.clone().map(|row| row.reader))?;
        w.i64_block_column(at, 1, 4, count, items.clone().map(|row| row.tdbin))?;
        w.bit_column(at, 1, 5, count, items.clone().map(|row| row.ok))?;
        w.i64_block_column(at, 1, 6, count, items.clone().map(|row| row.w))?;
        w.i64_block_column(at, 1, 7, count, items.clone().map(|row| row.at))?;
        w.i64_block_column(at, 1, 8, count, items.clone().map(|row| row.r))?;
        w.i64_block_column(at, 1, 9, count, items.clone().map(|row| row.count))?;
        w.bit_column(at, 1, 10, count, items.clone().map(|row| row.i))?;
        w.bit_column(
            at,
            1,
            11,
            count,
            items.clone().map(|row| row.items.is_some()),
        )?;
        let items_some: Vec<&Inner> = items.clone().filter_map(|row| row.items.as_ref()).collect();
        w.dense_group(at, 1, 12, items_some.len(), items_some.iter().copied())?;
        let rows_counts = items
            .clone()
            .map(|row| u32::try_from(row.rows.len()))
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| tdbin::EncodeError::LimitExceeded)?;
        w.len_column(at, 1, 13, &rows_counts)?;
        let rows_total = items
            .clone()
            .map(|row| row.rows.len())
            .try_fold(0_usize, usize::checked_add)
            .ok_or(tdbin::EncodeError::LimitExceeded)?;
        w.dense_group(
            at,
            1,
            14,
            rows_total,
            items.clone().flat_map(|row| row.rows.iter()),
        )?;
        let tags_counts = items
            .clone()
            .map(|row| u32::try_from(row.tags.len()))
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| tdbin::EncodeError::LimitExceeded)?;
        w.len_column(at, 1, 15, &tags_counts)?;
        let tags_total = items
            .clone()
            .map(|row| row.tags.len())
            .try_fold(0_usize, usize::checked_add)
            .ok_or(tdbin::EncodeError::LimitExceeded)?;
        w.var_column(
            at,
            1,
            16,
            17,
            tags_total,
            items
                .clone()
                .flat_map(|row| row.tags.iter())
                .map(String::as_bytes),
        )?;
        w.bit_column(at, 1, 18, count, items.clone().map(|row| row.x.is_some()))?;
        w.i64_column(
            at,
            1,
            19,
            count,
            items.clone().map(|row| row.x.unwrap_or_default()),
        )?;
        w.bit_column(
            at,
            1,
            20,
            count,
            items.clone().map(|row| row.x_present.is_some()),
        )?;
        w.i64_column(
            at,
            1,
            21,
            count,
            items.clone().map(|row| row.x_present.unwrap_or_default()),
        )?;
        w.dense_group(at, 1, 22, count, items.clone().map(|row| &row.pick))?;
        Ok(())
    }

    fn read_group(
        r: &tdbin::Reader<'_>,
        at: usize,
        count: usize,
    ) -> Result<Vec<Self>, tdbin::DecodeError> {
        let mut f0 = r.var_column(at, 0, 1, count)?.into_strings()?.into_iter();
        let f1 = r.i64_block_column(at, 2, count)?;
        let f2 = r.i64_block_column(at, 3, count)?;
        let f3 = r.i64_block_column(at, 4, count)?;
        let f4 = r.bit_column(at, 5, count)?;
        let f5 = r.i64_block_column(at, 6, count)?;
        let f6 = r.i64_block_column(at, 7, count)?;
        let f7 = r.i64_block_column(at, 8, count)?;
        let f8 = r.i64_block_column(at, 9, count)?;
        let f9 = r.bit_column(at, 10, count)?;
        let f10_valid = r.bit_column(at, 11, count)?;
        let f10_count = f10_valid.iter().filter(|present| **present).count();
        let mut f10 = r.dense_group::<Inner>(at, 12, f10_count)?.into_iter();
        let f11_counts = r.len_column(at, 13, count)?;
        let f11_total = tdbin::column_total(&f11_counts)?;
        let mut f11 = r.dense_group::<Inner>(at, 14, f11_total)?.into_iter();
        let f12_counts = r.len_column(at, 15, count)?;
        let f12_total = tdbin::column_total(&f12_counts)?;
        let mut f12 = r
            .var_column(at, 16, 17, f12_total)?
            .into_strings()?
            .into_iter();
        let f13_valid = r.bit_column(at, 18, count)?;
        let f13_values = r.i64_column(at, 19, count)?;
        let mut f13 = f13_valid
            .into_iter()
            .zip(f13_values)
            .map(|(valid, value)| valid.then_some(value));
        let f14_valid = r.bit_column(at, 20, count)?;
        let f14_values = r.i64_column(at, 21, count)?;
        let mut f14 = f14_valid
            .into_iter()
            .zip(f14_values)
            .map(|(valid, value)| valid.then_some(value));
        let mut f15 = r.dense_group::<Pick>(at, 22, count)?.into_iter();
        let mut rows = Vec::with_capacity(count);
        for i in 0..count {
            let f11_take = usize::try_from(f11_counts.get(i).copied().unwrap_or(0))
                .map_err(|_| tdbin::DecodeError::LimitExceeded)?;
            let f12_take = usize::try_from(f12_counts.get(i).copied().unwrap_or(0))
                .map_err(|_| tdbin::DecodeError::LimitExceeded)?;
            rows.push(Self {
                value: f0.next().ok_or(tdbin::DecodeError::MalformedColumn)?,
                writer: f1.get(i).copied().unwrap_or_default(),
                reader: f2.get(i).copied().unwrap_or_default(),
                tdbin: f3.get(i).copied().unwrap_or_default(),
                ok: f4.get(i).copied().unwrap_or_default(),
                w: f5.get(i).copied().unwrap_or_default(),
                at: f6.get(i).copied().unwrap_or_default(),
                r: f7.get(i).copied().unwrap_or_default(),
                count: f8.get(i).copied().unwrap_or_default(),
                i: f9.get(i).copied().unwrap_or_default(),
                items: f10_valid
                    .get(i)
                    .copied()
                    .unwrap_or_default()
                    .then(|| f10.next().ok_or(tdbin::DecodeError::MalformedColumn))
                    .transpose()?,
                rows: (0..f11_take)
                    .map(|_| f11.next().ok_or(tdbin::DecodeError::MalformedColumn))
                    .collect::<Result<Vec<_>, _>>()?,
                tags: (0..f12_take)
                    .map(|_| f12.next().ok_or(tdbin::DecodeError::MalformedColumn))
                    .collect::<Result<Vec<_>, _>>()?,
                x: f13.next().ok_or(tdbin::DecodeError::MalformedColumn)?,
                x_present: f14.next().ok_or(tdbin::DecodeError::MalformedColumn)?,
                pick: f15.next().ok_or(tdbin::DecodeError::MalformedColumn)?,
            });
        }
        Ok(rows)
    }
}

impl tdbin::Struct for NamesBatch {
    const DATA_WORDS: u16 = 0;
    const PTR_WORDS: u16 = 2;
    const LAYOUT_HASH: u64 = 0xea6e_8824_8f17_2da7;

    fn write_struct(&self, w: &mut tdbin::Writer, at: usize) -> Result<(), tdbin::EncodeError> {
        w.column_list(at, Self::DATA_WORDS, 0, Some(&self.names))?;
        w.column_list(at, Self::DATA_WORDS, 1, Some(&self.picks))?;
        Ok(())
    }

    fn read_struct(r: &tdbin::Reader<'_>, at: usize) -> Result<Self, tdbin::DecodeError> {
        let f0 = r
            .column_list::<Names>(at, Self::DATA_WORDS, 0)?
            .unwrap_or_default();
        let f1 = r
            .column_list::<Pick>(at, Self::DATA_WORDS, 1)?
            .unwrap_or_default();
        Ok(Self {
            names: f0,
            picks: f1,
        })
    }
}
