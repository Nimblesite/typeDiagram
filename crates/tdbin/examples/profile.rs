//! Loop one hot codec operation so an external sampling profiler can attach
//! (`/usr/bin/sample` on macOS). Companion to the `gate` benchmark: Criterion
//! answers "how fast", this answers "where does the time go".
//!
//! Usage: `cargo run -p tdbin --release --example profile -- <op> <seconds>`
//! where `<op>` is one of `event-enc`, `event-dec`, `person-enc`,
//! `diagram-dec`, `metric-pack-enc`, `metric-pack-dec`.

/// Shared TDBIN and Protobuf corpus values.
#[path = "../tests/support/bench_corpus.rs"]
mod bench_corpus;

use std::time::{Duration, Instant};

use bench_corpus::{batches, corpus, documents, events};
use prost::Message;
use tdbin::TdBin;

/// Boxed-error alias for the profile harness.
type BoxError = Box<dyn std::error::Error>;

/// Loop `op` until `deadline`, keeping results observable.
fn run_loop<T>(deadline: Instant, mut op: impl FnMut() -> T) -> u64 {
    let mut iterations = 0_u64;
    while Instant::now() < deadline {
        let value = op();
        iterations = iterations.wrapping_add(1);
        drop(std::hint::black_box(value));
    }
    iterations
}

/// Dispatch one profiling operation by name.
fn dispatch(op: &str, deadline: Instant) -> Result<u64, BoxError> {
    match op {
        "event-enc" => {
            let value = events::td_event_batch();
            Ok(run_loop(deadline, || value.to_bytes()))
        }
        "event-dec" => {
            let bytes = events::td_event_batch().to_bytes()?;
            Ok(run_loop(deadline, || {
                bench_corpus::generated_corpus::BenchEventBatch::from_bytes(&bytes)
            }))
        }
        "person-enc" => {
            let value = batches::td_person_batch();
            Ok(run_loop(deadline, || value.to_bytes()))
        }
        "diagram-dec" => {
            let bytes = documents::td_document().to_bytes()?;
            Ok(run_loop(deadline, || {
                bench_corpus::generated_corpus::BenchDocument::from_bytes(&bytes)
            }))
        }
        "metric-pack-enc" => {
            let value = corpus::td_metric_batch();
            Ok(run_loop(deadline, || value.to_packed_framed_bytes(None)))
        }
        "metric-pack-dec" => {
            let bytes = corpus::td_metric_batch().to_packed_framed_bytes(None)?;
            Ok(run_loop(deadline, || {
                bench_corpus::generated_corpus::BenchMetricBatch::from_framed_bytes(&bytes)
            }))
        }
        "contact-enc" => {
            let value = batches::td_contact_batch();
            Ok(run_loop(deadline, || value.to_bytes()))
        }
        "contact-dec" => {
            let bytes = batches::td_contact_batch().to_bytes()?;
            Ok(run_loop(deadline, || {
                bench_corpus::generated_batches::ContactBatch::from_bytes(&bytes)
            }))
        }
        "diagram-enc" => {
            let value = documents::td_document();
            Ok(run_loop(deadline, || value.to_bytes()))
        }
        "person-dec" => {
            let bytes = batches::td_person_batch().to_bytes()?;
            Ok(run_loop(deadline, || {
                bench_corpus::generated_batches::PersonBatch::from_bytes(&bytes)
            }))
        }
        "tiny-enc" => {
            let value = corpus::td_with_address();
            let sparse = corpus::td_without_address();
            Ok(run_loop(deadline, || {
                (value.to_packed_framed_bytes(None), sparse.to_bytes())
            }))
        }
        "prost-event" => {
            let value = events::pb_event_batch();
            let bytes = value.encode_to_vec();
            Ok(run_loop(deadline, || {
                bench_corpus::events::pb::BenchEventBatch::decode(bytes.as_slice())
            }))
        }
        "prost-rest" => {
            let person = batches::pb_person_batch();
            let contact = batches::pb_contact_batch();
            let document = documents::pb_document();
            let metric = corpus::pb_metric_batch();
            let tiny = (corpus::pb_with_address(), corpus::pb_without_address());
            Ok(run_loop(deadline, || {
                (
                    person.encode_to_vec().len(),
                    contact.encode_to_vec().len(),
                    document.encode_to_vec().len(),
                    metric.encode_to_vec().len(),
                    tiny.0.encoded_len(),
                    tiny.1.encoded_len(),
                )
            }))
        }
        other => Err(format!("unknown profile op '{other}'").into()),
    }
}

/// Parse arguments and loop the requested operation.
fn main() -> Result<(), BoxError> {
    let mut args = std::env::args().skip(1);
    let op = args.next().ok_or("usage: profile <op> <seconds>")?;
    let seconds = args
        .next()
        .ok_or("usage: profile <op> <seconds>")?
        .parse::<u64>()?;
    let deadline = Instant::now()
        .checked_add(Duration::from_secs(seconds))
        .ok_or("deadline overflow")?;
    let iterations = dispatch(&op, deadline)?;
    println!("{op}: {iterations} iterations");
    Ok(())
}
