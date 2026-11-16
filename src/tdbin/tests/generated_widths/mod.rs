//! [TDBIN-WIDTH-RANGE] GENERATED width-refined integer + Path fixture (#85),
//! emitted by `src/typediagram/src/converters/rust-tdbin.ts`
//! (`generateRustModule`) from
//! `src/typediagram/test/converters/fixtures/widths.td`. Included only
//! by `widths.rs`. Regenerate with `node src/scripts/tdbin/tdbin-regen-fixtures.mjs`.

// <<<GENERATED — rust-tdbin.ts generateRustModule; do not edit by hand>>>
/// The `Stats` record.
#[derive(Debug, Clone, PartialEq, Default, serde::Serialize, serde::Deserialize)]
pub struct Stats {
    /// The `delta` field.
    pub delta: i32,
    /// The `flags` field.
    pub flags: u8,
    /// The `port` field.
    pub port: u16,
    /// The `hits` field.
    pub hits: u32,
    /// The `hash` field.
    pub hash: u64,
    /// The `count` field.
    pub count: usize,
    /// The `file` field.
    pub file: std::path::PathBuf,
    /// The `maybeHash` field.
    #[serde(rename = "maybeHash")]
    pub maybe_hash: Option<u64>,
    /// The `maybePort` field.
    #[serde(rename = "maybePort")]
    pub maybe_port: Option<u16>,
    /// The `maybeFile` field.
    #[serde(rename = "maybeFile")]
    pub maybe_file: Option<std::path::PathBuf>,
    /// The `deltas` field.
    pub deltas: Vec<i32>,
    /// The `bytes` field.
    pub bytes: Vec<u8>,
    /// The `ports` field.
    pub ports: Vec<u16>,
    /// The `hitsList` field.
    #[serde(rename = "hitsList")]
    pub hits_list: Vec<u32>,
    /// The `hashes` field.
    pub hashes: Vec<u64>,
    /// The `sizes` field.
    pub sizes: Vec<usize>,
    /// The `files` field.
    pub files: Vec<std::path::PathBuf>,
    /// The `maybeSizes` field.
    #[serde(rename = "maybeSizes")]
    pub maybe_sizes: Option<Vec<usize>>,
    /// The `maybeFiles` field.
    #[serde(rename = "maybeFiles")]
    pub maybe_files: Option<Vec<std::path::PathBuf>>,
}

/// The `StatsRaw` record.
#[derive(Debug, Clone, PartialEq, Default, serde::Serialize, serde::Deserialize)]
pub struct StatsRaw {
    /// The `delta` field.
    pub delta: i64,
    /// The `flags` field.
    pub flags: u64,
    /// The `port` field.
    pub port: u64,
    /// The `hits` field.
    pub hits: u64,
    /// The `hash` field.
    pub hash: u64,
    /// The `count` field.
    pub count: u64,
}

impl tdbin::Struct for Stats {
    const DATA_WORDS: u16 = 9;
    const PTR_WORDS: u16 = 11;
    const LAYOUT_HASH: u64 = 0x6b91_e78c_b16a_568b;

    fn write_struct(&self, w: &mut tdbin::Writer, at: usize) -> Result<(), tdbin::EncodeError> {
        w.scalar(at, 0, tdbin::scalar::i32_bits(self.delta))?;
        w.scalar(at, 1, tdbin::scalar::u8_bits(self.flags))?;
        w.scalar(at, 2, tdbin::scalar::u16_bits(self.port))?;
        w.scalar(at, 3, tdbin::scalar::u32_bits(self.hits))?;
        w.scalar(at, 4, tdbin::scalar::u64_bits(self.hash))?;
        w.scalar(at, 5, tdbin::scalar::usize_bits(self.count))?;
        w.string(
            at,
            Self::DATA_WORDS,
            0,
            Some(tdbin::scalar::path_str(&self.file)?),
        )?;
        w.bool_bit(at, 6, 0, self.maybe_hash.is_some())?;
        w.scalar(at, 7, self.maybe_hash.map_or(0, tdbin::scalar::u64_bits))?;
        w.bool_bit(at, 6, 1, self.maybe_port.is_some())?;
        w.scalar(at, 8, self.maybe_port.map_or(0, tdbin::scalar::u16_bits))?;
        w.string(
            at,
            Self::DATA_WORDS,
            1,
            self.maybe_file
                .as_deref()
                .map(tdbin::scalar::path_str)
                .transpose()?,
        )?;
        w.i32_list(at, Self::DATA_WORDS, 2, Some(&self.deltas))?;
        w.byte_list(at, Self::DATA_WORDS, 3, Some(&self.bytes))?;
        w.u16_list(at, Self::DATA_WORDS, 4, Some(&self.ports))?;
        w.u32_list(at, Self::DATA_WORDS, 5, Some(&self.hits_list))?;
        w.word_list(at, Self::DATA_WORDS, 6, Some(&self.hashes))?;
        w.usize_list(at, Self::DATA_WORDS, 7, Some(&self.sizes))?;
        let files_strings = self
            .files
            .iter()
            .map(|path| tdbin::scalar::path_string(path))
            .collect::<Result<Vec<_>, _>>()?;
        w.string_list(at, Self::DATA_WORDS, 8, Some(&files_strings))?;
        w.usize_list(at, Self::DATA_WORDS, 9, self.maybe_sizes.as_deref())?;
        let maybe_files_strings = self
            .maybe_files
            .as_ref()
            .map(|values| {
                values
                    .iter()
                    .map(|path| tdbin::scalar::path_string(path))
                    .collect::<Result<Vec<_>, _>>()
            })
            .transpose()?;
        w.string_list(at, Self::DATA_WORDS, 10, maybe_files_strings.as_deref())?;
        Ok(())
    }

    fn read_struct(r: &tdbin::Reader<'_>, at: usize) -> Result<Self, tdbin::DecodeError> {
        let f0 = tdbin::scalar::i32_from(r.scalar(at, 0)?)?;
        let f1 = tdbin::scalar::u8_from(r.scalar(at, 1)?)?;
        let f2 = tdbin::scalar::u16_from(r.scalar(at, 2)?)?;
        let f3 = tdbin::scalar::u32_from(r.scalar(at, 3)?)?;
        let f4 = tdbin::scalar::u64_from(r.scalar(at, 4)?);
        let f5 = tdbin::scalar::usize_from(r.scalar(at, 5)?)?;
        let f6 = r
            .string(at, Self::DATA_WORDS, 0)?
            .map_or_else(std::path::PathBuf::new, std::path::PathBuf::from);
        let f7_present = r.bool_bit(at, 6, 0)?;
        let f7_value = tdbin::scalar::u64_from(r.scalar(at, 7)?);
        let f7 = f7_present.then_some(f7_value);
        let f8_present = r.bool_bit(at, 6, 1)?;
        let f8_value = tdbin::scalar::u16_from(r.scalar(at, 8)?)?;
        let f8 = f8_present.then_some(f8_value);
        let f9 = r
            .string(at, Self::DATA_WORDS, 1)?
            .map(std::path::PathBuf::from);
        let f10 = r.i32_list(at, Self::DATA_WORDS, 2)?.unwrap_or_default();
        let f11 = r.byte_list(at, Self::DATA_WORDS, 3)?.unwrap_or_default();
        let f12 = r.u16_list(at, Self::DATA_WORDS, 4)?.unwrap_or_default();
        let f13 = r.u32_list(at, Self::DATA_WORDS, 5)?.unwrap_or_default();
        let f14 = r.word_list(at, Self::DATA_WORDS, 6)?.unwrap_or_default();
        let f15 = r.usize_list(at, Self::DATA_WORDS, 7)?.unwrap_or_default();
        let f16 = r
            .string_list(at, Self::DATA_WORDS, 8)?
            .map_or_else(Vec::new, |values| {
                values.into_iter().map(std::path::PathBuf::from).collect()
            });
        let f17 = r.usize_list(at, Self::DATA_WORDS, 9)?;
        let f18 = r.string_list(at, Self::DATA_WORDS, 10)?.map(|values| {
            values
                .into_iter()
                .map(std::path::PathBuf::from)
                .collect::<Vec<_>>()
        });
        Ok(Self {
            delta: f0,
            flags: f1,
            port: f2,
            hits: f3,
            hash: f4,
            count: f5,
            file: f6,
            maybe_hash: f7,
            maybe_port: f8,
            maybe_file: f9,
            deltas: f10,
            bytes: f11,
            ports: f12,
            hits_list: f13,
            hashes: f14,
            sizes: f15,
            files: f16,
            maybe_sizes: f17,
            maybe_files: f18,
        })
    }
}

impl tdbin::Struct for StatsRaw {
    const DATA_WORDS: u16 = 6;
    const PTR_WORDS: u16 = 0;
    const LAYOUT_HASH: u64 = 0x50f8_105f_77c8_c4ca;

    fn write_struct(&self, w: &mut tdbin::Writer, at: usize) -> Result<(), tdbin::EncodeError> {
        w.scalar(at, 0, tdbin::scalar::i64_bits(self.delta))?;
        w.scalar(at, 1, tdbin::scalar::u64_bits(self.flags))?;
        w.scalar(at, 2, tdbin::scalar::u64_bits(self.port))?;
        w.scalar(at, 3, tdbin::scalar::u64_bits(self.hits))?;
        w.scalar(at, 4, tdbin::scalar::u64_bits(self.hash))?;
        w.scalar(at, 5, tdbin::scalar::u64_bits(self.count))?;
        Ok(())
    }

    fn read_struct(r: &tdbin::Reader<'_>, at: usize) -> Result<Self, tdbin::DecodeError> {
        let f0 = tdbin::scalar::i64_from(r.scalar(at, 0)?);
        let f1 = tdbin::scalar::u64_from(r.scalar(at, 1)?);
        let f2 = tdbin::scalar::u64_from(r.scalar(at, 2)?);
        let f3 = tdbin::scalar::u64_from(r.scalar(at, 3)?);
        let f4 = tdbin::scalar::u64_from(r.scalar(at, 4)?);
        let f5 = tdbin::scalar::u64_from(r.scalar(at, 5)?);
        Ok(Self {
            delta: f0,
            flags: f1,
            port: f2,
            hits: f3,
            hash: f4,
            count: f5,
        })
    }
}
