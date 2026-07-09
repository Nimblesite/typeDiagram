//! [TDBIN-TEST-ROUNDTRIP] Bidirectional round-trip tests over the public API:
//! typed object -> binary -> typed object, AND binary -> object -> binary
//! (byte-identical). The `Person`/`Contact`/`Address`/... types AND their
//! `impl tdbin::Struct` codecs are NOT hand-written here — they are emitted by
//! typeDiagram codegen (`converters/rust-tdbin.ts`) into `generated/mod.rs`, so
//! these assertions prove the *generated* code round-trips: the end-to-end
//! typeDiagram ADT -> binary -> typeDiagram ADT proof runs under `cargo test`.

/// The codegen-emitted ADT types and their TDBIN codec, under test.
mod generated;

use generated::{Address, Contact, EmailContact, Person, PhoneContact};
use tdbin::{DecodeError, TdBin};

/// A boxed error alias so tests can use `?` without `unwrap`.
type TestResult = Result<(), Box<dyn std::error::Error>>;

// ── Fixtures ──

/// A person exercising Some(address), Some(nickname), and the Email variant.
fn person_with_address() -> Person {
    Person {
        name: "Ada Lovelace".to_owned(),
        age: 36,
        active: true,
        score: 9.75,
        address: Some(Address {
            street: "1 Analytical Way".to_owned(),
            zip: 1815,
        }),
        nickname: Some("Countess".to_owned()),
        contact: Contact::Email(EmailContact {
            addr: "ada@example.com".to_owned(),
        }),
    }
}

/// A person exercising None fields, a negative float, and the Phone variant.
fn person_without_address() -> Person {
    Person {
        name: "Alan Turing".to_owned(),
        age: 41,
        active: false,
        score: -1.5,
        address: None,
        nickname: None,
        contact: Contact::Phone(PhoneContact {
            number: 1912,
            country: 44,
        }),
    }
}

// ── Tests ──

/// typed object -> binary -> typed object is the identity, for both fixtures.
#[test]
fn object_to_binary_to_object_is_identity() -> TestResult {
    for person in [person_with_address(), person_without_address()] {
        let bytes = person.to_bytes()?;
        assert!(
            bytes.len().is_multiple_of(8),
            "message must be word-aligned"
        );
        assert!(bytes.len() >= 16, "non-empty root cannot fit in one word");
        let decoded = Person::from_bytes(&bytes)?;
        assert_eq!(
            decoded, person,
            "object -> binary -> object must round-trip exactly"
        );
    }
    Ok(())
}

/// binary -> typed object -> binary is byte-identical (canonical encoding).
#[test]
fn binary_to_object_to_binary_is_byte_identical() -> TestResult {
    for person in [person_with_address(), person_without_address()] {
        let bytes = person.to_bytes()?;
        let decoded = Person::from_bytes(&bytes)?;
        let reencoded = decoded.to_bytes()?;
        assert_eq!(
            reencoded, bytes,
            "binary -> object -> binary must reproduce the bytes"
        );
    }
    Ok(())
}

/// Encoding the same value twice yields identical bytes ([TDBIN-ENC-CANON]).
#[test]
fn encoding_is_deterministic() -> TestResult {
    let person = person_with_address();
    assert_eq!(
        person.to_bytes()?,
        person.to_bytes()?,
        "encoding must be deterministic"
    );
    Ok(())
}

/// The two fixtures encode to distinct byte strings (no accidental collision).
#[test]
fn distinct_values_encode_distinctly() -> TestResult {
    assert_ne!(
        person_with_address().to_bytes()?,
        person_without_address().to_bytes()?,
        "different values must not collide on the wire"
    );
    Ok(())
}

/// [TDBIN-TEST-EVIL] Adversarial inputs return typed errors, never panic.
#[test]
fn adversarial_inputs_return_typed_errors() -> TestResult {
    assert_eq!(Person::from_bytes(&[]), Err(DecodeError::BadLength));
    assert_eq!(Person::from_bytes(&[0, 0, 0]), Err(DecodeError::BadLength));
    assert_eq!(
        Person::from_bytes(&[0, 0, 0, 0, 0, 0, 0, 0]),
        Err(DecodeError::NullRoot)
    );
    assert_eq!(
        Person::from_bytes(&[0xFF; 8]),
        Err(DecodeError::ReservedPointerKind)
    );
    // A list-pointer root where a struct is required.
    assert_eq!(
        Person::from_bytes(&[0x01, 0, 0, 0, 0, 0, 0, 0]),
        Err(DecodeError::PointerKindMismatch)
    );

    // Truncating a valid message mid-body yields a bounds error, never a panic.
    let full = person_with_address().to_bytes()?;
    let truncated = full
        .get(..full.len().saturating_sub(8))
        .ok_or("fixture too short")?;
    match Person::from_bytes(truncated) {
        Err(DecodeError::PointerOutOfBounds { .. } | DecodeError::InvalidUtf8) => Ok(()),
        other => Err(format!("expected a bounds error on truncation, got {other:?}").into()),
    }
}
