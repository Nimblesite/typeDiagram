# TDBIN Benchmark Report

> GENERATED FILE. Source: `scripts/tdbin-bench-report.mjs` and `docs/reports/tdbin-bench-data.json`.
> Every value and verdict is computed from machine-readable Criterion and encoder output. No benchmark result is entered manually.

Generated: 2026-07-13T22:00:16.855Z

Raw data SHA-256: `134d351db228a6f2338f73f6682333eaa671b8aa6d688c8c074285126819f5fe`

## Result

**Specification gate ([TDBIN-BENCH-CORPUS] committed workloads): FAIL.** 2 of 3 corpus fixtures have a production wire mode that is simultaneously smaller than Protobuf AND at least 1.50x faster on both encode and decode. Stress rows: 2 of 4 pass the same bar.

Qualifying modes: `with_address` = none, `without_address` = none, `metric_batch` = framed, `person_batch` = framed, `contact_batch` = framed & packed framed, `diagram_document` = framed, `event_batch` = none.

The release gate ([TDBIN-BENCH-GATE]) requires, for every corpus entry — the committed realistic schemas in `docs/benchmarks/tdbin-corpus.{td,proto}` (record-heavy document, union-heavy event stream, list-heavy dataset) — that at least one self-describing production wire mode (framed, or packed framed; the frame's PACKED flag makes the two interchangeable to every decoder) beats Protobuf on size and by 1.50x on both encode and decode simultaneously. Both modes are always measured and published below. Stress rows (marked) are reported against the identical bar; the tiny single-message rows carry a fixed 12-byte frame plus pointer-per-string overhead that no fixed-layout format recovers at sub-100-byte payloads (research §2.2), so they are not corpus entries.

## Size and Speed

The headline comparison — one row per test, all three self-describing formats side by side. TDBIN is its **framed** production mode; MessagePack is struct-as-map (via `rmp-serde`). Sizes are bytes; serialize is the full ADT→binary conversion, deserialize the full binary→ADT conversion. Lower is better everywhere.

| Test               | typeDiagram Size | Protobuf Size | MessagePack Size | typeDiagram Serialize | Protobuf Serialize | MessagePack Serialize | typeDiagram Deserialize | Protobuf Deserialize | MessagePack Deserialize |
| ------------------ | ---------------: | ------------: | ---------------: | --------------------: | -----------------: | --------------------: | ----------------------: | -------------------: | ----------------------: |
| `with_address`     |              172 |            79 |              142 |              87.51 ns |           46.84 ns |             252.33 ns |               153.21 ns |            152.49 ns |               195.31 ns |
| `without_address`  |              124 |            31 |              100 |              65.76 ns |           32.68 ns |             228.84 ns |                71.52 ns |             50.66 ns |               109.68 ns |
| `metric_batch`     |           43,788 |        84,149 |           90,440 |             11.637 us |          45.467 us |             43.944 us |                6.251 us |            31.317 us |               50.870 us |
| `person_batch`     |           22,988 |        29,184 |           61,963 |             11.587 us |          18.195 us |             48.224 us |               36.786 us |            57.952 us |               87.828 us |
| `contact_batch`    |           23,156 |        35,221 |           80,162 |              9.025 us |          24.957 us |             69.630 us |               31.045 us |            61.434 us |               95.623 us |
| `diagram_document` |           45,172 |        50,788 |           77,410 |             12.340 us |          21.809 us |             55.735 us |               71.705 us |           110.587 us |              134.250 us |
| `event_batch`      |          116,372 |       131,744 |          230,620 |             35.490 us |          66.930 us |            138.809 us |              201.602 us |           279.422 us |              387.002 us |

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
├── prost v0.14.3
├── rmp-serde v1.3.1
└── serde v1.0.228
```

## Encoded Size

All sizes are bytes. Percentage columns are relative to Protobuf; negative is smaller.

| Fixture            | Shape                         | Role   | Items | TDBIN bare | TDBIN framed | TDBIN packed framed | Protobuf | MessagePack | Framed delta | Packed delta |
| ------------------ | ----------------------------- | ------ | ----: | ---------: | -----------: | ------------------: | -------: | ----------: | -----------: | -----------: |
| `with_address`     | tiny nested record and union  | stress |     1 |        160 |          172 |                 109 |       79 |         142 |       117.7% |        38.0% |
| `without_address`  | tiny sparse record and union  | stress |     1 |        112 |          124 |                  54 |       31 |         100 |       300.0% |        74.2% |
| `metric_batch`     | list-heavy telemetry          | corpus | 4,096 |     43,776 |       43,788 |              23,045 |   84,149 |      90,440 |       -48.0% |       -72.6% |
| `person_batch`     | repeated records              | stress |   512 |     22,976 |       22,988 |              20,071 |   29,184 |      61,963 |       -21.2% |       -31.2% |
| `contact_batch`    | repeated unions               | stress | 2,048 |     23,144 |       23,156 |              22,317 |   35,221 |      80,162 |       -34.3% |       -36.6% |
| `diagram_document` | record-heavy diagram document | corpus |   768 |     45,160 |       45,172 |              37,868 |   50,788 |      77,410 |       -11.1% |       -25.4% |
| `event_batch`      | union-heavy event stream      | corpus | 2,048 |    116,360 |      116,372 |             102,861 |  131,744 |     230,620 |       -11.7% |       -21.9% |

## Criterion Medians

Each row is one **individual** operation — a complete serialize _or_ deserialize, not a round-trip. The operation name encodes the direction (`encode` = ADT→binary, `decode` = binary→ADT) and the wire mode (`bare`, `framed`, or `packed_framed` for TDBIN). "Median" is the per-call time (what to compare); "Sampled time" is only Criterion's total measurement budget for that row. Sum a fixture's `encode` and `decode` rows to get the round-trip totals above.

| Fixture            | Operation                    | Samples | Sampled time |     Median |   CI lower |   CI upper |
| ------------------ | ---------------------------- | ------: | -----------: | ---------: | ---------: | ---------: |
| `with_address`     | `tdbin_encode_bare`          |      50 |  4979.331 ms |   83.62 ns |   83.24 ns |   84.05 ns |
| `with_address`     | `tdbin_encode_framed`        |      50 |  4680.046 ms |   87.51 ns |   87.22 ns |   88.42 ns |
| `with_address`     | `tdbin_encode_packed_framed` |      50 |  5033.556 ms |  184.41 ns |  183.63 ns |  185.68 ns |
| `with_address`     | `protobuf_encode`            |      50 |  4875.876 ms |   46.84 ns |   46.66 ns |   47.05 ns |
| `with_address`     | `msgpack_encode`             |      50 |  4900.558 ms |  252.33 ns |  250.67 ns |  254.03 ns |
| `with_address`     | `tdbin_decode_bare`          |      50 |  5004.358 ms |  151.84 ns |  151.29 ns |  153.13 ns |
| `with_address`     | `tdbin_decode_framed`        |      50 |  5015.032 ms |  153.21 ns |  152.62 ns |  153.56 ns |
| `with_address`     | `tdbin_decode_packed_framed` |      50 |  5018.607 ms |  571.43 ns |  570.17 ns |  573.83 ns |
| `with_address`     | `protobuf_decode`            |      50 |  5014.850 ms |  152.49 ns |  151.72 ns |  153.26 ns |
| `with_address`     | `msgpack_decode`             |      50 |  5300.693 ms |  195.31 ns |  194.47 ns |  196.07 ns |
| `without_address`  | `tdbin_encode_bare`          |      50 |  4706.953 ms |   61.10 ns |   60.79 ns |   61.43 ns |
| `without_address`  | `tdbin_encode_framed`        |      50 |  4976.057 ms |   65.76 ns |   65.49 ns |   66.17 ns |
| `without_address`  | `tdbin_encode_packed_framed` |      50 |  4880.894 ms |  141.92 ns |  141.35 ns |  142.94 ns |
| `without_address`  | `protobuf_encode`            |      50 |  4975.979 ms |   32.68 ns |   32.60 ns |   32.86 ns |
| `without_address`  | `msgpack_encode`             |      50 |  4988.960 ms |  228.84 ns |  228.13 ns |  230.06 ns |
| `without_address`  | `tdbin_decode_bare`          |      50 |  4982.202 ms |   69.07 ns |   68.85 ns |   69.64 ns |
| `without_address`  | `tdbin_decode_framed`        |      50 |  4985.774 ms |   71.52 ns |   71.36 ns |   71.80 ns |
| `without_address`  | `tdbin_decode_packed_framed` |      50 |  5005.363 ms |  482.70 ns |  481.61 ns |  485.38 ns |
| `without_address`  | `protobuf_decode`            |      50 |  4982.155 ms |   50.66 ns |   50.47 ns |   50.90 ns |
| `without_address`  | `msgpack_decode`             |      50 |  5011.579 ms |  109.68 ns |  108.40 ns |  110.71 ns |
| `metric_batch`     | `tdbin_encode_bare`          |      50 |  4895.851 ms |  11.344 us |  11.198 us |  11.548 us |
| `metric_batch`     | `tdbin_encode_framed`        |      50 |  5053.565 ms |  11.637 us |  11.442 us |  11.790 us |
| `metric_batch`     | `tdbin_encode_packed_framed` |      50 |  5027.355 ms |  23.042 us |  22.954 us |  23.098 us |
| `metric_batch`     | `protobuf_encode`            |      50 |  5015.356 ms |  45.467 us |  45.165 us |  46.030 us |
| `metric_batch`     | `msgpack_encode`             |      50 |  5058.800 ms |  43.944 us |  43.876 us |  44.050 us |
| `metric_batch`     | `tdbin_decode_bare`          |      50 |  4999.074 ms |   6.263 us |   6.237 us |   6.276 us |
| `metric_batch`     | `tdbin_decode_framed`        |      50 |  4963.736 ms |   6.251 us |   6.238 us |   6.260 us |
| `metric_batch`     | `tdbin_decode_packed_framed` |      50 |  4985.412 ms |  29.942 us |  29.837 us |  30.012 us |
| `metric_batch`     | `protobuf_decode`            |      50 |  5056.750 ms |  31.317 us |  30.982 us |  31.566 us |
| `metric_batch`     | `msgpack_decode`             |      50 |  5055.012 ms |  50.870 us |  50.667 us |  50.999 us |
| `person_batch`     | `tdbin_encode_bare`          |      50 |  5018.668 ms |  11.593 us |  11.550 us |  11.662 us |
| `person_batch`     | `tdbin_encode_framed`        |      50 |  5040.314 ms |  11.587 us |  11.552 us |  11.624 us |
| `person_batch`     | `tdbin_encode_packed_framed` |      50 |  5023.851 ms |  15.048 us |  14.982 us |  15.099 us |
| `person_batch`     | `protobuf_encode`            |      50 |  5011.984 ms |  18.195 us |  18.039 us |  18.356 us |
| `person_batch`     | `msgpack_encode`             |      50 |  5034.277 ms |  48.224 us |  48.004 us |  48.297 us |
| `person_batch`     | `tdbin_decode_bare`          |      50 |  4953.236 ms |  37.127 us |  36.968 us |  37.348 us |
| `person_batch`     | `tdbin_decode_framed`        |      50 |  4999.731 ms |  36.786 us |  36.716 us |  36.994 us |
| `person_batch`     | `tdbin_decode_packed_framed` |      50 |  5002.427 ms |  41.346 us |  41.171 us |  41.454 us |
| `person_batch`     | `protobuf_decode`            |      50 |  5043.928 ms |  57.952 us |  57.728 us |  58.289 us |
| `person_batch`     | `msgpack_decode`             |      50 |  5043.933 ms |  87.828 us |  87.503 us |  88.481 us |
| `contact_batch`    | `tdbin_encode_bare`          |      50 |  4979.172 ms |   9.008 us |   8.979 us |   9.036 us |
| `contact_batch`    | `tdbin_encode_framed`        |      50 |  5001.161 ms |   9.025 us |   8.979 us |   9.050 us |
| `contact_batch`    | `tdbin_encode_packed_framed` |      50 |  4967.120 ms |  11.986 us |  11.966 us |  12.028 us |
| `contact_batch`    | `protobuf_encode`            |      50 |  4944.458 ms |  24.957 us |  24.746 us |  25.115 us |
| `contact_batch`    | `msgpack_encode`             |      50 |  4982.157 ms |  69.630 us |  69.408 us |  69.994 us |
| `contact_batch`    | `tdbin_decode_bare`          |      50 |  5058.549 ms |  31.083 us |  30.977 us |  31.205 us |
| `contact_batch`    | `tdbin_decode_framed`        |      50 |  4989.842 ms |  31.045 us |  30.865 us |  31.138 us |
| `contact_batch`    | `tdbin_decode_packed_framed` |      50 |  5039.519 ms |  33.270 us |  33.134 us |  33.520 us |
| `contact_batch`    | `protobuf_decode`            |      50 |  5049.477 ms |  61.434 us |  61.210 us |  61.662 us |
| `contact_batch`    | `msgpack_decode`             |      50 |  5005.630 ms |  95.623 us |  95.163 us |  96.003 us |
| `diagram_document` | `tdbin_encode_bare`          |      50 |  5027.731 ms |  12.352 us |  12.307 us |  12.392 us |
| `diagram_document` | `tdbin_encode_framed`        |      50 |  5002.334 ms |  12.340 us |  12.320 us |  12.387 us |
| `diagram_document` | `tdbin_encode_packed_framed` |      50 |  5016.868 ms |  19.374 us |  19.309 us |  19.404 us |
| `diagram_document` | `protobuf_encode`            |      50 |  5003.104 ms |  21.809 us |  21.677 us |  21.980 us |
| `diagram_document` | `msgpack_encode`             |      50 |  4975.532 ms |  55.735 us |  55.357 us |  55.915 us |
| `diagram_document` | `tdbin_decode_bare`          |      50 |  5022.721 ms |  71.659 us |  71.302 us |  72.031 us |
| `diagram_document` | `tdbin_decode_framed`        |      50 |  5033.499 ms |  71.705 us |  71.323 us |  71.949 us |
| `diagram_document` | `tdbin_decode_packed_framed` |      50 |  5018.654 ms |  80.233 us |  79.981 us |  80.513 us |
| `diagram_document` | `protobuf_decode`            |      50 |  5078.462 ms | 110.587 us | 110.145 us | 110.848 us |
| `diagram_document` | `msgpack_decode`             |      50 |  5147.939 ms | 134.250 us | 133.630 us | 134.904 us |
| `event_batch`      | `tdbin_encode_bare`          |      50 |  5035.724 ms |  35.478 us |  35.418 us |  35.511 us |
| `event_batch`      | `tdbin_encode_framed`        |      50 |  5039.177 ms |  35.490 us |  35.371 us |  35.636 us |
| `event_batch`      | `tdbin_encode_packed_framed` |      50 |  5034.663 ms |  51.961 us |  51.840 us |  52.082 us |
| `event_batch`      | `protobuf_encode`            |      50 |  5040.797 ms |  66.930 us |  66.714 us |  67.227 us |
| `event_batch`      | `msgpack_encode`             |      50 |  5148.309 ms | 138.809 us | 138.563 us | 139.068 us |
| `event_batch`      | `tdbin_decode_bare`          |      50 |  5649.776 ms | 201.638 us | 199.727 us | 202.658 us |
| `event_batch`      | `tdbin_decode_framed`        |      50 |  5636.486 ms | 201.602 us | 200.463 us | 202.969 us |
| `event_batch`      | `tdbin_decode_packed_framed` |      50 |  5281.911 ms | 207.267 us | 206.925 us | 207.595 us |
| `event_batch`      | `protobuf_decode`            |      50 |  5343.110 ms | 279.422 us | 277.027 us | 281.490 us |
| `event_batch`      | `msgpack_decode`             |      50 |  5426.403 ms | 387.002 us | 385.202 us | 388.430 us |

## Same-Mode Comparison

Ratios are Protobuf median / TDBIN median; values above 1.00x favor TDBIN. The gate requires size no larger than Protobuf and both encode and decode ratios at least 1.50x.

| Fixture            | TDBIN mode    | Size winner | Encode ratio | Decode ratio | Gate |
| ------------------ | ------------- | ----------- | -----------: | -----------: | ---- |
| `with_address`     | bare          | Protobuf    |        0.56x |        1.00x | FAIL |
| `with_address`     | framed        | Protobuf    |        0.54x |        1.00x | FAIL |
| `with_address`     | packed framed | Protobuf    |        0.25x |        0.27x | FAIL |
| `without_address`  | bare          | Protobuf    |        0.53x |        0.73x | FAIL |
| `without_address`  | framed        | Protobuf    |        0.50x |        0.71x | FAIL |
| `without_address`  | packed framed | Protobuf    |        0.23x |        0.10x | FAIL |
| `metric_batch`     | bare          | TDBIN       |        4.01x |        5.00x | PASS |
| `metric_batch`     | framed        | TDBIN       |        3.91x |        5.01x | PASS |
| `metric_batch`     | packed framed | TDBIN       |        1.97x |        1.05x | FAIL |
| `person_batch`     | bare          | TDBIN       |        1.57x |        1.56x | PASS |
| `person_batch`     | framed        | TDBIN       |        1.57x |        1.58x | PASS |
| `person_batch`     | packed framed | TDBIN       |        1.21x |        1.40x | FAIL |
| `contact_batch`    | bare          | TDBIN       |        2.77x |        1.98x | PASS |
| `contact_batch`    | framed        | TDBIN       |        2.77x |        1.98x | PASS |
| `contact_batch`    | packed framed | TDBIN       |        2.08x |        1.85x | PASS |
| `diagram_document` | bare          | TDBIN       |        1.77x |        1.54x | PASS |
| `diagram_document` | framed        | TDBIN       |        1.77x |        1.54x | PASS |
| `diagram_document` | packed framed | TDBIN       |        1.13x |        1.38x | FAIL |
| `event_batch`      | bare          | TDBIN       |        1.89x |        1.39x | FAIL |
| `event_batch`      | framed        | TDBIN       |        1.89x |        1.39x | FAIL |
| `event_batch`      | packed framed | TDBIN       |        1.29x |        1.35x | FAIL |

Passing fixture/mode combinations: 9 of 21.

This secondary table exposes unpacked tradeoffs; it does not replace the packed-framed specification gate above.

## Commands

- `cargo bench -p tdbin --bench gate -- --noplot`
- `node scripts/tdbin-bench-report.mjs`

Corpus schemas:

- `docs/benchmarks/tdbin-corpus.td`
- `docs/benchmarks/tdbin-corpus.proto`
