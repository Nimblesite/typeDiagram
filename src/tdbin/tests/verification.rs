//! [TDBIN-SAFE-BOUNDS] and [TDBIN-SAFE-AMPLIFY] whole-message verification.

use tdbin::{DecodeError, EncodeError, Reader, Struct, TdBin, Writer};

type TestResult = Result<(), Box<dyn std::error::Error>>;

#[derive(Debug, PartialEq, Eq)]
struct Empty;

impl Struct for Empty {
    const DATA_WORDS: u16 = 0;
    const PTR_WORDS: u16 = 0;

    fn write_struct(&self, _writer: &mut Writer, _at: usize) -> Result<(), EncodeError> {
        Ok(())
    }

    fn read_struct(_reader: &Reader<'_>, _at: usize) -> Result<Self, DecodeError> {
        Ok(Self)
    }
}

fn words(values: &[u64]) -> Vec<u8> {
    values
        .iter()
        .flat_map(|value| value.to_le_bytes())
        .collect()
}

/// Every declared pointer slot is structurally checked before typed decoding.
#[test]
fn unvisited_reserved_pointer_is_rejected() {
    let root = 1_u64 << 48;
    let wire = words(&[root, 2]);
    assert_eq!(
        Empty::from_bytes(&wire),
        Err(DecodeError::ReservedPointerKind)
    );
}

/// [TDBIN-PTR-STRUCT] A zero-sized root uses offset -1 instead of the null word.
#[test]
fn zero_sized_root_has_a_non_null_marker() -> TestResult {
    let wire = Empty.to_bytes()?;
    assert_ne!(
        wire,
        vec![0_u8; 8],
        "zero-size root must not encode as null"
    );
    assert_eq!(Empty::from_bytes(&wire)?, Empty);
    Ok(())
}

/// Aliasing a child body twice exceeds the physical body-word traversal budget.
#[test]
fn aliased_struct_targets_exceed_amplification_budget() {
    let root = 2_u64 << 48;
    let first_child = (1_u64 << 32) | (1_u64 << 2);
    let second_child = 1_u64 << 32;
    let wire = words(&[root, first_child, second_child, 7]);
    assert_eq!(
        Empty::from_bytes(&wire),
        Err(DecodeError::AmplificationExceeded)
    );
}
