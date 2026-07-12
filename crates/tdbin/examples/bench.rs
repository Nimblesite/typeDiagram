//! [TDBIN-BENCH-GATE] Honest speed benchmark: TDBIN vs Protobuf (`prost`).
//!
//! For every fixture this times bare, framed, and packed-framed TDBIN paths
//! against Protobuf, reporting the per-operation `Duration` alongside all
//! encoded sizes. Every timed value is wrapped in `std::hint::black_box`; per-op
//! duration is `elapsed.checked_div(iters)` (never raw `/`), and "faster" is a
//! `Duration` comparison — no fabricated or derived numbers.
//!
//! Run with: `cargo run -p tdbin --release --example bench`.

/// Shared TDBIN and Protobuf corpus values.
#[path = "../tests/support/bench_corpus.rs"]
mod bench_corpus;

use bench_corpus::{batches, corpus, documents, events};

use prost::Message;
use std::cmp::Ordering;
use std::hint::black_box;
use std::time::{Duration, Instant};
use tdbin::{Struct, TdBin};

/// Boxed-error alias so operations compose with `?`.
type BoxErr = Box<dyn std::error::Error>;

/// Timed iterations per operation.
const ITERS: u32 = 20_000;
/// Untimed warm-up iterations run before each measurement.
const WARMUP: u32 = 1_000;

/// Time `ITERS` invocations of `op` (after `WARMUP` warm-up runs) and return the
/// per-operation `Duration`. Each result flows through `black_box` so the
/// optimizer cannot elide the work.
fn time_per_op<T>(mut op: impl FnMut() -> Result<T, BoxErr>) -> Result<Duration, BoxErr> {
    for _ in 0..WARMUP {
        let _ = black_box(op()?);
    }
    let start = Instant::now();
    for _ in 0..ITERS {
        let _ = black_box(op()?);
    }
    start
        .elapsed()
        .checked_div(ITERS)
        .ok_or_else(|| "iteration count was zero".to_owned().into())
}

/// Encode `td` to TDBIN bytes (one benchmark op).
fn enc_td<T: TdBin>(td: &T) -> Result<Vec<u8>, BoxErr> {
    black_box(td).to_bytes().map_err(Into::into)
}

/// Encode `td` to a production unpacked frame.
fn enc_td_framed<T: TdBin>(td: &T) -> Result<Vec<u8>, BoxErr> {
    black_box(td).to_framed_bytes(None).map_err(Into::into)
}

/// Encode `td` to a production packed frame.
fn enc_td_packed<T: TdBin>(td: &T) -> Result<Vec<u8>, BoxErr> {
    black_box(td)
        .to_packed_framed_bytes(None)
        .map_err(Into::into)
}

/// Encode `pb` to Protobuf bytes into a right-sized buffer (one benchmark op).
fn enc_pb<P: Message>(pb: &P) -> Result<Vec<u8>, BoxErr> {
    let mut buf = Vec::with_capacity(pb.encoded_len());
    black_box(pb).encode(&mut buf)?;
    Ok(buf)
}

/// Report which codec is faster for one operation.
fn verdict(td: Duration, pb: Duration) -> &'static str {
    match td.cmp(&pb) {
        Ordering::Less => "TDBIN faster",
        Ordering::Greater => "prost faster",
        Ordering::Equal => "tie",
    }
}

/// Print one comparison row: operation, TDBIN per-op, prost per-op, verdict.
fn row(op: &str, td: Duration, pb: Duration) {
    println!(
        "  {op:<7} TDBIN {td:>12?}   prost {pb:>12?}   -> {}",
        verdict(td, pb)
    );
}

/// Time and print every production mode for a single fixture.
fn bench_fixture<T, P>(label: &str, td: &T, pb: &P) -> Result<(), BoxErr>
where
    T: Struct + TdBin,
    P: Message + Default,
{
    let bare = td.to_bytes()?;
    let framed = td.to_framed_bytes(None)?;
    let packed = td.to_packed_framed_bytes(None)?;
    let pb_bytes = enc_pb(pb)?;
    println!(
        "[{label}] sizes: tdbin_bare={} tdbin_framed={} tdbin_packed_framed={} protobuf={}",
        bare.len(),
        framed.len(),
        packed.len(),
        pb_bytes.len()
    );
    row(
        "bare enc",
        time_per_op(|| enc_td(td))?,
        time_per_op(|| enc_pb(pb))?,
    );
    row(
        "bare dec",
        time_per_op(|| T::from_bytes(black_box(bare.as_slice())).map_err(Into::into))?,
        time_per_op(|| P::decode(black_box(pb_bytes.as_slice())).map_err(Into::into))?,
    );
    row(
        "frame enc",
        time_per_op(|| enc_td_framed(td))?,
        time_per_op(|| enc_pb(pb))?,
    );
    row(
        "frame dec",
        time_per_op(|| T::from_framed_bytes(black_box(framed.as_slice())).map_err(Into::into))?,
        time_per_op(|| P::decode(black_box(pb_bytes.as_slice())).map_err(Into::into))?,
    );
    row(
        "pack enc",
        time_per_op(|| enc_td_packed(td))?,
        time_per_op(|| enc_pb(pb))?,
    );
    row(
        "pack dec",
        time_per_op(|| T::from_framed_bytes(black_box(packed.as_slice())).map_err(Into::into))?,
        time_per_op(|| P::decode(black_box(pb_bytes.as_slice())).map_err(Into::into))?,
    );
    Ok(())
}

/// Run the TDBIN-vs-Protobuf benchmark over both corpus fixtures.
fn main() -> Result<(), BoxErr> {
    println!("TDBIN vs Protobuf (prost) — {ITERS} timed iters/op, release build");
    println!("per-op duration (lower is faster); each row is a complete codec operation");
    bench_fixture(
        "with_address",
        &corpus::td_with_address(),
        &corpus::pb_with_address(),
    )?;
    bench_fixture(
        "without_address",
        &corpus::td_without_address(),
        &corpus::pb_without_address(),
    )?;
    bench_fixture(
        "metric_batch",
        &corpus::td_metric_batch(),
        &corpus::pb_metric_batch(),
    )?;
    bench_fixture(
        "person_batch",
        &batches::td_person_batch(),
        &batches::pb_person_batch(),
    )?;
    bench_fixture(
        "contact_batch",
        &batches::td_contact_batch(),
        &batches::pb_contact_batch(),
    )?;
    bench_fixture(
        "diagram_document",
        &documents::td_document(),
        &documents::pb_document(),
    )?;
    bench_fixture(
        "event_batch",
        &events::td_event_batch(),
        &events::pb_event_batch(),
    )?;
    Ok(())
}
