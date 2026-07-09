//! [TDBIN-MSG-FRAME] black-box tests for the public frame envelope API.

use tdbin::frame::{self, Options};
use tdbin::{DecodeError, TdBin};

/// The codegen-emitted ADT types and their TDBIN codec, under test.
mod generated;

use generated::{Address, Contact, EmailContact, Person, PhoneContact};

/// A boxed error alias so tests can use `?` without `unwrap`.
type TestResult<T = ()> = Result<T, Box<dyn std::error::Error>>;

/// Return a copy of `bytes` with one byte changed.
fn with_byte(bytes: &[u8], offset: usize, value: u8) -> TestResult<Vec<u8>> {
    let mut out = bytes.to_vec();
    let slot = out.get_mut(offset).ok_or("fixture offset out of bounds")?;
    *slot = value;
    Ok(out)
}

/// Build a generated `Person` fixture for framed helper tests.
fn person_for_frame(contact: Contact) -> Person {
    Person {
        name: "Frame Person".to_owned(),
        age: 42,
        active: true,
        score: 1.25,
        address: Some(Address {
            street: "Frame Street".to_owned(),
            zip: 8080,
        }),
        nickname: None,
        contact,
    }
}

/// [TDBIN-MSG-FRAME] An unpacked body without a hash has the 12-byte header.
#[test]
fn tdbin_msg_frame_round_trips_unpacked_body() -> TestResult {
    let body = [0xAA, 0xBB, 0xCC, 0xDD, 0, 1, 2, 3];
    let framed = frame::encode(&body, Options::bare())?;
    let expected = vec![
        0x54, 0x44, 0x42, 0x31, 1, 0, 0, 0, 8, 0, 0, 0, 0xAA, 0xBB, 0xCC, 0xDD, 0, 1, 2, 3,
    ];

    assert_eq!(framed, expected, "frame header must be byte-exact");
    let decoded = frame::decode(&framed)?;
    assert_eq!(decoded.body(), body, "decoded body must be borrowed intact");
    assert_eq!(decoded.schema_hash(), None, "hash flag must be absent");
    assert!(!decoded.is_packed(), "packed flag must be absent");
    Ok(())
}

/// [TDBIN-MSG-FRAME] Packed+hash flags are self-described by the header bytes.
#[test]
fn tdbin_msg_frame_round_trips_packed_hash_metadata() -> TestResult {
    let body = [1, 0, 0];
    let framed = frame::encode(&body, Options::new(true, Some(0x0102_0304_0506_0708)))?;
    let expected = vec![
        0x54, 0x44, 0x42, 0x31, 1, 3, 0, 0, 3, 0, 0, 0, 8, 7, 6, 5, 4, 3, 2, 1, 1, 0, 0,
    ];

    assert_eq!(framed, expected, "hash-bearing frame must be byte-exact");
    let decoded = frame::decode(&framed)?;
    assert_eq!(decoded.body(), body, "packed body bytes stay packed");
    assert_eq!(
        decoded.schema_hash(),
        Some(0x0102_0304_0506_0708),
        "schema hash must decode little-endian"
    );
    assert!(
        decoded.is_packed(),
        "packed flag must be recovered from bytes"
    );
    Ok(())
}

/// [TDBIN-MSG-FRAME] Generated ADTs can use the framed `TdBin` helpers.
#[test]
fn tdbin_msg_frame_round_trips_generated_typed_value() -> TestResult {
    for person in [
        person_for_frame(Contact::Email(EmailContact {
            addr: "frame@example.com".to_owned(),
        })),
        person_for_frame(Contact::Phone(PhoneContact {
            number: 1234,
            country: 61,
        })),
    ] {
        let framed = person.to_framed_bytes(Some(0x1122_3344_5566_7788))?;
        let decoded_frame = frame::decode(&framed)?;
        assert_eq!(
            decoded_frame.schema_hash(),
            Some(0x1122_3344_5566_7788),
            "framed typed encode must preserve schema hash"
        );
        assert!(!decoded_frame.is_packed(), "typed framing is unpacked");
        assert_eq!(
            Person::from_framed_bytes(&framed)?,
            person,
            "framed typed value must round-trip"
        );
    }
    Ok(())
}

/// [TDBIN-MSG-FRAME] Typed framed decode unpacks packed bodies.
#[test]
fn tdbin_msg_frame_typed_decode_accepts_packed_body() -> TestResult {
    let person = person_for_frame(Contact::Phone(PhoneContact {
        number: 777,
        country: 1,
    }));
    let body = person.to_bytes()?;
    let framed = frame::encode_packed(&body, None)?;

    assert_eq!(
        Person::from_framed_bytes(&framed),
        Ok(person),
        "typed decode must unpack packed frame bodies"
    );
    Ok(())
}

/// [TDBIN-MSG-FRAME] Readers reject invalid header fields and body lengths.
#[test]
fn tdbin_msg_frame_rejects_invalid_headers() -> TestResult {
    let framed = frame::encode(&[9, 8, 7], Options::bare())?;

    assert_eq!(
        frame::decode(&with_byte(&framed, 0, b'X')?),
        Err(DecodeError::BadMagic),
        "wrong magic must be rejected"
    );
    assert_eq!(
        frame::decode(&with_byte(&framed, 4, 2)?),
        Err(DecodeError::BadVersion { version: 2 }),
        "unknown version must be rejected"
    );
    assert_eq!(
        frame::decode(&with_byte(&framed, 5, 4)?),
        Err(DecodeError::ReservedBits),
        "unknown flags must be rejected"
    );
    assert_eq!(
        frame::decode(&with_byte(&framed, 6, 1)?),
        Err(DecodeError::ReservedBits),
        "reserved field must be zero"
    );
    assert_eq!(
        frame::decode(&with_byte(&framed, 8, 4)?),
        Err(DecodeError::LengthMismatch),
        "body_len must match the available body bytes exactly"
    );
    Ok(())
}
