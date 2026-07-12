//! [TDBIN-PACK] black-box tests for Cap'n Proto word packing.

use tdbin::{frame, pack, DecodeError, Struct, TdBin};

/// The codegen-emitted ADT types and their TDBIN codec, under test.
mod generated;

use generated::{Address, Contact, EmailContact, Person};

/// A boxed error alias so tests can use `?` without `unwrap`.
type TestResult = Result<(), Box<dyn std::error::Error>>;

/// Build a generated `Person` fixture for packed frame tests.
fn packed_person() -> Person {
    Person {
        name: "Packed Person".to_owned(),
        age: 36,
        active: true,
        score: 9.75,
        address: Some(Address {
            street: "1 Packed Way".to_owned(),
            zip: 1815,
        }),
        nickname: None,
        contact: Contact::Email(EmailContact {
            addr: "packed@example.com".to_owned(),
        }),
    }
}

/// [TDBIN-PACK-WORD] Sparse words encode as a tag plus non-zero bytes.
#[test]
fn tdbin_pack_word_encodes_sparse_word_byte_exactly() -> TestResult {
    let body = [0, 5, 0, 6, 0, 0, 0, 7];
    let packed = pack::encode(&body)?;

    assert_eq!(
        packed,
        vec![0b1000_1010, 5, 6, 7],
        "sparse word tag must name each non-zero byte"
    );
    assert_eq!(pack::decode(&packed)?, body, "sparse word must unpack");
    Ok(())
}

/// [TDBIN-PACK-WORD] Every sparse tag scatters payload bytes to the same slots.
#[test]
fn tdbin_pack_word_round_trips_every_sparse_tag() -> TestResult {
    for tag in 1_u8..u8::MAX {
        let body: [u8; 8] = core::array::from_fn(|offset| {
            let mask = 1_u8
                .checked_shl(u32::try_from(offset).unwrap_or(0))
                .unwrap_or(0);
            if tag & mask == 0 {
                0
            } else {
                u8::try_from(offset).unwrap_or(0).saturating_add(1)
            }
        });
        assert_eq!(pack::decode(&pack::encode(&body)?)?, body);
    }
    Ok(())
}

/// [TDBIN-PACK-RUNS] Zero-word runs encode as tag zero plus additional count.
#[test]
fn tdbin_pack_runs_encode_zero_words_byte_exactly() -> TestResult {
    let body = [0_u8; 24];
    let packed = pack::encode(&body)?;

    assert_eq!(packed, vec![0, 2], "three zero words are count N=2");
    assert_eq!(pack::decode(&packed)?, body, "zero run must unpack");
    Ok(())
}

/// [TDBIN-PACK-RUNS] Dense words use the uncompressible passthrough run.
#[test]
fn tdbin_pack_runs_encode_dense_words_byte_exactly() -> TestResult {
    let mut body = Vec::new();
    body.extend_from_slice(&[1, 2, 3, 4, 5, 6, 7, 8]);
    body.extend_from_slice(&[9, 10, 11, 12, 13, 14, 15, 16]);
    let packed = pack::encode(&body)?;
    let mut expected = vec![0xFF, 1, 2, 3, 4, 5, 6, 7, 8, 1];
    expected.extend_from_slice(&[9, 10, 11, 12, 13, 14, 15, 16]);

    assert_eq!(packed, expected, "two dense words use one passthrough run");
    assert_eq!(pack::decode(&packed)?, body, "dense run must unpack");
    Ok(())
}

/// [TDBIN-PACK] Packed framed generated ADTs decode through `TdBin`.
#[test]
fn tdbin_pack_frame_round_trips_generated_typed_value() -> TestResult {
    let person = packed_person();
    let packed = person.to_packed_framed_bytes(Some(Person::LAYOUT_HASH))?;
    let decoded_frame = frame::decode(&packed)?;

    assert!(
        decoded_frame.is_packed(),
        "frame must self-describe packing"
    );
    assert_eq!(
        decoded_frame.schema_hash(),
        Some(Person::LAYOUT_HASH),
        "schema hash must survive packed framing"
    );
    assert_eq!(
        Person::from_framed_bytes(&packed)?,
        person,
        "packed framed generated value must round-trip"
    );
    Ok(())
}

/// [TDBIN-PACK] Truncated packed streams return typed errors, never panic.
#[test]
fn tdbin_pack_rejects_truncated_streams() {
    assert_eq!(pack::decode(&[0]), Err(DecodeError::PackedTruncated));
    assert_eq!(
        pack::decode(&[0xFF, 1, 2, 3]),
        Err(DecodeError::PackedTruncated)
    );
    assert_eq!(
        pack::decode(&[0b0000_0011, 1]),
        Err(DecodeError::PackedTruncated)
    );
}
