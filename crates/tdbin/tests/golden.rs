//! [TDBIN-TEST-GOLDEN] [TDBIN-ENC-ORDER] [TDBIN-ENC-CANON] [TDBIN-MSG-BARE]
//! [TDBIN-UNION-STRUCT] [TDBIN-UNION-DISC] [TDBIN-REC-SECTIONS] Byte-exact golden vectors for the FROZEN v0 Person/Contact
//! wire layout. Each test pins the encoder to a hex constant AND decodes that
//! frozen hex straight back to the fixture — so an accidental wire-format change
//! (in either direction) is caught deterministically under `make test`.
//!
//! The ADT types and their codec are typeDiagram-GENERATED (`generated/mod.rs`,
//! owned by codegen); this lane only consumes them via `mod generated;` and never
//! hand-writes an `impl Struct`. The Person layout is frozen by agreement, which
//! is what makes byte-exact golden constants legitimate.

/// Shared lowercase-hex codec helpers (identical across the golden lanes).
#[path = "support/hexvectors.rs"]
mod hexvectors;

/// Shared Person/Contact fixtures, ADT wiring, and `TestResult` alias
/// (reused by `roundtrip.rs`).
#[path = "support/persons.rs"]
mod persons;

use hexvectors::{from_hex, to_hex};
use persons::generated::Contact;
use persons::{email_contact, person_with_email, person_with_phone, phone_contact, TestResult};
use tdbin::TdBin;

// ── Golden-lane fixtures: distinct VALUES over the shared builders ──

/// A Person exercising Some(address), Some(nickname), and the Email variant.
fn person_full() -> persons::generated::Person {
    person_with_email(
        "Grace Hopper",
        85,
        12.5,
        "1 Compiler Rd",
        1906,
        "Amazing Grace",
        "grace@navy.mil",
    )
}

/// A Person exercising None fields, a negative float, and the Phone variant.
fn person_minimal() -> persons::generated::Person {
    person_with_phone("Edsger Dijkstra", 72, -3.0, 1930, 31)
}

/// The Email arm of the Contact union, standalone.
fn contact_email() -> Contact {
    email_contact("ada@analytical.uk")
}

/// The Phone arm of the Contact union, standalone.
fn contact_phone() -> Contact {
    phone_contact(1815, 44)
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
