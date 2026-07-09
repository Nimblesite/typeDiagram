//! [TDBIN-TEST-GOLDEN] Byte-exact golden vectors for the FROZEN v0 Person/Contact
//! wire layout. Each test pins the encoder to a hex constant AND decodes that
//! frozen hex straight back to the fixture — so an accidental wire-format change
//! (in either direction) is caught deterministically under `make test`.
//!
//! The ADT types and their codec are typeDiagram-GENERATED (`generated/mod.rs`,
//! owned by codegen); this lane only consumes them via `mod generated;` and never
//! hand-writes an `impl Struct`. The Person layout is frozen by agreement, which
//! is what makes byte-exact golden constants legitimate.

mod generated;

use generated::{Address, Contact, EmailContact, Person, PhoneContact};
use tdbin::TdBin;

/// Boxed-error alias so tests use `?` without `unwrap`/`expect`.
type TestResult = Result<(), Box<dyn std::error::Error>>;

// ── Fixtures (distinct from `roundtrip.rs` to broaden coverage, not duplicate) ──

/// A Person exercising Some(address), Some(nickname), and the Email variant.
fn person_full() -> Person {
    Person {
        name: "Grace Hopper".to_owned(),
        age: 85,
        active: true,
        score: 12.5,
        address: Some(Address {
            street: "1 Compiler Rd".to_owned(),
            zip: 1906,
        }),
        nickname: Some("Amazing Grace".to_owned()),
        contact: Contact::Email(EmailContact {
            addr: "grace@navy.mil".to_owned(),
        }),
    }
}

/// A Person exercising None fields, a negative float, and the Phone variant.
fn person_minimal() -> Person {
    Person {
        name: "Edsger Dijkstra".to_owned(),
        age: 72,
        active: false,
        score: -3.0,
        address: None,
        nickname: None,
        contact: Contact::Phone(PhoneContact {
            number: 1930,
            country: 31,
        }),
    }
}

/// The Email arm of the Contact union, standalone.
fn contact_email() -> Contact {
    Contact::Email(EmailContact {
        addr: "ada@analytical.uk".to_owned(),
    })
}

/// The Phone arm of the Contact union, standalone.
fn contact_phone() -> Contact {
    Contact::Phone(PhoneContact {
        number: 1815,
        country: 44,
    })
}

// ── Hex helpers (no external deps: this crate is offline-safe) ──

/// Lowercase hex encoding of `bytes`.
fn to_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::new();
    for &byte in bytes {
        if let (Some(&hi), Some(&lo)) = (
            HEX.get(usize::from(byte >> 4)),
            HEX.get(usize::from(byte & 0x0F)),
        ) {
            out.push(char::from(hi));
            out.push(char::from(lo));
        }
    }
    out
}

/// Decode one lowercase hex nibble, or `None` if it is not `[0-9a-f]`.
fn hex_nibble(c: u8) -> Option<u8> {
    match c {
        b'0'..=b'9' => Some(c.wrapping_sub(b'0')),
        b'a'..=b'f' => Some(c.wrapping_sub(b'a').wrapping_add(10)),
        _ => None,
    }
}

/// Decode a lowercase hex string to bytes.
fn from_hex(s: &str) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
    let raw = s.as_bytes();
    if !raw.len().is_multiple_of(2) {
        return Err("hex string has odd length".into());
    }
    let mut out = Vec::new();
    for pair in raw.chunks(2) {
        let hi = pair
            .first()
            .copied()
            .and_then(hex_nibble)
            .ok_or("bad hex digit")?;
        let lo = pair
            .get(1)
            .copied()
            .and_then(hex_nibble)
            .ok_or("bad hex digit")?;
        out.push((hi << 4) | lo);
    }
    Ok(out)
}

/// Assert `value` encodes to exactly `hex`, and that decoding `hex` reproduces it.
fn assert_golden<T>(value: &T, hex: &str) -> TestResult
where
    T: TdBin + PartialEq + core::fmt::Debug,
{
    let bytes = value.to_bytes()?;
    assert_eq!(
        to_hex(&bytes).as_str(),
        hex,
        "encoder output must match the frozen golden hex"
    );
    let decoded = T::from_bytes(&from_hex(hex)?)?;
    assert_eq!(
        &decoded, value,
        "frozen golden bytes must decode to the fixture"
    );
    Ok(())
}

// ── Frozen golden constants (bootstrapped from the FROZEN v0 encoder) ──

/// Golden bytes for [`person_full`].
const PERSON_FULL_HEX: &str = "00000000030004005500000000000000010000000000000000000000000029400d0000006200000010000000010001001d0000006a0000002000000001000100477261636520486f70706572000000007207000000000000010000006a0000003120436f6d70696c6572205264000000416d617a696e672047726163650000000000000000000000000000000000010001000000720000006772616365406e6176792e6d696c0000";
/// Golden bytes for [`person_minimal`].
const PERSON_MINIMAL_HEX: &str = "00000000030004004800000000000000000000000000000000000000000008c00d0000007a0000000000000000000000000000000000000008000000010001004564736765722044696a6b7374726100010000000000000000000000020000008a070000000000001f00000000000000";
/// Golden bytes for [`contact_email`].
const CONTACT_EMAIL_HEX: &str = "000000000100010000000000000000000000000000000100010000008a00000061646140616e616c79746963616c2e756b00000000000000";
/// Golden bytes for [`contact_phone`].
const CONTACT_PHONE_HEX: &str =
    "00000000010001000100000000000000000000000200000017070000000000002c00000000000000";

// ── Tests ──

/// [TDBIN-TEST-GOLDEN] Full Person is byte-exact and round-trips from frozen hex.
#[test]
fn person_full_is_byte_exact() -> TestResult {
    assert_golden(&person_full(), PERSON_FULL_HEX)
}

/// [TDBIN-TEST-GOLDEN] Minimal Person is byte-exact and round-trips from frozen hex.
#[test]
fn person_minimal_is_byte_exact() -> TestResult {
    assert_golden(&person_minimal(), PERSON_MINIMAL_HEX)
}

/// [TDBIN-TEST-GOLDEN] `Contact::Email` is byte-exact and round-trips from frozen hex.
#[test]
fn contact_email_is_byte_exact() -> TestResult {
    assert_golden(&contact_email(), CONTACT_EMAIL_HEX)
}

/// [TDBIN-TEST-GOLDEN] `Contact::Phone` is byte-exact and round-trips from frozen hex.
#[test]
fn contact_phone_is_byte_exact() -> TestResult {
    assert_golden(&contact_phone(), CONTACT_PHONE_HEX)
}
