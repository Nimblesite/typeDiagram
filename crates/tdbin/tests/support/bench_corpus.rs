//! [TDBIN-BENCH-CORPUS] Shared benchmark corpus values for TDBIN and Protobuf.
//!
//! This support module is reused by the deterministic size gate, the ad hoc
//! benchmark example, and the Criterion benchmark target.

/// The codegen-emitted columnar (layout 2) corpus ADT types and codecs,
/// generated from `docs/benchmarks/tdbin-corpus.td`.
#[path = "../generated_corpus/mod.rs"]
pub mod generated_corpus;

/// The codegen-emitted columnar (layout 2) Person/PersonBatch/ContactBatch
/// ADT types and codecs.
#[path = "../generated_batches/mod.rs"]
pub mod generated_batches;

/// Record-heavy and union-heavy batch fixtures used by the benchmark suite.
#[path = "batch_corpus.rs"]
pub mod batches;

/// Diagram-document fixture matching the committed benchmark schemas.
#[path = "document_corpus.rs"]
pub mod documents;

/// Event-stream fixture matching the committed benchmark schemas.
#[path = "event_corpus.rs"]
pub mod events;

/// The benchmark corpus: shared scalar constants, a hand-written Protobuf
/// mirror of the TDBIN `Person` ADT (the competitor baseline), and paired
/// fixtures that build the SAME two values for both codecs so every size and
/// speed comparison is strictly 1:1.
pub mod corpus {
    /// Columnar corpus metric types re-exported for the gate and benches.
    pub use super::generated_corpus::{BenchMetricBatch, BenchMetricColumn};

    use super::generated_batches::{Address, Contact, EmailContact, Person, PhoneContact};

    /// `name` of the first fixture (the `Some`/`Email` case).
    const NAME_1: &str = "Ada Lovelace";
    /// `age` of the first fixture.
    const AGE_1: i64 = 36;
    /// `active` flag of the first fixture.
    const ACTIVE_1: bool = true;
    /// `score` of the first fixture.
    const SCORE_1: f64 = 9.75;
    /// `street` of the first fixture's address.
    const STREET_1: &str = "1 Analytical Way";
    /// `zip` of the first fixture's address.
    const ZIP_1: i64 = 1815;
    /// `nickname` of the first fixture.
    const NICKNAME_1: &str = "Countess";
    /// `addr` of the first fixture's email contact.
    const EMAIL_1: &str = "ada@example.com";

    /// `name` of the second fixture (the `None`/`Phone` case).
    const NAME_2: &str = "Alan Turing";
    /// `age` of the second fixture.
    const AGE_2: i64 = 41;
    /// `active` flag of the second fixture.
    const ACTIVE_2: bool = false;
    /// `score` of the second fixture (a negative float).
    const SCORE_2: f64 = -1.5;
    /// `number` of the second fixture's phone contact.
    const PHONE_NUMBER_2: i64 = 1912;
    /// `country` of the second fixture's phone contact.
    const PHONE_COUNTRY_2: i64 = 44;

    /// Number of list-heavy metric samples in the realistic benchmark fixture.
    pub const METRIC_SAMPLE_COUNT: usize = 4096;
    /// Number of byte payloads in the realistic benchmark fixture.
    const PAYLOAD_COUNT: usize = 32;
    /// Bytes in each byte payload.
    const PAYLOAD_BYTES: usize = 64;
    /// Number of repeated metric columns.
    const COLUMN_COUNT: usize = 4;
    /// Number of floating-point values in each metric column.
    const COLUMN_VALUES: usize = 256;
    /// High positive base ID so Protobuf int64 varints need nine bytes/sample.
    const SAMPLE_ID_BASE: i64 = 0x4000_0000_0000_0000;

    /// The Protobuf mirror of the TDBIN corpus ADTs, hand-written with `prost`
    /// derives. Field numbers and wire types mirror the TDBIN values 1:1 so the
    /// size and speed comparison is fair.
    pub mod pb {
        /// The `Address` message: `string street = 1; int64 zip = 2;`.
        #[derive(serde::Serialize, serde::Deserialize, Clone, PartialEq, prost::Message)]
        pub struct Address {
            /// The street line.
            #[prost(string, tag = "1")]
            pub street: String,
            /// The postal code.
            #[prost(int64, tag = "2")]
            pub zip: i64,
        }

        /// The `EmailContact` message: `string addr = 1;`.
        #[derive(serde::Serialize, serde::Deserialize, Clone, PartialEq, prost::Message)]
        pub struct EmailContact {
            /// The email address.
            #[prost(string, tag = "1")]
            pub addr: String,
        }

        /// The `PhoneContact` message: `int64 number = 1; int64 country = 2;`.
        #[derive(serde::Serialize, serde::Deserialize, Clone, PartialEq, prost::Message)]
        pub struct PhoneContact {
            /// The subscriber number.
            #[prost(int64, tag = "1")]
            pub number: i64,
            /// The country code.
            #[prost(int64, tag = "2")]
            pub country: i64,
        }

        /// The `contact` oneof: `EmailContact email = 7 | PhoneContact phone = 8`.
        #[derive(serde::Serialize, serde::Deserialize, Clone, PartialEq, prost::Oneof)]
        pub enum Contact {
            /// The email-contact variant.
            #[prost(message, tag = "7")]
            Email(EmailContact),
            /// The phone-contact variant.
            #[prost(message, tag = "8")]
            Phone(PhoneContact),
        }

        /// The top-level `Person` message mirroring the TDBIN `Person` record.
        #[derive(serde::Serialize, serde::Deserialize, Clone, PartialEq, prost::Message)]
        pub struct Person {
            /// The full name.
            #[prost(string, tag = "1")]
            pub name: String,
            /// The age in years.
            #[prost(int64, tag = "2")]
            pub age: i64,
            /// Whether the record is active.
            #[prost(bool, tag = "3")]
            pub active: bool,
            /// A floating-point score.
            #[prost(double, tag = "4")]
            pub score: f64,
            /// The optional postal address.
            #[prost(message, optional, tag = "5")]
            pub address: Option<Address>,
            /// The optional nickname.
            #[prost(string, optional, tag = "6")]
            pub nickname: Option<String>,
            /// The tagged-union contact (email or phone).
            #[prost(oneof = "Contact", tags = "7, 8")]
            pub contact: Option<Contact>,
        }

        /// A metric batch with list-heavy, fixed-width data.
        #[derive(serde::Serialize, serde::Deserialize, Clone, PartialEq, prost::Message)]
        pub struct BenchMetricBatch {
            /// Batch identifier.
            #[prost(string, tag = "1")]
            pub batch_id: String,
            /// Start time as epoch milliseconds.
            #[prost(int64, tag = "2")]
            pub started_at_epoch_ms: i64,
            /// Large sample identifiers.
            #[prost(int64, repeated, packed = "true", tag = "3")]
            pub sample_ids: Vec<i64>,
            /// Per-sample validity flags.
            #[prost(bool, repeated, packed = "true", tag = "4")]
            pub valid: Vec<bool>,
            /// Per-sample latency values.
            #[prost(double, repeated, packed = "true", tag = "5")]
            pub latency_ms: Vec<f64>,
            /// Binary payload samples.
            #[prost(bytes = "vec", repeated, tag = "6")]
            pub payloads: Vec<Vec<u8>>,
            /// Additional metric columns.
            #[prost(message, repeated, tag = "7")]
            pub columns: Vec<BenchMetricColumn>,
        }

        /// A named repeated-double metric column.
        #[derive(serde::Serialize, serde::Deserialize, Clone, PartialEq, prost::Message)]
        pub struct BenchMetricColumn {
            /// Column name.
            #[prost(string, tag = "1")]
            pub name: String,
            /// Column values.
            #[prost(double, repeated, packed = "true", tag = "2")]
            pub values: Vec<f64>,
        }
    }

    /// Build the first TDBIN fixture (`Some` address, `Some` nickname, `Email`).
    #[must_use]
    pub fn td_with_address() -> Person {
        Person {
            name: NAME_1.to_owned(),
            age: AGE_1,
            active: ACTIVE_1,
            score: SCORE_1,
            address: Some(Address {
                street: STREET_1.to_owned(),
                zip: ZIP_1,
            }),
            nickname: Some(NICKNAME_1.to_owned()),
            contact: Contact::Email(EmailContact {
                addr: EMAIL_1.to_owned(),
            }),
        }
    }

    /// Build the second TDBIN fixture (`None` fields, negative float, `Phone`).
    #[must_use]
    pub fn td_without_address() -> Person {
        Person {
            name: NAME_2.to_owned(),
            age: AGE_2,
            active: ACTIVE_2,
            score: SCORE_2,
            address: None,
            nickname: None,
            contact: Contact::Phone(PhoneContact {
                number: PHONE_NUMBER_2,
                country: PHONE_COUNTRY_2,
            }),
        }
    }

    /// Build the Protobuf mirror of [`td_with_address`] with identical values.
    #[must_use]
    pub fn pb_with_address() -> pb::Person {
        pb::Person {
            name: NAME_1.to_owned(),
            age: AGE_1,
            active: ACTIVE_1,
            score: SCORE_1,
            address: Some(pb::Address {
                street: STREET_1.to_owned(),
                zip: ZIP_1,
            }),
            nickname: Some(NICKNAME_1.to_owned()),
            contact: Some(pb::Contact::Email(pb::EmailContact {
                addr: EMAIL_1.to_owned(),
            })),
        }
    }

    /// Build the Protobuf mirror of [`td_without_address`] with identical values.
    #[must_use]
    pub fn pb_without_address() -> pb::Person {
        pb::Person {
            name: NAME_2.to_owned(),
            age: AGE_2,
            active: ACTIVE_2,
            score: SCORE_2,
            address: None,
            nickname: None,
            contact: Some(pb::Contact::Phone(pb::PhoneContact {
                number: PHONE_NUMBER_2,
                country: PHONE_COUNTRY_2,
            })),
        }
    }

    /// Build the list-heavy TDBIN metric batch fixture.
    #[must_use]
    pub fn td_metric_batch() -> BenchMetricBatch {
        BenchMetricBatch {
            batch_id: "metric-batch-2026-07-09T12:00:00Z".to_owned(),
            started_at_epoch_ms: 1_783_604_800_000,
            sample_ids: sample_ids(),
            valid: valid_flags(),
            latency_ms: latency_values(),
            payloads: payloads(),
            columns: td_columns(),
        }
    }

    /// Build the Protobuf mirror of [`td_metric_batch`] with identical values.
    #[must_use]
    pub fn pb_metric_batch() -> pb::BenchMetricBatch {
        pb::BenchMetricBatch {
            batch_id: "metric-batch-2026-07-09T12:00:00Z".to_owned(),
            started_at_epoch_ms: 1_783_604_800_000,
            sample_ids: sample_ids(),
            valid: valid_flags(),
            latency_ms: latency_values(),
            payloads: payloads(),
            columns: pb_columns(),
        }
    }

    /// Deterministic high-value sample IDs.
    fn sample_ids() -> Vec<i64> {
        (0..METRIC_SAMPLE_COUNT).map(sample_id).collect()
    }

    /// One deterministic sample ID.
    fn sample_id(i: usize) -> i64 {
        SAMPLE_ID_BASE
            .checked_add(i64::try_from(i).unwrap_or(0))
            .unwrap_or(SAMPLE_ID_BASE)
    }

    /// Deterministic validity flags.
    fn valid_flags() -> Vec<bool> {
        (0..METRIC_SAMPLE_COUNT).map(|i| i % 7 != 0).collect()
    }

    /// Deterministic latency values.
    fn latency_values() -> Vec<f64> {
        (0..METRIC_SAMPLE_COUNT)
            .map(|i| f64::from(u32::try_from(i % 97).unwrap_or(0)) + 0.125)
            .collect()
    }

    /// Deterministic binary payloads.
    fn payloads() -> Vec<Vec<u8>> {
        (0..PAYLOAD_COUNT).map(payload).collect()
    }

    /// One deterministic payload.
    fn payload(i: usize) -> Vec<u8> {
        (0..PAYLOAD_BYTES)
            .map(|j| u8::try_from(payload_byte(i, j)).unwrap_or(0))
            .collect()
    }

    /// One deterministic payload byte.
    fn payload_byte(i: usize, j: usize) -> usize {
        let left = i.checked_mul(31).unwrap_or(0);
        let right = j.checked_mul(17).unwrap_or(0);
        left.checked_add(right).unwrap_or(0) & 0xff
    }

    /// Deterministic TDBIN metric columns.
    fn td_columns() -> Vec<BenchMetricColumn> {
        (0..COLUMN_COUNT)
            .map(|i| BenchMetricColumn {
                name: format!("column_{i}"),
                values: column_values(i),
            })
            .collect()
    }

    /// Deterministic Protobuf metric columns.
    fn pb_columns() -> Vec<pb::BenchMetricColumn> {
        (0..COLUMN_COUNT)
            .map(|i| pb::BenchMetricColumn {
                name: format!("column_{i}"),
                values: column_values(i),
            })
            .collect()
    }

    /// Deterministic repeated-double column values.
    fn column_values(column: usize) -> Vec<f64> {
        (0..COLUMN_VALUES)
            .map(|i| {
                let raw = column
                    .checked_mul(COLUMN_VALUES)
                    .and_then(|base| base.checked_add(i))
                    .unwrap_or(0);
                f64::from(u32::try_from(raw % 2048).unwrap_or(0)) + 0.5
            })
            .collect()
    }
}
