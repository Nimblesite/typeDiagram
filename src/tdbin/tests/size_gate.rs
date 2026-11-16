//! [TDBIN-BENCH-CORPUS] Honest, deterministic size gate comparing the TDBIN
//! binary codec against Protobuf (`prost`) on a fixed corpus.
//!
//! For each of the two round-trip fixtures this pins the EXACT encoded byte
//! count for TDBIN bare, framed, packed framed, and Protobuf, and proves the
//! packed framed round-trip is lossless. Numbers are measured, never rounded or
//! rigged: TDBIN v0 bare is word-aligned and expected to be LARGER than
//! Protobuf; packed is the fair "smaller?" comparison.
//!
//! The `corpus` module below is the single source of truth for the benchmark
//! values and is re-used verbatim by `examples/bench.rs` (via `#[path]`), so
//! the size gate and the speed bench measure the identical two values.

#[path = "support/bench_corpus.rs"]
pub mod bench_corpus;

pub use bench_corpus::corpus;

#[cfg(test)]
mod size_gate {
    use super::bench_corpus::batches;
    use super::bench_corpus::generated_batches::Person;
    use super::bench_corpus::{documents, events};
    use super::corpus;
    use super::corpus::BenchMetricBatch;
    use prost::Message;
    use tdbin::{Struct, TdBin};

    /// Boxed-error alias so the gate uses `?` without `unwrap`/`expect`.
    type TestResult = Result<(), Box<dyn std::error::Error>>;

    /// Pin one expanded-corpus row, prove packed framed round-trip identity,
    /// and assert the columnar packed frame beats Protobuf ([TDBIN-BENCH-GATE]).
    fn assert_batch_sizes<T, P>(td: &T, pb: &P, expected: [usize; 4]) -> TestResult
    where
        T: Struct + TdBin + PartialEq + std::fmt::Debug,
        P: Message,
    {
        let bare = td.to_bytes()?;
        let framed = td.to_framed_bytes(None)?;
        let packed = td.to_packed_framed_bytes(None)?;
        assert_eq!(T::from_framed_bytes(&packed)?, *td);
        assert_eq!(
            [bare.len(), framed.len(), packed.len(), pb.encoded_len()],
            expected
        );
        assert!(
            packed.len() < pb.encoded_len(),
            "packed framed TDBIN {} must be smaller than Protobuf {}",
            packed.len(),
            pb.encoded_len()
        );
        Ok(())
    }

    /// [TDBIN-BENCH-CORPUS] Pin the EXACT encoded byte counts (TDBIN bare, TDBIN
    /// packed, Protobuf) for both fixtures and prove the packed round-trip is
    /// lossless. Each row also prints the measured sizes under `--nocapture`.
    #[test]
    fn tdbin_and_protobuf_encoded_sizes() -> TestResult {
        // (label, fixture pair, bare, framed, packed framed, protobuf bytes)
        let cases = [
            (
                "with_address",
                corpus::td_with_address(),
                corpus::pb_with_address(),
                160usize,
                172usize,
                109usize,
                79usize,
            ),
            (
                "without_address",
                corpus::td_without_address(),
                corpus::pb_without_address(),
                112usize,
                124usize,
                54usize,
                31usize,
            ),
        ];
        for (label, td, pb, bare_len, framed_len, packed_len, pb_len) in &cases {
            let bare = td.to_bytes()?;
            let framed = td.to_framed_bytes(None)?;
            let packed = td.to_packed_framed_bytes(None)?;
            let restored = Person::from_framed_bytes(&packed)?;
            assert_eq!(
                &restored, td,
                "{label}: TDBIN packed round-trip must be lossless"
            );
            assert_eq!(bare.len(), *bare_len, "{label}: TDBIN bare size");
            assert_eq!(framed.len(), *framed_len, "{label}: TDBIN framed size");
            assert_eq!(
                packed.len(),
                *packed_len,
                "{label}: TDBIN packed framed size"
            );
            assert_eq!(pb.encoded_len(), *pb_len, "{label}: Protobuf size");
            println!(
                "[{label}] tdbin_bare={} tdbin_framed={} tdbin_packed_framed={} protobuf={}",
                bare.len(),
                framed.len(),
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
        let framed = td.to_framed_bytes(None)?;
        let packed = td.to_packed_framed_bytes(None)?;
        let restored = BenchMetricBatch::from_framed_bytes(&packed)?;
        assert_eq!(restored, td, "metric_batch: packed framed round-trip");
        assert_eq!(bare.len(), 43_776, "metric_batch: bare regression guard");
        assert_eq!(
            framed.len(),
            43_788,
            "metric_batch: framed regression guard"
        );
        assert_eq!(
            packed.len(),
            23_045,
            "metric_batch: packed framed regression guard"
        );
        assert_eq!(
            pb.encoded_len(),
            84_149,
            "metric_batch: protobuf fixture guard"
        );
        assert!(
            packed.len() < pb.encoded_len(),
            "metric_batch: packed framed TDBIN {} must be smaller than Protobuf {}",
            packed.len(),
            pb.encoded_len()
        );
        println!(
            "[metric_batch] tdbin_bare={} tdbin_framed={} tdbin_packed_framed={} protobuf={}",
            bare.len(),
            framed.len(),
            packed.len(),
            pb.encoded_len()
        );
        Ok(())
    }

    /// [TDBIN-BENCH-GATE] Pin the record- and union-heavy rows. Under columnar
    /// layout 2 every packed frame must be smaller than its Protobuf mirror.
    #[test]
    fn expanded_corpus_size_regressions() -> TestResult {
        assert_batch_sizes(
            &batches::td_person_batch(),
            &batches::pb_person_batch(),
            [22_976, 22_988, 20_071, 29_184],
        )?;
        assert_batch_sizes(
            &batches::td_contact_batch(),
            &batches::pb_contact_batch(),
            [23_144, 23_156, 22_317, 35_221],
        )?;
        assert_batch_sizes(
            &documents::td_document(),
            &documents::pb_document(),
            [45_160, 45_172, 37_868, 50_788],
        )?;
        assert_batch_sizes(
            &events::td_event_batch(),
            &events::pb_event_batch(),
            [116_360, 116_372, 102_861, 131_744],
        )
    }
}
