//! [TDBIN-PRIM-OPTION] GENERATED `Option<scalar>` fixture (1-bit presence
//! flags in the shared bool bitset + natural-width value slots), emitted by
//! `packages/typediagram/src/converters/rust-tdbin.ts` (`generateRustModule`)
//! from `packages/typediagram/test/converters/fixtures/measurement.td`.
//! Included only by `roundtrip.rs`; kept separate from the shared Person
//! fixture so the framing/golden test binaries do not carry an unused type
//! (`-D dead-code`). Regenerate with `node scripts/tdbin-regen-fixtures.mjs`
//! rather than hand-editing.

// <<<GENERATED — rust-tdbin.ts generateRustModule; do not edit by hand>>>
/// The `Measurement` record.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Measurement {
    /// The `label` field.
    pub label: String,
    /// The `count` field.
    pub count: Option<i64>,
    /// The `flagged` field.
    pub flagged: Option<bool>,
    /// The `ratio` field.
    pub ratio: Option<f64>,
}

impl tdbin::Struct for Measurement {
    const DATA_WORDS: u16 = 3;
    const PTR_WORDS: u16 = 1;
    const LAYOUT_HASH: u64 = 0x838e_d60c_b04f_c0b0;

    fn write_struct(&self, w: &mut tdbin::Writer, at: usize) -> Result<(), tdbin::EncodeError> {
        w.string(at, Self::DATA_WORDS, 0, Some(&self.label))?;
        w.bool_bit(at, 0, 0, self.count.is_some())?;
        w.scalar(at, 1, self.count.map_or(0, tdbin::scalar::i64_bits))?;
        w.bool_bit(at, 0, 1, self.flagged.is_some())?;
        w.bool_bit(at, 0, 2, self.flagged.unwrap_or_default())?;
        w.bool_bit(at, 0, 3, self.ratio.is_some())?;
        w.scalar(at, 2, self.ratio.map_or(0, tdbin::scalar::f64_bits))?;
        Ok(())
    }

    fn read_struct(r: &tdbin::Reader<'_>, at: usize) -> Result<Self, tdbin::DecodeError> {
        let label = r.string(at, Self::DATA_WORDS, 0)?.unwrap_or_default();
        let count_present = r.bool_bit(at, 0, 0)?;
        let count_value = tdbin::scalar::i64_from(r.scalar(at, 1)?);
        let count = count_present.then_some(count_value);
        let flagged_present = r.bool_bit(at, 0, 1)?;
        let flagged_value = r.bool_bit(at, 0, 2)?;
        let flagged = flagged_present.then_some(flagged_value);
        let ratio_present = r.bool_bit(at, 0, 3)?;
        let ratio_value = tdbin::scalar::f64_from(r.scalar(at, 2)?);
        let ratio = ratio_present.then_some(ratio_value);
        Ok(Self {
            label,
            count,
            flagged,
            ratio,
        })
    }
}
