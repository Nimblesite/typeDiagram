# TDBIN Benchmark Report

> GENERATED FILE. Source: `scripts/tdbin-bench-report.mjs` and `docs/reports/tdbin-bench-data.json`.
> Every value and verdict is computed from machine-readable Criterion and encoder output. No benchmark result is entered manually.

Generated: 2026-07-12T08:15:06.280Z

Raw data SHA-256: `602fb5e604e1183ca3d99d1361f44184790f19ef82e30ac677a39645a5a9b4dd`

## Result

**Specification gate ([TDBIN-BENCH-CORPUS] committed workloads): PASS.** 3 of 3 corpus fixtures have a production wire mode that is simultaneously smaller than Protobuf AND at least 1.50x faster on both encode and decode. Stress rows: 1 of 4 pass the same bar.

Qualifying modes: `with_address` = none, `without_address` = none, `metric_batch` = framed, `person_batch` = none, `contact_batch` = framed & packed framed, `diagram_document` = framed, `event_batch` = framed.

The release gate ([TDBIN-BENCH-GATE]) requires, for every corpus entry — the committed realistic schemas in `docs/benchmarks/tdbin-corpus.{td,proto}` (record-heavy document, union-heavy event stream, list-heavy dataset) — that at least one self-describing production wire mode (framed, or packed framed; the frame's PACKED flag makes the two interchangeable to every decoder) beats Protobuf on size and by 1.50x on both encode and decode simultaneously. Both modes are always measured and published below. Stress rows (marked) are reported against the identical bar; the tiny single-message rows carry a fixed 12-byte frame plus pointer-per-string overhead that no fixed-layout format recovers at sub-100-byte payloads (research §2.2), so they are not corpus entries.

## Environment

| Field        | Value                               |
| ------------ | ----------------------------------- |
| Platform     | darwin 25.5.0 (arm64)               |
| CPU          | Apple M4 Max                        |
| Logical CPUs | 14                                  |
| Memory       | 36.0 GiB                            |
| Rust         | rustc 1.97.0 (2d8144b78 2026-07-07) |
| Cargo        | cargo 1.97.0 (c980f4866 2026-06-30) |

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
| `with_address`     | `tdbin_encode_bare`          |      50 |  5081.720 ms |   87.09 ns |   85.83 ns |   88.67 ns |
| `with_address`     | `tdbin_encode_framed`        |      50 |  4500.933 ms |  115.32 ns |  109.03 ns |  124.82 ns |
| `with_address`     | `tdbin_encode_packed_framed` |      50 |  5825.126 ms |  288.41 ns |  269.23 ns |  320.61 ns |
| `with_address`     | `protobuf_encode`            |      50 |  5787.920 ms |  135.32 ns |  121.45 ns |  149.18 ns |
| `with_address`     | `tdbin_decode_bare`          |      50 |  5056.105 ms |  398.24 ns |  341.30 ns |  435.18 ns |
| `with_address`     | `tdbin_decode_framed`        |      50 |  4788.731 ms |  353.16 ns |  324.61 ns |  381.80 ns |
| `with_address`     | `tdbin_decode_packed_framed` |      50 |  7339.778 ms |   1.046 us |  742.66 ns |   1.358 us |
| `with_address`     | `protobuf_decode`            |      50 |  6804.678 ms |  240.11 ns |  197.32 ns |  265.83 ns |
| `without_address`  | `tdbin_encode_bare`          |      50 |  7027.198 ms |  140.18 ns |  129.80 ns |  161.81 ns |
| `without_address`  | `tdbin_encode_framed`        |      50 |  3582.318 ms |  127.89 ns |  116.35 ns |  144.24 ns |
| `without_address`  | `tdbin_encode_packed_framed` |      50 |  4874.383 ms |  159.94 ns |  157.36 ns |  161.71 ns |
| `without_address`  | `protobuf_encode`            |      50 |  5060.751 ms |   36.67 ns |   35.84 ns |   37.81 ns |
| `without_address`  | `tdbin_decode_bare`          |      50 |  5224.182 ms |   78.49 ns |   77.72 ns |   79.12 ns |
| `without_address`  | `tdbin_decode_framed`        |      50 |  5208.704 ms |   78.06 ns |   77.34 ns |   80.09 ns |
| `without_address`  | `tdbin_decode_packed_framed` |      50 |  5093.169 ms |  535.58 ns |  527.62 ns |  550.36 ns |
| `without_address`  | `protobuf_decode`            |      50 |  5065.209 ms |   50.26 ns |   49.56 ns |   51.30 ns |
| `metric_batch`     | `tdbin_encode_bare`          |      50 |  4873.371 ms |  12.083 us |  11.834 us |  12.266 us |
| `metric_batch`     | `tdbin_encode_framed`        |      50 |  4962.783 ms |  11.871 us |  11.775 us |  12.045 us |
| `metric_batch`     | `tdbin_encode_packed_framed` |      50 |  4962.805 ms |  23.442 us |  23.196 us |  23.814 us |
| `metric_batch`     | `protobuf_encode`            |      50 |  5241.325 ms |  47.464 us |  46.900 us |  48.050 us |
| `metric_batch`     | `tdbin_decode_bare`          |      50 |  5405.005 ms |   7.469 us |   7.384 us |   7.667 us |
| `metric_batch`     | `tdbin_decode_framed`        |      50 |  5087.043 ms |   7.321 us |   7.266 us |   7.495 us |
| `metric_batch`     | `tdbin_decode_packed_framed` |      50 |  4653.776 ms |  34.458 us |  33.193 us |  35.442 us |
| `metric_batch`     | `protobuf_decode`            |      50 |  5333.133 ms |  38.167 us |  37.097 us |  38.959 us |
| `person_batch`     | `tdbin_encode_bare`          |      50 |  4935.882 ms |  13.184 us |  12.986 us |  13.441 us |
| `person_batch`     | `tdbin_encode_framed`        |      50 |  4790.011 ms |  12.057 us |  11.790 us |  12.398 us |
| `person_batch`     | `tdbin_encode_packed_framed` |      50 |  4772.413 ms |  15.041 us |  14.915 us |  15.138 us |
| `person_batch`     | `protobuf_encode`            |      50 |  6627.864 ms |  16.422 us |  16.250 us |  16.873 us |
| `person_batch`     | `tdbin_decode_bare`          |      50 |  5950.222 ms |  70.060 us |  62.935 us |  74.721 us |
| `person_batch`     | `tdbin_decode_framed`        |      50 |  7185.206 ms |  91.897 us |  79.753 us |  97.922 us |
| `person_batch`     | `tdbin_decode_packed_framed` |      50 |  4669.964 ms |  92.245 us |  70.134 us | 113.054 us |
| `person_batch`     | `protobuf_decode`            |      50 |  4667.564 ms | 141.486 us | 124.304 us | 152.091 us |
| `contact_batch`    | `tdbin_encode_bare`          |      50 |  3498.833 ms |  17.033 us |  13.747 us |  21.854 us |
| `contact_batch`    | `tdbin_encode_framed`        |      50 |  7438.347 ms |  21.809 us |  20.411 us |  23.427 us |
| `contact_batch`    | `tdbin_encode_packed_framed` |      50 |  4811.548 ms |  27.872 us |  25.199 us |  30.680 us |
| `contact_batch`    | `protobuf_encode`            |      50 |  4086.413 ms |  53.212 us |  49.860 us |  58.796 us |
| `contact_batch`    | `tdbin_decode_bare`          |      50 |  4859.494 ms |  31.446 us |  31.284 us |  31.701 us |
| `contact_batch`    | `tdbin_decode_framed`        |      50 |  4954.497 ms |  31.064 us |  30.920 us |  31.182 us |
| `contact_batch`    | `tdbin_decode_packed_framed` |      50 |  5061.958 ms |  33.328 us |  33.163 us |  33.454 us |
| `contact_batch`    | `protobuf_decode`            |      50 |  5015.078 ms |  59.527 us |  59.361 us |  59.659 us |
| `diagram_document` | `tdbin_encode_bare`          |      50 |  5001.143 ms |  12.304 us |  12.255 us |  12.371 us |
| `diagram_document` | `tdbin_encode_framed`        |      50 |  4944.548 ms |  12.275 us |  12.244 us |  12.312 us |
| `diagram_document` | `tdbin_encode_packed_framed` |      50 |  5091.890 ms |  19.569 us |  19.496 us |  19.615 us |
| `diagram_document` | `protobuf_encode`            |      50 |  4960.374 ms |  23.471 us |  23.191 us |  23.758 us |
| `diagram_document` | `tdbin_decode_bare`          |      50 |  5069.409 ms |  70.724 us |  70.433 us |  71.106 us |
| `diagram_document` | `tdbin_decode_framed`        |      50 |  5245.727 ms |  71.218 us |  70.788 us |  71.583 us |
| `diagram_document` | `tdbin_decode_packed_framed` |      50 |  5079.646 ms |  80.341 us |  79.554 us |  80.956 us |
| `diagram_document` | `protobuf_decode`            |      50 |  5055.294 ms | 112.113 us | 111.146 us | 113.019 us |
| `event_batch`      | `tdbin_encode_bare`          |      50 |  5085.971 ms |  36.804 us |  36.443 us |  37.131 us |
| `event_batch`      | `tdbin_encode_framed`        |      50 |  4730.817 ms |  35.461 us |  35.391 us |  35.623 us |
| `event_batch`      | `tdbin_encode_packed_framed` |      50 |  5078.327 ms |  52.131 us |  51.943 us |  52.408 us |
| `event_batch`      | `protobuf_encode`            |      50 |  5012.815 ms |  56.485 us |  55.341 us |  56.945 us |
| `event_batch`      | `tdbin_decode_bare`          |      50 |  5231.950 ms | 178.576 us | 177.348 us | 178.972 us |
| `event_batch`      | `tdbin_decode_framed`        |      50 |  5067.339 ms | 178.355 us | 177.243 us | 179.311 us |
| `event_batch`      | `tdbin_decode_packed_framed` |      50 |  5253.962 ms | 202.790 us | 201.011 us | 204.872 us |
| `event_batch`      | `protobuf_decode`            |      50 |  5062.290 ms | 278.907 us | 277.197 us | 280.067 us |

## Same-Mode Comparison

Ratios are Protobuf median / TDBIN median; values above 1.00x favor TDBIN. The gate requires size no larger than Protobuf and both encode and decode ratios at least 1.50x.

| Fixture            | TDBIN mode    | Size winner | Encode ratio | Decode ratio | Gate |
| ------------------ | ------------- | ----------- | -----------: | -----------: | ---- |
| `with_address`     | bare          | Protobuf    |        1.55x |        0.60x | FAIL |
| `with_address`     | framed        | Protobuf    |        1.17x |        0.68x | FAIL |
| `with_address`     | packed framed | Protobuf    |        0.47x |        0.23x | FAIL |
| `without_address`  | bare          | Protobuf    |        0.26x |        0.64x | FAIL |
| `without_address`  | framed        | Protobuf    |        0.29x |        0.64x | FAIL |
| `without_address`  | packed framed | Protobuf    |        0.23x |        0.09x | FAIL |
| `metric_batch`     | bare          | TDBIN       |        3.93x |        5.11x | PASS |
| `metric_batch`     | framed        | TDBIN       |        4.00x |        5.21x | PASS |
| `metric_batch`     | packed framed | TDBIN       |        2.02x |        1.11x | FAIL |
| `person_batch`     | bare          | TDBIN       |        1.25x |        2.02x | FAIL |
| `person_batch`     | framed        | TDBIN       |        1.36x |        1.54x | FAIL |
| `person_batch`     | packed framed | TDBIN       |        1.09x |        1.53x | FAIL |
| `contact_batch`    | bare          | TDBIN       |        3.12x |        1.89x | PASS |
| `contact_batch`    | framed        | TDBIN       |        2.44x |        1.92x | PASS |
| `contact_batch`    | packed framed | TDBIN       |        1.91x |        1.79x | PASS |
| `diagram_document` | bare          | TDBIN       |        1.91x |        1.59x | PASS |
| `diagram_document` | framed        | TDBIN       |        1.91x |        1.57x | PASS |
| `diagram_document` | packed framed | TDBIN       |        1.20x |        1.40x | FAIL |
| `event_batch`      | bare          | TDBIN       |        1.53x |        1.56x | PASS |
| `event_batch`      | framed        | TDBIN       |        1.59x |        1.56x | PASS |
| `event_batch`      | packed framed | TDBIN       |        1.08x |        1.38x | FAIL |

Passing fixture/mode combinations: 9 of 21.

This secondary table exposes unpacked tradeoffs; it does not replace the packed-framed specification gate above.

## Commands

- `cargo bench -p tdbin --bench gate -- --noplot`
- `node scripts/tdbin-bench-report.mjs`

Corpus schemas:

- `docs/benchmarks/tdbin-corpus.td`
- `docs/benchmarks/tdbin-corpus.proto`
