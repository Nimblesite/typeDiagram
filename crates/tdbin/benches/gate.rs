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

use bench_corpus::{batches, corpus, documents, events};
use criterion::{criterion_group, criterion_main, BenchmarkId, Criterion};
use prost::Message;
use serde::de::DeserializeOwned;
use serde::Serialize;
use tdbin::{Struct, TdBin};

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

/// Return a framed TDBIN message or terminate the benchmark process.
fn td_framed_bytes<T: Struct>(value: &T, packed: bool) -> Vec<u8> {
    let encoded = if packed {
        value.to_packed_framed_bytes(None)
    } else {
        value.to_framed_bytes(None)
    };
    match encoded {
        Ok(bytes) => bytes,
        Err(error) => {
            eprintln!("tdbin framed encode failed before benchmark: {error:?}");
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

/// Return a self-describing `MessagePack` (struct-as-map) message, or terminate.
fn mp_bytes<P: Serialize>(value: &P) -> Vec<u8> {
    match rmp_serde::to_vec_named(value) {
        Ok(bytes) => bytes,
        Err(error) => {
            eprintln!("msgpack encode failed before benchmark: {error:?}");
            std::process::exit(1);
        }
    }
}

/// Benchmark all encode/decode operations for one paired corpus fixture.
fn bench_fixture<T, P>(c: &mut Criterion, label: &str, td: &T, pb: &P)
where
    T: Struct + TdBin,
    P: Message + Default + Serialize + DeserializeOwned,
{
    let bare = td_bytes(td);
    let framed = td_framed_bytes(td, false);
    let packed_framed = td_framed_bytes(td, true);
    let protobuf = pb_bytes(pb);
    let msgpack = mp_bytes(pb);
    println!(
        "[{label}] sizes: tdbin_bare={} tdbin_framed={} tdbin_packed_framed={} protobuf={} msgpack={}",
        bare.len(),
        framed.len(),
        packed_framed.len(),
        protobuf.len(),
        msgpack.len()
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
        BenchmarkId::new("tdbin_encode_framed", label),
        td,
        |b, value| {
            b.iter(|| black_box(value).to_framed_bytes(None));
        },
    );
    let _ = group.bench_with_input(
        BenchmarkId::new("tdbin_encode_packed_framed", label),
        td,
        |b, value| {
            b.iter(|| black_box(value).to_packed_framed_bytes(None));
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
    let _ = group.bench_with_input(BenchmarkId::new("msgpack_encode", label), pb, |b, value| {
        b.iter(|| rmp_serde::to_vec_named(black_box(value)));
    });
    let _ = group.bench_with_input(
        BenchmarkId::new("tdbin_decode_bare", label),
        &bare,
        |b, bytes| {
            b.iter(|| T::from_bytes(black_box(bytes.as_slice())));
        },
    );
    let _ = group.bench_with_input(
        BenchmarkId::new("tdbin_decode_framed", label),
        &framed,
        |b, bytes| {
            b.iter(|| T::from_framed_bytes(black_box(bytes.as_slice())));
        },
    );
    let _ = group.bench_with_input(
        BenchmarkId::new("tdbin_decode_packed_framed", label),
        &packed_framed,
        |b, bytes| {
            b.iter(|| T::from_framed_bytes(black_box(bytes.as_slice())));
        },
    );
    let _ = group.bench_with_input(
        BenchmarkId::new("protobuf_decode", label),
        &protobuf,
        |b, bytes| {
            b.iter(|| P::decode(black_box(bytes.as_slice())));
        },
    );
    let _ = group.bench_with_input(
        BenchmarkId::new("msgpack_decode", label),
        &msgpack,
        |b, bytes| {
            b.iter(|| rmp_serde::from_slice::<P>(black_box(bytes.as_slice())));
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
    bench_fixture(
        c,
        "person_batch",
        &batches::td_person_batch(),
        &batches::pb_person_batch(),
    );
    bench_fixture(
        c,
        "contact_batch",
        &batches::td_contact_batch(),
        &batches::pb_contact_batch(),
    );
    bench_fixture(
        c,
        "diagram_document",
        &documents::td_document(),
        &documents::pb_document(),
    );
    bench_fixture(
        c,
        "event_batch",
        &events::td_event_batch(),
        &events::pb_event_batch(),
    );
}

criterion_group! {
    name = benches;
    config = Criterion::default()
        .sample_size(50)
        .measurement_time(Duration::from_secs(5));
    targets = criterion_benchmark
}
criterion_main!(benches);
