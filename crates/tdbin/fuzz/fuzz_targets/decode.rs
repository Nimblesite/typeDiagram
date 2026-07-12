#![no_main]

//! [TDBIN-TEST-FUZZ] libFuzzer target for total decode over arbitrary bytes.

use libfuzzer_sys::fuzz_target;
use tdbin::{DecodeError, EncodeError, Reader, Struct, TdBin, Writer};

/// Fixed fuzz schema with scalar, pointer, and nested-child coverage.
#[derive(Debug, PartialEq, Eq)]
struct FuzzRecord {
    /// Packed Bool field.
    enabled: bool,
    /// Scalar field.
    count: i64,
    /// Optional string pointer.
    label: Option<String>,
    /// Optional nested child pointer.
    child: Option<FuzzChild>,
}

/// Nested child schema used by [`FuzzRecord`].
#[derive(Debug, PartialEq, Eq)]
struct FuzzChild {
    /// Child scalar field.
    code: i64,
}

impl Struct for FuzzRecord {
    const DATA_WORDS: u16 = 2;
    const PTR_WORDS: u16 = 2;

    fn write_struct(&self, w: &mut Writer, at: usize) -> Result<(), EncodeError> {
        w.bool_bit(at, 0, 0, self.enabled)?;
        w.scalar(at, 1, tdbin::scalar::i64_bits(self.count))?;
        w.string(at, Self::DATA_WORDS, 0, self.label.as_deref())?;
        w.child(at, Self::DATA_WORDS, 1, self.child.as_ref())
    }

    fn read_struct(r: &Reader<'_>, at: usize) -> Result<Self, DecodeError> {
        let enabled = r.bool_bit(at, 0, 0)?;
        let count = tdbin::scalar::i64_from(r.scalar(at, 1)?);
        let label = r.string(at, Self::DATA_WORDS, 0)?;
        let child = r.child::<FuzzChild>(at, Self::DATA_WORDS, 1)?;
        Ok(Self {
            enabled,
            count,
            label,
            child,
        })
    }
}

impl Struct for FuzzChild {
    const DATA_WORDS: u16 = 1;
    const PTR_WORDS: u16 = 0;

    fn write_struct(&self, w: &mut Writer, at: usize) -> Result<(), EncodeError> {
        w.scalar(at, 0, tdbin::scalar::i64_bits(self.code))
    }

    fn read_struct(r: &Reader<'_>, at: usize) -> Result<Self, DecodeError> {
        Ok(Self {
            code: tdbin::scalar::i64_from(r.scalar(at, 0)?),
        })
    }
}

fuzz_target!(|data: &[u8]| {
    let _ = FuzzRecord::from_bytes(data);
    let _ = FuzzRecord::from_framed_bytes(data);
    let _ = tdbin::pack::decode(data);
});
