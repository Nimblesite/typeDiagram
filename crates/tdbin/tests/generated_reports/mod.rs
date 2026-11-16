//! [TDBIN-TS-LIST] GENERATED list-form fixture, emitted by
//! `packages/typediagram/src/converters/rust-tdbin.ts` (`generateRustModule`)
//! from `packages/typediagram/test/converters/fixtures/reports.td`. Included
//! only by `cross_lang.rs`, which pins the Rust bytes the TypeScript codec
//! must reproduce. Regenerate with `node scripts/tdbin-regen-fixtures.mjs`.

// <<<GENERATED — rust-tdbin.ts generateRustModule; do not edit by hand>>>
/// The `Level` union.
#[derive(Debug, Clone, PartialEq, Default, serde::Serialize, serde::Deserialize)]
pub enum Level {
    /// The `Low` variant.
    #[default]
    Low,
    /// The `High` variant.
    High,
}

/// The `Tag` record.
#[derive(Debug, Clone, PartialEq, Default, serde::Serialize, serde::Deserialize)]
pub struct Tag {
    /// The `key` field.
    pub key: String,
    /// The `weight` field.
    pub weight: f64,
}

/// The `Report` record.
#[derive(Debug, Clone, PartialEq, Default, serde::Serialize, serde::Deserialize)]
pub struct Report {
    /// The `flags` field.
    pub flags: Vec<bool>,
    /// The `counts` field.
    pub counts: Vec<i64>,
    /// The `ratios` field.
    pub ratios: Vec<f64>,
    /// The `names` field.
    pub names: Vec<String>,
    /// The `blobs` field.
    pub blobs: Vec<Vec<u8>>,
    /// The `tags` field.
    pub tags: Vec<Tag>,
    /// The `levels` field.
    pub levels: Vec<Level>,
    /// The `maybeCounts` field.
    #[serde(rename = "maybeCounts")]
    pub maybe_counts: Option<Vec<i64>>,
    /// The `maybeTags` field.
    #[serde(rename = "maybeTags")]
    pub maybe_tags: Option<Vec<Tag>>,
    /// The `maybeLevels` field.
    #[serde(rename = "maybeLevels")]
    pub maybe_levels: Option<Vec<Level>>,
    /// The `title` field.
    pub title: String,
}

impl tdbin::Struct for Level {
    const DATA_WORDS: u16 = 1;
    const PTR_WORDS: u16 = 0;
    const LAYOUT_HASH: u64 = 0x582c_4ff8_0720_682e;

    fn write_struct(&self, w: &mut tdbin::Writer, at: usize) -> Result<(), tdbin::EncodeError> {
        match self {
            Self::Low => {
                w.scalar(at, 0, 0)?;
                Ok(())
            }
            Self::High => {
                w.scalar(at, 0, 1)?;
                Ok(())
            }
        }
    }

    fn read_struct(r: &tdbin::Reader<'_>, at: usize) -> Result<Self, tdbin::DecodeError> {
        match r.scalar(at, 0)? {
            0 => {
                r.require_null_pointer(at, 0)?;
                Ok(Self::Low)
            }
            1 => {
                r.require_null_pointer(at, 0)?;
                Ok(Self::High)
            }
            ordinal => {
                r.verify_struct_slots(at)?;
                Err(tdbin::DecodeError::UnknownVariant { ordinal })
            }
        }
    }
}

impl tdbin::Struct for Tag {
    const DATA_WORDS: u16 = 1;
    const PTR_WORDS: u16 = 1;
    const LAYOUT_HASH: u64 = 0x2916_dedf_9e69_bc95;

    fn write_struct(&self, w: &mut tdbin::Writer, at: usize) -> Result<(), tdbin::EncodeError> {
        w.string(at, Self::DATA_WORDS, 0, Some(&self.key))?;
        w.scalar(at, 0, tdbin::scalar::f64_bits(self.weight))?;
        Ok(())
    }

    fn read_struct(r: &tdbin::Reader<'_>, at: usize) -> Result<Self, tdbin::DecodeError> {
        let key = r.string(at, Self::DATA_WORDS, 0)?.unwrap_or_default();
        let weight = tdbin::scalar::f64_from(r.scalar(at, 0)?);
        Ok(Self { key, weight })
    }
}

impl tdbin::Struct for Report {
    const DATA_WORDS: u16 = 0;
    const PTR_WORDS: u16 = 11;
    const LAYOUT_HASH: u64 = 0xd392_610f_b8ba_9cb7;

    fn write_struct(&self, w: &mut tdbin::Writer, at: usize) -> Result<(), tdbin::EncodeError> {
        w.bool_list(at, Self::DATA_WORDS, 0, Some(&self.flags))?;
        w.i64_list(at, Self::DATA_WORDS, 1, Some(&self.counts))?;
        w.f64_list(at, Self::DATA_WORDS, 2, Some(&self.ratios))?;
        w.string_list(at, Self::DATA_WORDS, 3, Some(&self.names))?;
        w.bytes_list(at, Self::DATA_WORDS, 4, Some(&self.blobs))?;
        w.child_list(at, Self::DATA_WORDS, 5, Some(&self.tags))?;
        let levels_ordinals = self
            .levels
            .iter()
            .map(|value| match value {
                Level::Low => 0u8,
                Level::High => 1u8,
            })
            .collect::<Vec<_>>();
        w.byte_list(at, Self::DATA_WORDS, 6, Some(&levels_ordinals))?;
        w.i64_list(at, Self::DATA_WORDS, 7, self.maybe_counts.as_deref())?;
        w.child_list(at, Self::DATA_WORDS, 8, self.maybe_tags.as_deref())?;
        let maybe_levels_ordinals = self.maybe_levels.as_ref().map(|values| {
            values
                .iter()
                .map(|value| match value {
                    Level::Low => 0u8,
                    Level::High => 1u8,
                })
                .collect::<Vec<_>>()
        });
        w.byte_list(at, Self::DATA_WORDS, 9, maybe_levels_ordinals.as_deref())?;
        w.string(at, Self::DATA_WORDS, 10, Some(&self.title))?;
        Ok(())
    }

    fn read_struct(r: &tdbin::Reader<'_>, at: usize) -> Result<Self, tdbin::DecodeError> {
        let flags = r.bool_list(at, Self::DATA_WORDS, 0)?.unwrap_or_default();
        let counts = r.i64_list(at, Self::DATA_WORDS, 1)?.unwrap_or_default();
        let ratios = r.f64_list(at, Self::DATA_WORDS, 2)?.unwrap_or_default();
        let names = r.string_list(at, Self::DATA_WORDS, 3)?.unwrap_or_default();
        let blobs = r.bytes_list(at, Self::DATA_WORDS, 4)?.unwrap_or_default();
        let tags = r
            .child_list::<Tag>(at, Self::DATA_WORDS, 5)?
            .unwrap_or_default();
        let levels = r
            .byte_list(at, Self::DATA_WORDS, 6)?
            .unwrap_or_default()
            .into_iter()
            .map(|ordinal| match ordinal {
                0 => Ok(Level::Low),
                1 => Ok(Level::High),
                ordinal => Err(tdbin::DecodeError::UnknownVariant {
                    ordinal: u64::from(ordinal),
                }),
            })
            .collect::<Result<Vec<_>, _>>()?;
        let maybe_counts = r.i64_list(at, Self::DATA_WORDS, 7)?;
        let maybe_tags = r.child_list::<Tag>(at, Self::DATA_WORDS, 8)?;
        let maybe_levels = match r.byte_list(at, Self::DATA_WORDS, 9)? {
            Some(values) => Some(
                values
                    .into_iter()
                    .map(|ordinal| match ordinal {
                        0 => Ok(Level::Low),
                        1 => Ok(Level::High),
                        ordinal => Err(tdbin::DecodeError::UnknownVariant {
                            ordinal: u64::from(ordinal),
                        }),
                    })
                    .collect::<Result<Vec<_>, _>>()?,
            ),
            None => None,
        };
        let title = r.string(at, Self::DATA_WORDS, 10)?.unwrap_or_default();
        Ok(Self {
            flags,
            counts,
            ratios,
            names,
            blobs,
            tags,
            levels,
            maybe_counts,
            maybe_tags,
            maybe_levels,
            title,
        })
    }
}
