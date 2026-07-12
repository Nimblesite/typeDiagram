//! Emit exact benchmark fixture sizes as machine-readable JSON.

/// Shared TDBIN and Protobuf corpus values.
#[path = "../tests/support/bench_corpus.rs"]
mod bench_corpus;

use bench_corpus::{batches, corpus, documents, events};
use prost::Message;
use tdbin::{Struct, TdBin};

/// Boxed-error alias for the data emitter.
type BoxError = Box<dyn std::error::Error>;

/// Compute one fixture's exact encoded sizes and return a JSON object.
///
/// `corpus` marks the committed [TDBIN-BENCH-CORPUS] schema workloads that the
/// release gate is computed over; other rows are stress rows.
fn fixture<T, P>(
    name: &str,
    shape: &str,
    corpus: bool,
    items: usize,
    td: &T,
    pb: &P,
) -> Result<String, BoxError>
where
    T: Struct + TdBin,
    P: Message + serde::Serialize,
{
    let bare = td.to_bytes()?;
    let framed = td.to_framed_bytes(None)?;
    let packed = td.to_packed_framed_bytes(None)?;
    let msgpack = rmp_serde::to_vec_named(pb)?;
    Ok(format!(
        "{{\"name\":\"{name}\",\"shape\":\"{shape}\",\"corpus\":{corpus},\"logical_items\":{items},\"tdbin_bare\":{},\"tdbin_framed\":{},\"tdbin_packed_framed\":{},\"protobuf\":{},\"msgpack\":{}}}",
        bare.len(),
        framed.len(),
        packed.len(),
        pb.encoded_len(),
        msgpack.len()
    ))
}

/// Emit all size rows consumed by `scripts/tdbin-bench-report.mjs`.
fn main() -> Result<(), BoxError> {
    let rows = [
        fixture(
            "with_address",
            "tiny nested record and union",
            false,
            1,
            &corpus::td_with_address(),
            &corpus::pb_with_address(),
        )?,
        fixture(
            "without_address",
            "tiny sparse record and union",
            false,
            1,
            &corpus::td_without_address(),
            &corpus::pb_without_address(),
        )?,
        fixture(
            "metric_batch",
            "list-heavy telemetry",
            true,
            corpus::METRIC_SAMPLE_COUNT,
            &corpus::td_metric_batch(),
            &corpus::pb_metric_batch(),
        )?,
        fixture(
            "person_batch",
            "repeated records",
            false,
            batches::PERSON_COUNT,
            &batches::td_person_batch(),
            &batches::pb_person_batch(),
        )?,
        fixture(
            "contact_batch",
            "repeated unions",
            false,
            batches::CONTACT_COUNT,
            &batches::td_contact_batch(),
            &batches::pb_contact_batch(),
        )?,
        fixture(
            "diagram_document",
            "record-heavy diagram document",
            true,
            documents::NODE_COUNT + documents::EDGE_COUNT,
            &documents::td_document(),
            &documents::pb_document(),
        )?,
        fixture(
            "event_batch",
            "union-heavy event stream",
            true,
            events::EVENT_COUNT,
            &events::td_event_batch(),
            &events::pb_event_batch(),
        )?,
    ];
    println!("{{\"format_version\":1,\"fixtures\":[{}]}}", rows.join(","));
    Ok(())
}
