//! [TDBIN-BENCH-CORPUS] Honest, deterministic size gate comparing the TDBIN
//! binary codec against Protobuf (`prost`) on a fixed corpus.
//!
//! For each of the two round-trip fixtures this pins the EXACT encoded byte
//! count for three encodings — TDBIN bare (`to_bytes`), TDBIN packed
//! (`pack::encode(to_bytes)`), and Protobuf (`encoded_len`) — and proves the
//! packed round-trip is lossless. Numbers are measured, never rounded or
//! rigged: TDBIN v0 bare is word-aligned and expected to be LARGER than
//! Protobuf; packed is the fair "smaller?" comparison.
//!
//! The `corpus` module below is the single source of truth for the benchmark
//! values and is re-used verbatim by `examples/bench.rs` (via `#[path]`), so
//! the size gate and the speed bench measure the identical two values.

#[path = "support/bench_corpus.rs"]
pub mod bench_corpus;

pub use bench_corpus::{corpus, generated};

#[cfg(test)]
mod size_gate {
    use super::corpus;
    use super::corpus::BenchMetricBatch;
    use super::generated::Person;
    use prost::Message;
    use tdbin::{pack, TdBin};

    /// Boxed-error alias so the gate uses `?` without `unwrap`/`expect`.
    type TestResult = Result<(), Box<dyn std::error::Error>>;

    /// [TDBIN-BENCH-CORPUS] Pin the EXACT encoded byte counts (TDBIN bare, TDBIN
    /// packed, Protobuf) for both fixtures and prove the packed round-trip is
    /// lossless. Each row also prints the measured sizes under `--nocapture`.
    #[test]
    fn tdbin_and_protobuf_encoded_sizes() -> TestResult {
        // (label, tdbin fixture, protobuf fixture, bare bytes, packed bytes, protobuf bytes)
        let cases = [
            (
                "with_address",
                corpus::td_with_address(),
                corpus::pb_with_address(),
                160usize,
                97usize,
                79usize,
            ),
            (
                "without_address",
                corpus::td_without_address(),
                corpus::pb_without_address(),
                112usize,
                42usize,
                31usize,
            ),
        ];
        for (label, td, pb, bare_len, packed_len, pb_len) in &cases {
            let bare = td.to_bytes()?;
            let packed = pack::encode(&bare)?;
            let restored = Person::from_bytes(&pack::decode(&packed)?)?;
            assert_eq!(
                &restored, td,
                "{label}: TDBIN packed round-trip must be lossless"
            );
            assert_eq!(bare.len(), *bare_len, "{label}: TDBIN bare size");
            assert_eq!(packed.len(), *packed_len, "{label}: TDBIN packed size");
            assert_eq!(pb.encoded_len(), *pb_len, "{label}: Protobuf size");
            println!(
                "[{label}] tdbin_bare={} tdbin_packed={} protobuf={}",
                bare.len(),
                packed.len(),
                pb.encoded_len()
            );
        }
        Ok(())
    }

    /// [TDBIN-BENCH-GATE] The list-heavy metric batch is the realistic corpus
    /// entry where TDBIN's raw-word and bit-list layouts must beat Protobuf size.
    #[test]
    fn metric_batch_is_smaller_than_protobuf() -> TestResult {
        let td = corpus::td_metric_batch();
        let pb = corpus::pb_metric_batch();
        let bare = td.to_bytes()?;
        let packed = pack::encode(&bare)?;
        let restored = BenchMetricBatch::from_bytes(&pack::decode(&packed)?)?;
        assert_eq!(restored, td, "metric_batch: packed round-trip");
        assert!(
            packed.len() < pb.encoded_len(),
            "metric_batch: packed TDBIN {} must be smaller than Protobuf {}",
            packed.len(),
            pb.encoded_len()
        );
        println!(
            "[metric_batch] tdbin_bare={} tdbin_packed={} protobuf={}",
            bare.len(),
            packed.len(),
            pb.encoded_len()
        );
        Ok(())
    }
}
