//! [TDBIN-EVOLVE-BREAKING] [TDBIN-EVOLVE-WIDTH] [TDBIN-TEST-EVOLVE] Evolution compatibility tests for short/long structs and
//! appended union variants.

use tdbin::{DecodeError, EncodeError, Reader, Struct, TdBin, Writer};

/// Boxed-error alias for fallible tests.
type TestResult = Result<(), Box<dyn std::error::Error>>;

/// Version 1 record: one scalar plus one pointer.
#[derive(Debug, PartialEq, Eq)]
struct RecordV1 {
    /// Stable id field.
    id: i64,
    /// Stable name field.
    name: String,
}

impl Struct for RecordV1 {
    const DATA_WORDS: u16 = 1;
    const PTR_WORDS: u16 = 1;

    fn write_struct(&self, w: &mut Writer, at: usize) -> Result<(), EncodeError> {
        w.scalar(at, 0, tdbin::scalar::i64_bits(self.id))?;
        w.string(at, Self::DATA_WORDS, 0, Some(&self.name))
    }

    fn read_struct(r: &Reader<'_>, at: usize) -> Result<Self, DecodeError> {
        let id = tdbin::scalar::i64_from(r.scalar(at, 0)?);
        let name = r
            .string(at, Self::DATA_WORDS, 0)?
            .ok_or(DecodeError::UnexpectedNull)?;
        Ok(Self { id, name })
    }
}

/// Version 2 record: appends a scalar after the original fields.
#[derive(Debug, PartialEq, Eq)]
struct RecordV2 {
    /// Stable id field.
    id: i64,
    /// Stable name field.
    name: String,
    /// Appended scalar field.
    age: i64,
}

impl Struct for RecordV2 {
    const DATA_WORDS: u16 = 2;
    const PTR_WORDS: u16 = 1;

    fn write_struct(&self, w: &mut Writer, at: usize) -> Result<(), EncodeError> {
        w.scalar(at, 0, tdbin::scalar::i64_bits(self.id))?;
        w.string(at, Self::DATA_WORDS, 0, Some(&self.name))?;
        w.scalar(at, 1, tdbin::scalar::i64_bits(self.age))
    }

    fn read_struct(r: &Reader<'_>, at: usize) -> Result<Self, DecodeError> {
        let id = tdbin::scalar::i64_from(r.scalar(at, 0)?);
        let name = r
            .string(at, Self::DATA_WORDS, 0)?
            .ok_or(DecodeError::UnexpectedNull)?;
        let age = tdbin::scalar::i64_from(r.scalar(at, 1)?);
        Ok(Self { id, name, age })
    }
}

/// Version 1 union with a single payload variant.
#[derive(Debug, PartialEq, Eq)]
enum EventV1 {
    /// Original string payload variant.
    Created(String),
}

impl Struct for EventV1 {
    const DATA_WORDS: u16 = 1;
    const PTR_WORDS: u16 = 1;

    fn write_struct(&self, w: &mut Writer, at: usize) -> Result<(), EncodeError> {
        match self {
            Self::Created(text) => {
                w.scalar(at, 0, 0)?;
                w.string(at, Self::DATA_WORDS, 0, Some(text))
            }
        }
    }

    fn read_struct(r: &Reader<'_>, at: usize) -> Result<Self, DecodeError> {
        match r.scalar(at, 0)? {
            0 => Ok(Self::Created(
                r.string(at, Self::DATA_WORDS, 0)?
                    .ok_or(DecodeError::UnexpectedNull)?,
            )),
            ordinal => Err(DecodeError::UnknownVariant { ordinal }),
        }
    }
}

/// Version 2 union appending a bare variant.
#[derive(Debug, PartialEq, Eq)]
enum EventV2 {
    /// Original string payload variant.
    Created(String),
    /// Appended bare variant.
    Deleted,
}

impl Struct for EventV2 {
    const DATA_WORDS: u16 = 1;
    const PTR_WORDS: u16 = 1;

    fn write_struct(&self, w: &mut Writer, at: usize) -> Result<(), EncodeError> {
        match self {
            Self::Created(text) => {
                w.scalar(at, 0, 0)?;
                w.string(at, Self::DATA_WORDS, 0, Some(text))
            }
            Self::Deleted => {
                w.scalar(at, 0, 1)?;
                Ok(())
            }
        }
    }

    fn read_struct(r: &Reader<'_>, at: usize) -> Result<Self, DecodeError> {
        match r.scalar(at, 0)? {
            0 => Ok(Self::Created(
                r.string(at, Self::DATA_WORDS, 0)?
                    .ok_or(DecodeError::UnexpectedNull)?,
            )),
            1 => Ok(Self::Deleted),
            ordinal => Err(DecodeError::UnknownVariant { ordinal }),
        }
    }
}

/// Writer with a discriminant outside the narrow reader's known range.
#[derive(Debug, PartialEq, Eq)]
struct WideOrdinal;

impl Struct for WideOrdinal {
    const DATA_WORDS: u16 = 1;
    const PTR_WORDS: u16 = 0;

    fn write_struct(&self, w: &mut Writer, at: usize) -> Result<(), EncodeError> {
        w.scalar(at, 0, 256)
    }

    fn read_struct(_r: &Reader<'_>, _at: usize) -> Result<Self, DecodeError> {
        Ok(Self)
    }
}

/// Reader for the pre-width-crossing enum schema.
#[derive(Debug, PartialEq, Eq)]
enum TinyEnum {
    /// First known variant.
    A,
    /// Second known variant.
    B,
}

impl Struct for TinyEnum {
    const DATA_WORDS: u16 = 1;
    const PTR_WORDS: u16 = 0;

    fn write_struct(&self, w: &mut Writer, at: usize) -> Result<(), EncodeError> {
        match self {
            Self::A => w.scalar(at, 0, 0),
            Self::B => w.scalar(at, 0, 1),
        }
    }

    fn read_struct(r: &Reader<'_>, at: usize) -> Result<Self, DecodeError> {
        match r.scalar(at, 0)? {
            0 => Ok(Self::A),
            1 => Ok(Self::B),
            ordinal => Err(DecodeError::UnknownVariant { ordinal }),
        }
    }
}

/// [TDBIN-REC-SHORT] A newer reader gets default zeros for appended scalar
/// fields when reading an older, shorter struct.
#[test]
fn appended_scalar_defaults_when_reader_schema_is_longer() -> TestResult {
    let old = RecordV1 {
        id: 7,
        name: "Ada".to_owned(),
    };
    let decoded = RecordV2::from_bytes(&old.to_bytes()?)?;
    assert_eq!(
        decoded,
        RecordV2 {
            id: 7,
            name: "Ada".to_owned(),
            age: 0,
        }
    );
    Ok(())
}

/// [TDBIN-REC-SHORT] An older reader ignores appended scalar fields while still
/// finding pointer slots after the writer's longer data section.
#[test]
fn appended_scalar_is_ignored_when_reader_schema_is_shorter() -> TestResult {
    let new = RecordV2 {
        id: 8,
        name: "Grace".to_owned(),
        age: 42,
    };
    let decoded = RecordV1::from_bytes(&new.to_bytes()?)?;
    assert_eq!(
        decoded,
        RecordV1 {
            id: 8,
            name: "Grace".to_owned(),
        }
    );
    Ok(())
}

/// [TDBIN-EVOLVE-APPEND] Existing appended union variants remain readable by the
/// newer schema.
#[test]
fn appended_variant_schema_reads_original_variant() -> TestResult {
    let old = EventV1::Created("node".to_owned());
    assert_eq!(
        EventV2::from_bytes(&old.to_bytes()?)?,
        EventV2::Created("node".to_owned())
    );
    Ok(())
}

/// [TDBIN-UNION-UNKNOWN] Older schemas reject newer appended variants as typed
/// unknown ordinals.
#[test]
fn older_variant_schema_reports_new_variant_ordinal() -> TestResult {
    match EventV1::from_bytes(&EventV2::Deleted.to_bytes()?) {
        Err(DecodeError::UnknownVariant { ordinal: 1 }) => Ok(()),
        other => Err(format!("expected UnknownVariant ordinal 1, got {other:?}").into()),
    }
}

/// [TDBIN-EVOLVE-WIDTH] Width-crossing enum growth is surfaced as a typed
/// unknown ordinal for the old reader.
#[test]
fn width_crossing_ordinal_is_a_typed_breaking_error() -> TestResult {
    match TinyEnum::from_bytes(&WideOrdinal.to_bytes()?) {
        Err(DecodeError::UnknownVariant { ordinal: 256 }) => Ok(()),
        other => Err(format!("expected UnknownVariant ordinal 256, got {other:?}").into()),
    }
}
