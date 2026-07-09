//! [TDBIN-TEST-ROUNDTRIP] Bidirectional round-trip tests over the public API:
//! typed object -> binary -> typed object, AND binary -> object -> binary
//! (byte-identical). The example types below are shaped exactly like the
//! `impl Struct` blocks typeDiagram codegen emits from a Model.

use tdbin::scalar::{bool_bits, bool_from, f64_bits, f64_from, i64_bits, i64_from};
use tdbin::{DecodeError, EncodeError, Reader, Struct, TdBin, Writer};

/// A boxed error alias so tests can use `?` without `unwrap`.
type TestResult = Result<(), Box<dyn std::error::Error>>;

// ── Example ADTs (as codegen would emit) ──

/// A nested record reached through a pointer slot.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Address {
    /// Street line (pointer slot 0).
    street: String,
    /// Postal code (data slot 0).
    zip: i64,
}

impl Struct for Address {
    const DATA_WORDS: u16 = 1;
    const PTR_WORDS: u16 = 1;

    fn write_struct(&self, w: &mut Writer, at: usize) -> Result<(), EncodeError> {
        w.scalar(at, 0, i64_bits(self.zip))?;
        w.string(at, Self::DATA_WORDS, 0, Some(&self.street))
    }

    fn read_struct(r: &Reader<'_>, at: usize) -> Result<Self, DecodeError> {
        let zip = i64_from(r.scalar(at, 0)?);
        let street = r
            .string(at, Self::DATA_WORDS, 0)?
            .ok_or(DecodeError::UnexpectedNull)?;
        Ok(Self { street, zip })
    }
}

/// The email variant payload of `Contact`.
#[derive(Debug, Clone, PartialEq, Eq)]
struct EmailContact {
    /// Email address (pointer slot 0).
    addr: String,
}

impl Struct for EmailContact {
    const DATA_WORDS: u16 = 0;
    const PTR_WORDS: u16 = 1;

    fn write_struct(&self, w: &mut Writer, at: usize) -> Result<(), EncodeError> {
        w.string(at, Self::DATA_WORDS, 0, Some(&self.addr))
    }

    fn read_struct(r: &Reader<'_>, at: usize) -> Result<Self, DecodeError> {
        let addr = r
            .string(at, Self::DATA_WORDS, 0)?
            .ok_or(DecodeError::UnexpectedNull)?;
        Ok(Self { addr })
    }
}

/// The phone variant payload of `Contact`.
#[derive(Debug, Clone, PartialEq, Eq)]
struct PhoneContact {
    /// Subscriber number (data slot 0).
    number: i64,
    /// Country calling code (data slot 1).
    country: i64,
}

impl Struct for PhoneContact {
    const DATA_WORDS: u16 = 2;
    const PTR_WORDS: u16 = 0;

    fn write_struct(&self, w: &mut Writer, at: usize) -> Result<(), EncodeError> {
        w.scalar(at, 0, i64_bits(self.number))?;
        w.scalar(at, 1, i64_bits(self.country))
    }

    fn read_struct(r: &Reader<'_>, at: usize) -> Result<Self, DecodeError> {
        let number = i64_from(r.scalar(at, 0)?);
        let country = i64_from(r.scalar(at, 1)?);
        Ok(Self { number, country })
    }
}

/// A tagged union: discriminant in data slot 0, payload in pointer slot 0.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Contact {
    /// Reachable by email.
    Email(EmailContact),
    /// Reachable by phone.
    Phone(PhoneContact),
}

impl Struct for Contact {
    const DATA_WORDS: u16 = 1;
    const PTR_WORDS: u16 = 1;

    fn write_struct(&self, w: &mut Writer, at: usize) -> Result<(), EncodeError> {
        match self {
            Self::Email(payload) => {
                w.scalar(at, 0, 0)?;
                w.child(at, Self::DATA_WORDS, 0, Some(payload))
            }
            Self::Phone(payload) => {
                w.scalar(at, 0, 1)?;
                w.child(at, Self::DATA_WORDS, 0, Some(payload))
            }
        }
    }

    fn read_struct(r: &Reader<'_>, at: usize) -> Result<Self, DecodeError> {
        match r.scalar(at, 0)? {
            0 => Ok(Self::Email(
                r.child(at, Self::DATA_WORDS, 0)?
                    .ok_or(DecodeError::UnexpectedNull)?,
            )),
            1 => Ok(Self::Phone(
                r.child(at, Self::DATA_WORDS, 0)?
                    .ok_or(DecodeError::UnexpectedNull)?,
            )),
            ordinal => Err(DecodeError::UnknownVariant { ordinal }),
        }
    }
}

/// The root record: every scalar kind, an optional nested record, an
/// optional string, and a union.
#[derive(Debug, Clone, PartialEq)]
struct Person {
    /// Full name (pointer slot 0).
    name: String,
    /// Age in years (data slot 0).
    age: i64,
    /// Whether the account is active (data slot 1).
    active: bool,
    /// A floating-point score (data slot 2).
    score: f64,
    /// Optional mailing address (pointer slot 1).
    address: Option<Address>,
    /// Optional nickname (pointer slot 2).
    nickname: Option<String>,
    /// Preferred contact channel (pointer slot 3).
    contact: Contact,
}

impl Struct for Person {
    const DATA_WORDS: u16 = 3;
    const PTR_WORDS: u16 = 4;

    fn write_struct(&self, w: &mut Writer, at: usize) -> Result<(), EncodeError> {
        w.scalar(at, 0, i64_bits(self.age))?;
        w.scalar(at, 1, bool_bits(self.active))?;
        w.scalar(at, 2, f64_bits(self.score))?;
        w.string(at, Self::DATA_WORDS, 0, Some(&self.name))?;
        w.child(at, Self::DATA_WORDS, 1, self.address.as_ref())?;
        w.string(at, Self::DATA_WORDS, 2, self.nickname.as_deref())?;
        w.child(at, Self::DATA_WORDS, 3, Some(&self.contact))
    }

    fn read_struct(r: &Reader<'_>, at: usize) -> Result<Self, DecodeError> {
        let age = i64_from(r.scalar(at, 0)?);
        let active = bool_from(r.scalar(at, 1)?);
        let score = f64_from(r.scalar(at, 2)?);
        let name = r
            .string(at, Self::DATA_WORDS, 0)?
            .ok_or(DecodeError::UnexpectedNull)?;
        let address = r.child::<Address>(at, Self::DATA_WORDS, 1)?;
        let nickname = r.string(at, Self::DATA_WORDS, 2)?;
        let contact = r
            .child::<Contact>(at, Self::DATA_WORDS, 3)?
            .ok_or(DecodeError::UnexpectedNull)?;
        Ok(Self {
            name,
            age,
            active,
            score,
            address,
            nickname,
            contact,
        })
    }
}

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
