//! Additional record-heavy and union-heavy benchmark fixtures.

use prost::Message;

use super::corpus;
use super::generated_batches::{
    Contact, ContactBatch, EmailContact, Person, PersonBatch, PhoneContact,
};

/// Number of records in the record-heavy batch.
pub const PERSON_COUNT: usize = 512;
/// Number of union values in the union-heavy batch.
pub const CONTACT_COUNT: usize = 2_048;

/// Protobuf record-heavy batch.
#[derive(serde::Serialize, serde::Deserialize, Clone, PartialEq, Message)]
pub struct PbPersonBatch {
    /// Repeated records.
    #[prost(message, repeated, tag = "1")]
    pub people: Vec<corpus::pb::Person>,
}

/// Protobuf union-heavy batch.
#[derive(serde::Serialize, serde::Deserialize, Clone, PartialEq, Message)]
pub struct PbContactBatch {
    /// Repeated oneof envelopes.
    #[prost(message, repeated, tag = "1")]
    pub contacts: Vec<PbContactEnvelope>,
}

/// Protobuf message envelope required around each repeated oneof value.
#[derive(serde::Serialize, serde::Deserialize, Clone, PartialEq, Message)]
pub struct PbContactEnvelope {
    /// Contact payload.
    #[prost(oneof = "PbContact", tags = "1, 2")]
    pub contact: Option<PbContact>,
}

/// Protobuf mirror of the generated Contact union.
#[derive(serde::Serialize, serde::Deserialize, Clone, PartialEq, prost::Oneof)]
pub enum PbContact {
    /// Email contact.
    #[prost(message, tag = "1")]
    Email(corpus::pb::EmailContact),
    /// Phone contact.
    #[prost(message, tag = "2")]
    Phone(corpus::pb::PhoneContact),
}

/// Build the record-heavy TDBIN fixture.
#[must_use]
pub fn td_person_batch() -> PersonBatch {
    PersonBatch {
        people: (0..PERSON_COUNT).map(person_at).collect(),
    }
}

/// Build the record-heavy Protobuf fixture.
#[must_use]
pub fn pb_person_batch() -> PbPersonBatch {
    PbPersonBatch {
        people: (0..PERSON_COUNT).map(pb_person_at).collect(),
    }
}

/// Build the union-heavy TDBIN fixture.
#[must_use]
pub fn td_contact_batch() -> ContactBatch {
    ContactBatch {
        contacts: (0..CONTACT_COUNT).map(contact_at).collect(),
    }
}

/// Build the union-heavy Protobuf fixture.
#[must_use]
pub fn pb_contact_batch() -> PbContactBatch {
    PbContactBatch {
        contacts: (0..CONTACT_COUNT).map(pb_contact_at).collect(),
    }
}

/// Build one varied TDBIN person.
fn person_at(index: usize) -> Person {
    let mut value = if index.is_multiple_of(2) {
        corpus::td_with_address()
    } else {
        corpus::td_without_address()
    };
    value.age = value
        .age
        .checked_add(i64::try_from(index % 50).unwrap_or(0))
        .unwrap_or(value.age);
    value
}

/// Build one varied Protobuf person.
fn pb_person_at(index: usize) -> corpus::pb::Person {
    let mut value = if index.is_multiple_of(2) {
        corpus::pb_with_address()
    } else {
        corpus::pb_without_address()
    };
    value.age = value
        .age
        .checked_add(i64::try_from(index % 50).unwrap_or(0))
        .unwrap_or(value.age);
    value
}

/// Build one TDBIN union value.
fn contact_at(index: usize) -> Contact {
    if index.is_multiple_of(2) {
        Contact::Email(EmailContact {
            addr: format!("user{index}@example.com"),
        })
    } else {
        Contact::Phone(PhoneContact {
            number: i64::try_from(index).unwrap_or(0),
            country: 61,
        })
    }
}

/// Build one Protobuf union envelope.
fn pb_contact_at(index: usize) -> PbContactEnvelope {
    let contact = if index.is_multiple_of(2) {
        PbContact::Email(corpus::pb::EmailContact {
            addr: format!("user{index}@example.com"),
        })
    } else {
        PbContact::Phone(corpus::pb::PhoneContact {
            number: i64::try_from(index).unwrap_or(0),
            country: 61,
        })
    };
    PbContactEnvelope {
        contact: Some(contact),
    }
}
