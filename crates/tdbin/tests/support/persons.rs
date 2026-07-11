//! [TDBIN-TEST-ROUNDTRIP] [TDBIN-TEST-GOLDEN] Shared Person/Contact fixture
//! builders and the test-result alias for the bare (`golden.rs`) and round-trip
//! (`roundtrip.rs`) lanes.
//!
//! Both lanes drive the SAME codegen-emitted `Person`/`Contact` ADT, so the
//! `generated` module wiring, the boxed-error `TestResult` alias, and the
//! field-assembling constructors live here once. Each lane calls them with its
//! own distinct VALUES (Ada/Alan for round-trip, Grace/Edsger for golden) so the
//! two lanes still exercise separate byte patterns — only the repeated literal
//! shape is shared, never a fixture value.

/// The codegen-emitted ADT types and their TDBIN codec, under test.
#[path = "../generated/mod.rs"]
pub mod generated;

use generated::{Address, Contact, EmailContact, Person, PhoneContact};

/// Boxed-error alias so tests use `?` without `unwrap`/`expect`.
pub type TestResult = Result<(), Box<dyn std::error::Error>>;

/// Build a `Person` with an address, a nickname, and an Email contact from the
/// caller's distinct values ([TDBIN-TEST-ROUNDTRIP]).
pub fn person_with_email(
    name: &str,
    age: i64,
    score: f64,
    street: &str,
    zip: i64,
    nickname: &str,
    email: &str,
) -> Person {
    Person {
        name: name.to_owned(),
        age,
        active: true,
        score,
        address: Some(Address {
            street: street.to_owned(),
            zip,
        }),
        nickname: Some(nickname.to_owned()),
        contact: email_contact(email),
    }
}

/// Build an address-less, nickname-less `Person` with a Phone contact from the
/// caller's distinct values ([TDBIN-TEST-ROUNDTRIP]).
pub fn person_with_phone(name: &str, age: i64, score: f64, number: i64, country: i64) -> Person {
    Person {
        name: name.to_owned(),
        age,
        active: false,
        score,
        address: None,
        nickname: None,
        contact: phone_contact(number, country),
    }
}

/// The Email arm of the Contact union over `addr`.
pub fn email_contact(addr: &str) -> Contact {
    Contact::Email(EmailContact {
        addr: addr.to_owned(),
    })
}

/// The Phone arm of the Contact union over `number`/`country`.
pub fn phone_contact(number: i64, country: i64) -> Contact {
    Contact::Phone(PhoneContact { number, country })
}
