# TDBIN Benchmark Report

> GENERATED FILE. Source: `scripts/tdbin-bench-report.mjs` and `docs/reports/tdbin-bench-data.json`.
> Every value and verdict is computed from machine-readable Criterion and encoder output. No benchmark result is entered manually.

Generated: 2026-07-11T15:07:08.285Z

Raw data SHA-256: `052fbaa3e7fd70eadcd3216b89d3f37a3828d933b1d44de79d18798b16e040fa`

## Result

**Specification gate ([TDBIN-BENCH-CORPUS] committed workloads): FAIL.** 2 of 3 corpus fixtures have a production wire mode that is simultaneously smaller than Protobuf AND at least 1.50x faster on both encode and decode. Stress rows: 2 of 4 pass the same bar.

Qualifying modes: `with_address` = none, `without_address` = none, `metric_batch` = framed, `person_batch` = framed, `contact_batch` = framed & packed framed, `diagram_document` = framed, `event_batch` = none.

The release gate ([TDBIN-BENCH-GATE]) requires, for every corpus entry — the committed realistic schemas in `docs/benchmarks/tdbin-corpus.{td,proto}` (record-heavy document, union-heavy event stream, list-heavy dataset) — that at least one self-describing production wire mode (framed, or packed framed; the frame's PACKED flag makes the two interchangeable to every decoder) beats Protobuf on size and by 1.50x on both encode and decode simultaneously. Both modes are always measured and published below. Stress rows (marked) are reported against the identical bar; the tiny single-message rows carry a fixed 12-byte frame plus pointer-per-string overhead that no fixed-layout format recovers at sub-100-byte payloads (research §2.2), so they are not corpus entries.

## Environment

| Field        | Value                               |
| ------------ | ----------------------------------- |
| Platform     | darwin 25.5.0 (arm64)               |
| CPU          | Apple M4 Max                        |
| Logical CPUs | 14                                  |
| Memory       | 36.0 GiB                            |
| Rust         | rustc 1.96.0 (ac68faa20 2026-05-25) |
| Cargo        | cargo 1.96.0 (30a34c682 2026-05-25) |

Dependency tree:

```text
tdbin v0.0.0 (/Users/christianfindlay/Documents/Code/typeDiagram/crates/tdbin)
[dev-dependencies]
├── criterion v0.8.2
└── prost v0.14.3
```

## Encoded Size

All sizes are bytes. Percentage columns are relative to Protobuf; negative is smaller.

| Fixture            | Shape                         | Role   | Items | TDBIN bare | TDBIN framed | TDBIN packed framed | Protobuf | Framed delta | Packed delta |
| ------------------ | ----------------------------- | ------ | ----: | ---------: | -----------: | ------------------: | -------: | -----------: | -----------: |
| `with_address`     | tiny nested record and union  | stress |     1 |        160 |          172 |                 109 |       79 |       117.7% |        38.0% |
| `without_address`  | tiny sparse record and union  | stress |     1 |        112 |          124 |                  54 |       31 |       300.0% |        74.2% |
| `metric_batch`     | list-heavy telemetry          | corpus | 4,096 |     43,776 |       43,788 |              23,045 |   84,149 |       -48.0% |       -72.6% |
| `person_batch`     | repeated records              | stress |   512 |     22,976 |       22,988 |              20,071 |   29,184 |       -21.2% |       -31.2% |
| `contact_batch`    | repeated unions               | stress | 2,048 |     23,144 |       23,156 |              22,317 |   35,221 |       -34.3% |       -36.6% |
| `diagram_document` | record-heavy diagram document | corpus |   768 |     45,160 |       45,172 |              37,868 |   50,788 |       -11.1% |       -25.4% |
| `event_batch`      | union-heavy event stream      | corpus | 2,048 |    116,360 |      116,372 |             102,861 |  131,744 |       -11.7% |       -21.9% |

## Criterion Medians

| Fixture            | Operation                    | Samples | Sampled time |     Median |   CI lower |   CI upper |
| ------------------ | ---------------------------- | ------: | -----------: | ---------: | ---------: | ---------: |
| `with_address`     | `tdbin_encode_bare`          |      50 |  5010.966 ms |   83.10 ns |   82.76 ns |   83.38 ns |
| `with_address`     | `tdbin_encode_framed`        |      50 |  6167.315 ms |  109.36 ns |  101.10 ns |  111.63 ns |
| `with_address`     | `tdbin_encode_packed_framed` |      50 |  4688.623 ms |  198.64 ns |  196.80 ns |  207.64 ns |
| `with_address`     | `protobuf_encode`            |      50 |  4853.818 ms |   69.41 ns |   64.09 ns |   73.29 ns |
| `with_address`     | `tdbin_decode_bare`          |      50 |  5247.388 ms |  154.30 ns |  151.28 ns |  157.10 ns |
| `with_address`     | `tdbin_decode_framed`        |      50 |  7711.428 ms |  939.85 ns |  908.54 ns |  966.47 ns |
| `with_address`     | `tdbin_decode_packed_framed` |      50 |  5589.698 ms |   3.606 us |   3.548 us |   3.653 us |
| `with_address`     | `protobuf_decode`            |      50 |  5038.537 ms |  921.27 ns |  913.13 ns |  939.44 ns |
| `without_address`  | `tdbin_encode_bare`          |      50 |  4902.567 ms |  338.24 ns |  335.95 ns |  341.98 ns |
| `without_address`  | `tdbin_encode_framed`        |      50 |  5493.679 ms |  400.06 ns |  396.70 ns |  402.96 ns |
| `without_address`  | `tdbin_encode_packed_framed` |      50 |  2607.578 ms |  764.94 ns |  754.53 ns |  777.86 ns |
| `without_address`  | `protobuf_encode`            |      50 |  5172.749 ms |   35.64 ns |   35.35 ns |   36.04 ns |
| `without_address`  | `tdbin_decode_bare`          |      50 |  5770.456 ms |   73.64 ns |   73.29 ns |   74.39 ns |
| `without_address`  | `tdbin_decode_framed`        |      50 |  5716.750 ms |   76.63 ns |   76.28 ns |   76.97 ns |
| `without_address`  | `tdbin_decode_packed_framed` |      50 |  5451.651 ms |  542.18 ns |  537.79 ns |  545.67 ns |
| `without_address`  | `protobuf_decode`            |      50 |  5653.604 ms |   53.27 ns |   52.77 ns |   54.62 ns |
| `metric_batch`     | `tdbin_encode_bare`          |      50 |  3765.785 ms |  12.305 us |  12.034 us |  12.987 us |
| `metric_batch`     | `tdbin_encode_framed`        |      50 |  4256.508 ms |  14.974 us |  14.363 us |  15.266 us |
| `metric_batch`     | `tdbin_encode_packed_framed` |      50 |  4639.951 ms |  27.741 us |  24.611 us |  29.641 us |
| `metric_batch`     | `protobuf_encode`            |      50 |  5412.159 ms |  50.696 us |  45.813 us |  56.103 us |
| `metric_batch`     | `tdbin_decode_bare`          |      50 |  3110.157 ms |   7.712 us |   7.535 us |   7.846 us |
| `metric_batch`     | `tdbin_decode_framed`        |      50 |  4824.275 ms |   7.951 us |   7.798 us |   8.154 us |
| `metric_batch`     | `tdbin_decode_packed_framed` |      50 |  5710.549 ms |  37.963 us |  37.783 us |  38.311 us |
| `metric_batch`     | `protobuf_decode`            |      50 |  4988.323 ms |  35.867 us |  35.316 us |  36.267 us |
| `person_batch`     | `tdbin_encode_bare`          |      50 |  5002.386 ms |  11.811 us |  11.728 us |  11.857 us |
| `person_batch`     | `tdbin_encode_framed`        |      50 |  4998.343 ms |  11.858 us |  11.794 us |  11.876 us |
| `person_batch`     | `tdbin_encode_packed_framed` |      50 |  5124.613 ms |  15.541 us |  15.265 us |  15.892 us |
| `person_batch`     | `protobuf_encode`            |      50 |  5069.843 ms |  18.247 us |  18.086 us |  18.350 us |
| `person_batch`     | `tdbin_decode_bare`          |      50 |  5009.308 ms |  36.734 us |  36.447 us |  37.009 us |
| `person_batch`     | `tdbin_decode_framed`        |      50 |  4937.394 ms |  37.818 us |  37.126 us |  38.523 us |
| `person_batch`     | `tdbin_decode_packed_framed` |      50 |  5122.981 ms |  41.743 us |  41.256 us |  42.369 us |
| `person_batch`     | `protobuf_decode`            |      50 |  5044.089 ms |  57.691 us |  57.264 us |  58.092 us |
| `contact_batch`    | `tdbin_encode_bare`          |      50 |  5017.695 ms |   9.627 us |   9.605 us |   9.661 us |
| `contact_batch`    | `tdbin_encode_framed`        |      50 |  5011.655 ms |   9.653 us |   9.611 us |   9.720 us |
| `contact_batch`    | `tdbin_encode_packed_framed` |      50 |  5076.228 ms |  12.925 us |  12.866 us |  13.029 us |
| `contact_batch`    | `protobuf_encode`            |      50 |  5413.163 ms |  28.365 us |  28.009 us |  28.741 us |
| `contact_batch`    | `tdbin_decode_bare`          |      50 |  5239.417 ms |  36.764 us |  36.436 us |  38.005 us |
| `contact_batch`    | `tdbin_decode_framed`        |      50 |  4709.271 ms |  43.522 us |  42.991 us |  45.359 us |
| `contact_batch`    | `tdbin_decode_packed_framed` |      50 |  4278.261 ms |  40.590 us |  38.988 us |  41.946 us |
| `contact_batch`    | `protobuf_decode`            |      50 |  4708.885 ms |  72.148 us |  69.176 us |  74.153 us |
| `diagram_document` | `tdbin_encode_bare`          |      50 |  3973.094 ms |  16.468 us |  15.268 us |  17.475 us |
| `diagram_document` | `tdbin_encode_framed`        |      50 |  5476.900 ms |  13.958 us |  13.514 us |  15.377 us |
| `diagram_document` | `tdbin_encode_packed_framed` |      50 |  5682.131 ms |  24.274 us |  23.245 us |  24.469 us |
| `diagram_document` | `protobuf_encode`            |      50 |  2832.265 ms |  23.293 us |  21.949 us |  24.438 us |
| `diagram_document` | `tdbin_decode_bare`          |      50 |  5183.135 ms |  74.798 us |  74.476 us |  75.054 us |
| `diagram_document` | `tdbin_decode_framed`        |      50 |  5024.830 ms |  75.939 us |  75.539 us |  76.334 us |
| `diagram_document` | `tdbin_decode_packed_framed` |      50 |  5079.076 ms |  84.772 us |  84.152 us |  85.929 us |
| `diagram_document` | `protobuf_decode`            |      50 |  5248.375 ms | 120.168 us | 119.516 us | 120.872 us |
| `event_batch`      | `tdbin_encode_bare`          |      50 |  5159.726 ms |  40.854 us |  40.522 us |  41.924 us |
| `event_batch`      | `tdbin_encode_framed`        |      50 |  5226.987 ms |  39.914 us |  39.643 us |  40.060 us |
| `event_batch`      | `tdbin_encode_packed_framed` |      50 |  5066.257 ms |  55.971 us |  55.782 us |  56.181 us |
| `event_batch`      | `protobuf_encode`            |      50 |  5017.194 ms |  79.864 us |  78.119 us |  81.756 us |
| `event_batch`      | `tdbin_decode_bare`          |      50 |  5454.117 ms | 202.750 us | 201.498 us | 203.394 us |
| `event_batch`      | `tdbin_decode_framed`        |      50 |  5581.534 ms | 205.237 us | 200.798 us | 206.522 us |
| `event_batch`      | `tdbin_decode_packed_framed` |      50 |  5164.226 ms | 227.075 us | 224.507 us | 229.686 us |
| `event_batch`      | `protobuf_decode`            |      50 |  5401.236 ms | 303.784 us | 297.644 us | 308.791 us |

## Same-Mode Comparison

Ratios are Protobuf median / TDBIN median; values above 1.00x favor TDBIN. The gate requires size no larger than Protobuf and both encode and decode ratios at least 1.50x.

| Fixture            | TDBIN mode    | Size winner | Encode ratio | Decode ratio | Gate |
| ------------------ | ------------- | ----------- | -----------: | -----------: | ---- |
| `with_address`     | bare          | Protobuf    |        0.84x |        5.97x | FAIL |
| `with_address`     | framed        | Protobuf    |        0.63x |        0.98x | FAIL |
| `with_address`     | packed framed | Protobuf    |        0.35x |        0.26x | FAIL |
| `without_address`  | bare          | Protobuf    |        0.11x |        0.72x | FAIL |
| `without_address`  | framed        | Protobuf    |        0.09x |        0.70x | FAIL |
| `without_address`  | packed framed | Protobuf    |        0.05x |        0.10x | FAIL |
| `metric_batch`     | bare          | TDBIN       |        4.12x |        4.65x | PASS |
| `metric_batch`     | framed        | TDBIN       |        3.39x |        4.51x | PASS |
| `metric_batch`     | packed framed | TDBIN       |        1.83x |        0.94x | FAIL |
| `person_batch`     | bare          | TDBIN       |        1.54x |        1.57x | PASS |
| `person_batch`     | framed        | TDBIN       |        1.54x |        1.53x | PASS |
| `person_batch`     | packed framed | TDBIN       |        1.17x |        1.38x | FAIL |
| `contact_batch`    | bare          | TDBIN       |        2.95x |        1.96x | PASS |
| `contact_batch`    | framed        | TDBIN       |        2.94x |        1.66x | PASS |
| `contact_batch`    | packed framed | TDBIN       |        2.19x |        1.78x | PASS |
| `diagram_document` | bare          | TDBIN       |        1.41x |        1.61x | FAIL |
| `diagram_document` | framed        | TDBIN       |        1.67x |        1.58x | PASS |
| `diagram_document` | packed framed | TDBIN       |        0.96x |        1.42x | FAIL |
| `event_batch`      | bare          | TDBIN       |        1.95x |        1.50x | FAIL |
| `event_batch`      | framed        | TDBIN       |        2.00x |        1.48x | FAIL |
| `event_batch`      | packed framed | TDBIN       |        1.43x |        1.34x | FAIL |

Passing fixture/mode combinations: 8 of 21.

This secondary table exposes unpacked tradeoffs; it does not replace the packed-framed specification gate above.

## Commands

- `cargo bench -p tdbin --bench gate -- --noplot`
- `node scripts/tdbin-bench-report.mjs`

Corpus schemas:

- `docs/benchmarks/tdbin-corpus.td`
- `docs/benchmarks/tdbin-corpus.proto`
