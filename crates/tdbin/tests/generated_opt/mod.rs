//! [TDBIN-PRIM-OPTION] GENERATED `Option<scalar>` fixture (presence + value
//! slots), emitted by `packages/typediagram/src/converters/rust-tdbin.ts`
//! (`generateRustModule`). Included only by `roundtrip.rs`; kept separate from
//! the shared Person fixture so the framing/golden test binaries do not carry an
//! unused type (`-D dead-code`). Regenerate rather than hand-editing.

// <<<GENERATED — rust-tdbin.ts generateRustModule; do not edit by hand>>>
/// The `Measurement` record.
#[derive(Debug, Clone, PartialEq)]
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
    const DATA_WORDS: u16 = 6;
    const PTR_WORDS: u16 = 1;

    fn write_struct(&self, w: &mut tdbin::Writer, at: usize) -> Result<(), tdbin::EncodeError> {
        w.string(at, Self::DATA_WORDS, 0, Some(&self.label))?;
        w.scalar(at, 0, u64::from(self.count.is_some()))?;
        w.scalar(at, 1, self.count.map_or(0, tdbin::scalar::i64_bits))?;
        w.scalar(at, 2, u64::from(self.flagged.is_some()))?;
        w.scalar(at, 3, self.flagged.map_or(0, tdbin::scalar::bool_bits))?;
        w.scalar(at, 4, u64::from(self.ratio.is_some()))?;
        w.scalar(at, 5, self.ratio.map_or(0, tdbin::scalar::f64_bits))?;
        Ok(())
    }

    fn read_struct(r: &tdbin::Reader<'_>, at: usize) -> Result<Self, tdbin::DecodeError> {
        let label = r
            .string(at, Self::DATA_WORDS, 0)?
            .ok_or(tdbin::DecodeError::UnexpectedNull)?;
        let count_present = r.scalar(at, 0)? != 0;
        let count_value = tdbin::scalar::i64_from(r.scalar(at, 1)?);
        let count = count_present.then_some(count_value);
        let flagged_present = r.scalar(at, 2)? != 0;
        let flagged_value = tdbin::scalar::bool_from(r.scalar(at, 3)?);
        let flagged = flagged_present.then_some(flagged_value);
        let ratio_present = r.scalar(at, 4)? != 0;
        let ratio_value = tdbin::scalar::f64_from(r.scalar(at, 5)?);
        let ratio = ratio_present.then_some(ratio_value);
        Ok(Self {
            label,
            count,
            flagged,
            ratio,
        })
    }
}
