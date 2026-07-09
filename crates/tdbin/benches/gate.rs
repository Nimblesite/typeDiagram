//! [TDBIN-BENCH-GATE] Criterion benchmark gate: TDBIN vs Protobuf (`prost`).
//!
//! The size gate in `tests/size_gate.rs` pins deterministic byte counts. This
//! benchmark uses the same corpus values for statistical encode/decode timing,
//! so the benchmark report compares exactly the bytes the size gate records.

/// Shared TDBIN and Protobuf corpus values.
#[path = "../tests/support/bench_corpus.rs"]
mod bench_corpus;

use std::hint::black_box;
use std::time::Duration;

use bench_corpus::corpus;
use criterion::{criterion_group, criterion_main, BenchmarkId, Criterion};
use prost::Message;
use tdbin::{pack, Struct, TdBin};

/// Return a TDBIN encoded message or terminate the benchmark process.
fn td_bytes<T: Struct>(value: &T) -> Vec<u8> {
    match value.to_bytes() {
        Ok(bytes) => bytes,
        Err(error) => {
            eprintln!("tdbin encode failed before benchmark: {error:?}");
            std::process::exit(1);
        }
    }
}

/// Return a packed TDBIN body or terminate the benchmark process.
fn packed_bytes(body: &[u8]) -> Vec<u8> {
    match pack::encode(body) {
        Ok(bytes) => bytes,
        Err(error) => {
            eprintln!("tdbin pack failed before benchmark: {error:?}");
            std::process::exit(1);
        }
    }
}

/// Return a Protobuf encoded message or terminate the benchmark process.
fn pb_bytes<P: Message>(value: &P) -> Vec<u8> {
    let mut out = Vec::with_capacity(value.encoded_len());
    match value.encode(&mut out) {
        Ok(()) => out,
        Err(error) => {
            eprintln!("protobuf encode failed before benchmark: {error:?}");
            std::process::exit(1);
        }
    }
}

/// Benchmark all encode/decode operations for one paired corpus fixture.
fn bench_fixture<T, P>(c: &mut Criterion, label: &str, td: &T, pb: &P)
where
    T: Struct + TdBin,
    P: Message + Default,
{
    let bare = td_bytes(td);
    let packed = packed_bytes(&bare);
    let protobuf = pb_bytes(pb);
    println!(
        "[{label}] sizes: tdbin_bare={} tdbin_packed={} protobuf={}",
        bare.len(),
        packed.len(),
        protobuf.len()
    );

    let mut group = c.benchmark_group(format!("tdbin_vs_protobuf/{label}"));
    let _ = group.bench_with_input(
        BenchmarkId::new("tdbin_encode_bare", label),
        td,
        |b, value| {
            b.iter(|| black_box(value).to_bytes());
        },
    );
    let _ = group.bench_with_input(
        BenchmarkId::new("protobuf_encode", label),
        pb,
        |b, value| {
            b.iter(|| {
                let mut out = Vec::with_capacity(black_box(value).encoded_len());
                black_box(value).encode(&mut out).map(|()| out)
            });
        },
    );
    let _ = group.bench_with_input(
        BenchmarkId::new("tdbin_decode_bare", label),
        &bare,
        |b, bytes| {
            b.iter(|| T::from_bytes(black_box(bytes.as_slice())));
        },
    );
    let _ = group.bench_with_input(
        BenchmarkId::new("tdbin_decode_packed_framed_body", label),
        &packed,
        |b, bytes| {
            b.iter(|| {
                pack::decode(black_box(bytes.as_slice()))
                    .and_then(|body| T::from_bytes(black_box(body.as_slice())))
            });
        },
    );
    let _ = group.bench_with_input(
        BenchmarkId::new("protobuf_decode", label),
        &protobuf,
        |b, bytes| {
            b.iter(|| P::decode(black_box(bytes.as_slice())));
        },
    );
    group.finish();
}

/// Criterion entry point for the TDBIN-vs-Protobuf benchmark suite.
fn criterion_benchmark(c: &mut Criterion) {
    bench_fixture(
        c,
        "with_address",
        &corpus::td_with_address(),
        &corpus::pb_with_address(),
    );
    bench_fixture(
        c,
        "without_address",
        &corpus::td_without_address(),
        &corpus::pb_without_address(),
    );
    bench_fixture(
        c,
        "metric_batch",
        &corpus::td_metric_batch(),
        &corpus::pb_metric_batch(),
    );
}

criterion_group! {
    name = benches;
    config = Criterion::default()
        .sample_size(20)
        .measurement_time(Duration::from_secs(3));
    targets = criterion_benchmark
}
criterion_main!(benches);
