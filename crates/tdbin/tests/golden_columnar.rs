//! [TDBIN-TEST-GOLDEN] [TDBIN-COL-ORDER] [TDBIN-COL-SAFE] Byte-exact golden vectors for the columnar (layout
//! major 2) corpus wire layout ([TDBIN-COL-GROUP], [TDBIN-COL-UNION]). Each
//! test pins the encoder to a hex constant, decodes that frozen hex straight
//! back to the fixture, AND proves the packed-framed round-trip is lossless —
//! so an accidental columnar wire-format change (in either direction) is
//! caught deterministically under `make test`.
//!
//! The ADT types and their codecs are typeDiagram-GENERATED at layout 2
//! (`generated_batches/mod.rs` and `generated_corpus/mod.rs`, owned by
//! codegen); this lane only consumes them and never hand-writes an
//! `impl Struct`. The columnar corpus layout is frozen by agreement, which is
//! what makes byte-exact golden constants legitimate. Layout 2 is PRE-FREEZE:
//! `PERSON_BATCH_HEX` was re-pinned when `Int` columns moved to
//! frame-of-reference delta blocks ([TDBIN-COL-INTBLOCK]); `EVENT_BATCH_HEX`
//! was unaffected (the event corpus has no `Int` columns).

/// Codegen-emitted Person/PersonBatch/ContactBatch columnar types.
pub mod generated_batches;
/// Codegen-emitted benchmark-corpus columnar types.
pub mod generated_corpus;

/// Shared lowercase-hex codec helpers (identical across the golden lanes).
#[path = "support/hexvectors.rs"]
mod hexvectors;

use generated_batches::{Address, Contact, EmailContact, Person, PersonBatch, PhoneContact};
use generated_corpus::{
    BenchEvent, BenchEventBatch, BenchNode, BenchNodeCreated, BenchSelectionChanged,
};
use hexvectors::{from_hex, to_hex};
use tdbin::TdBin;

/// Boxed-error alias so tests use `?` without `unwrap`/`expect`.
type TestResult = Result<(), Box<dyn std::error::Error>>;

// ── Fixtures (distinct from the benchmark corpus values to broaden coverage) ──

/// A 2-person batch: one dense row (Some address/nickname, Email) and one
/// sparse row (None fields, negative float, Phone) so the validity, var, and
/// dense union columns all carry mixed lanes.
fn person_batch() -> PersonBatch {
    PersonBatch {
        people: vec![
            Person {
                name: "Katherine Johnson".to_owned(),
                age: 44,
                active: true,
                score: 101.25,
                address: Some(Address {
                    street: "1 Orbit Lane".to_owned(),
                    zip: 1918,
                }),
                nickname: Some("The Computer".to_owned()),
                contact: Contact::Email(EmailContact {
                    addr: "katherine@example.org".to_owned(),
                }),
            },
            Person {
                name: "Alan Kay".to_owned(),
                age: 52,
                active: false,
                score: -8.5,
                address: None,
                nickname: None,
                contact: Contact::Phone(PhoneContact {
                    number: 1940,
                    country: 1,
                }),
            },
        ],
    }
}

/// A 3-event batch: a record payload with a nested child group and nested
/// string list (`NodeCreated`), a string-list payload (`SelectionChanged`),
/// and a bare `Heartbeat` so the tag column carries a payload-free lane.
fn event_batch() -> BenchEventBatch {
    BenchEventBatch {
        events: vec![
            BenchEvent::NodeCreated(BenchNodeCreated {
                document_id: "doc-golden".to_owned(),
                node: BenchNode {
                    id: "node-0001".to_owned(),
                    label: "Golden node".to_owned(),
                    x: 10.5,
                    y: -4.25,
                    width: 120.0,
                    height: 48.0,
                    selected: true,
                    locked: false,
                    tags: vec!["component".to_owned(), "golden".to_owned()],
                },
            }),
            BenchEvent::SelectionChanged(BenchSelectionChanged {
                document_id: "doc-golden".to_owned(),
                node_ids: vec!["node-0001".to_owned(), "node-0002".to_owned()],
                edge_ids: vec!["edge-0001".to_owned()],
            }),
            BenchEvent::Heartbeat,
        ],
    }
}

/// Assert `value` encodes to exactly `hex`, that decoding `hex` reproduces it,
/// and that the packed-framed round-trip is lossless.
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
    let packed = value.to_packed_framed_bytes(None)?;
    assert_eq!(
        &T::from_framed_bytes(&packed)?,
        value,
        "packed framed round-trip must be lossless"
    );
    Ok(())
}

// ── Frozen golden constants (bootstrapped from the FROZEN layout-2 encoder) ──

/// Golden bytes for [`person_batch`].
const PERSON_BATCH_HEX: &str = "00000000000001000000000001000b000200000000000000290000001200000029000000ca00000035000000aa0000003d000000110000003d0000001500000041000000110000004000000001000300650000001100000065000000120000006500000062000000680000000100030011080000000000004b6174686572696e65204a6f686e736f6e416c616e204b617900000000000000020000002c000000000000001000000000000000000000000100000000000000000000000050594000000000000021c001000000000000000100000000000000090000000a00000009000000620000000d000000aa0000000c0000000000000031204f72626974204c616e6500000000010000007e0700000000000000000000000000000000000001000000000000000c0000000000000054686520436f6d707574657200000000020000000000000009000000120000000800000001000200200000000100020000010000000000000100000000000000050000000a00000005000000aa00000015000000000000006b6174686572696e65406578616d706c652e6f7267000000010000000000000005000000aa0000000d000000aa000000010000009407000000000000000000000000000000000000010000000100000000000000000000000000000000000000";
/// Golden bytes for [`event_batch`].
const EVENT_BATCH_HEX: &str = "000000000000010000000000010006000300000000000000150000001a0000001400000001000300000000000000000000000000000000009c00000001000800000000000000000000030500000000000100000000000000090000000a00000009000000520000000c00000001000d000a00000000000000646f632d676f6c64656e0000000000000100000000000000310000000a000000310000004a000000350000000a000000350000005a000000390000000d000000390000000d000000390000000d000000390000000d00000039000000090000003900000009000000390000000a0000003900000012000000390000007a00000009000000000000006e6f64652d30303031000000000000000b00000000000000476f6c64656e206e6f64650000000000000000000000254000000000000011c00000000000005e4000000000000048400100000000000000000000000000000002000000000000000906000000000000636f6d706f6e656e74676f6c64656e0001000000000000001d0000000a0000001d00000052000000210000000a00000021000000120000002100000092000000290000000a000000290000000a000000290000004a0000000a00000000000000646f632d676f6c64656e000000000000020000000000000009090000000000006e6f64652d303030316e6f64652d3030303200000000000001000000000000000900000000000000656467652d3030303100000000000000";

// ── Tests ──

/// [TDBIN-TEST-GOLDEN] The 2-person columnar batch is byte-exact, round-trips
/// from frozen hex, and survives the packed frame.
#[test]
fn person_batch_is_byte_exact() -> TestResult {
    assert_golden(&person_batch(), PERSON_BATCH_HEX)
}

/// [TDBIN-TEST-GOLDEN] The 3-event columnar batch (with a Heartbeat lane) is
/// byte-exact, round-trips from frozen hex, and survives the packed frame.
#[test]
fn event_batch_is_byte_exact() -> TestResult {
    assert_golden(&event_batch(), EVENT_BATCH_HEX)
}
