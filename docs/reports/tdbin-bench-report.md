# TDBIN Benchmark Report

> GENERATED FILE. Source: `scripts/tdbin-bench-report.mjs` and `docs/reports/tdbin-bench-data.json`.
> Every value and verdict is computed from machine-readable Criterion and encoder output. No benchmark result is entered manually.

Generated: 2026-07-13T23:32:23.773Z

Raw data SHA-256: `46c48e4a8ae7f959b364576d3592682bd96f1257dd266fa8810cbb15c18fb388`

## Result

**Specification gate ([TDBIN-BENCH-CORPUS] committed workloads): FAIL.** 2 of 3 corpus fixtures have a production wire mode that is simultaneously smaller than Protobuf AND at least 1.50x faster on both encode and decode. Stress rows: 2 of 4 pass the same bar.

Qualifying modes: `with_address` = none, `without_address` = none, `metric_batch` = framed, `person_batch` = framed, `contact_batch` = framed & packed framed, `diagram_document` = framed, `event_batch` = none.

The release gate ([TDBIN-BENCH-GATE]) requires, for every corpus entry — the committed realistic schemas in `docs/benchmarks/tdbin-corpus.{td,proto}` (record-heavy document, union-heavy event stream, list-heavy dataset) — that at least one self-describing production wire mode (framed, or packed framed; the frame's PACKED flag makes the two interchangeable to every decoder) beats Protobuf on size and by 1.50x on both encode and decode simultaneously. Both modes are always measured and published below. Stress rows (marked) are reported against the identical bar; the tiny single-message rows carry a fixed 12-byte frame plus pointer-per-string overhead that no fixed-layout format recovers at sub-100-byte payloads (research §2.2), so they are not corpus entries.

## Size and Speed

The headline comparison — one row per test, all three self-describing formats side by side. TDBIN is its **framed** production mode; MessagePack is struct-as-map (via `rmp-serde`). Sizes are bytes; serialize is the full ADT→binary conversion, deserialize the full binary→ADT conversion. Lower is better everywhere.

| Test               | typeDiagram Size | Protobuf Size | MessagePack Size | typeDiagram Serialize | Protobuf Serialize | MessagePack Serialize | typeDiagram Deserialize | Protobuf Deserialize | MessagePack Deserialize |
| ------------------ | ---------------: | ------------: | ---------------: | --------------------: | -----------------: | --------------------: | ----------------------: | -------------------: | ----------------------: |
| `with_address`     |              172 |            79 |              142 |              86.21 ns |           46.82 ns |             240.50 ns |               157.32 ns |            150.50 ns |               192.39 ns |
| `without_address`  |              124 |            31 |              100 |              63.80 ns |           32.86 ns |             227.40 ns |                76.85 ns |             50.06 ns |               108.75 ns |
| `metric_batch`     |           43,788 |        84,149 |           90,440 |              6.557 us |          45.616 us |             43.619 us |                5.198 us |            29.664 us |               52.304 us |
| `person_batch`     |           22,988 |        29,184 |           61,963 |              9.728 us |          17.986 us |             48.369 us |               35.157 us |            55.844 us |               87.035 us |
| `contact_batch`    |           23,156 |        35,221 |           80,162 |              9.169 us |          24.761 us |             67.893 us |               30.351 us |            59.681 us |               92.548 us |
| `diagram_document` |           45,172 |        50,788 |           77,410 |             10.259 us |          21.699 us |             57.093 us |               69.248 us |           109.277 us |              130.848 us |
| `event_batch`      |          116,372 |       131,744 |          230,620 |             34.150 us |          69.852 us |            139.987 us |              193.619 us |           275.241 us |              372.344 us |

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
| `with_address`     | `tdbin_encode_bare`          |      50 |  4931.599 ms |   80.66 ns |   80.28 ns |   81.26 ns |
| `with_address`     | `tdbin_encode_framed`        |      50 |  5039.075 ms |   86.21 ns |   85.87 ns |   86.99 ns |
| `with_address`     | `tdbin_encode_packed_framed` |      50 |  4964.208 ms |  175.19 ns |  173.62 ns |  176.25 ns |
| `with_address`     | `protobuf_encode`            |      50 |  4994.310 ms |   46.82 ns |   46.59 ns |   47.06 ns |
| `with_address`     | `msgpack_encode`             |      50 |  4989.358 ms |  240.50 ns |  240.02 ns |  241.71 ns |
| `with_address`     | `tdbin_decode_bare`          |      50 |  5030.072 ms |  152.30 ns |  151.45 ns |  152.91 ns |
| `with_address`     | `tdbin_decode_framed`        |      50 |  5089.968 ms |  157.32 ns |  155.85 ns |  161.80 ns |
| `with_address`     | `tdbin_decode_packed_framed` |      50 |  5106.051 ms |  587.57 ns |  580.04 ns |  594.54 ns |
| `with_address`     | `protobuf_decode`            |      50 |  5005.128 ms |  150.50 ns |  149.91 ns |  151.64 ns |
| `with_address`     | `msgpack_decode`             |      50 |  4969.319 ms |  192.39 ns |  191.47 ns |  193.25 ns |
| `without_address`  | `tdbin_encode_bare`          |      50 |  4945.151 ms |   59.78 ns |   59.39 ns |   60.18 ns |
| `without_address`  | `tdbin_encode_framed`        |      50 |  4943.136 ms |   63.80 ns |   63.37 ns |   64.16 ns |
| `without_address`  | `tdbin_encode_packed_framed` |      50 |  4916.982 ms |  136.47 ns |  135.27 ns |  136.99 ns |
| `without_address`  | `protobuf_encode`            |      50 |  4996.045 ms |   32.86 ns |   32.73 ns |   32.98 ns |
| `without_address`  | `msgpack_encode`             |      50 |  5037.189 ms |  227.40 ns |  226.84 ns |  228.35 ns |
| `without_address`  | `tdbin_decode_bare`          |      50 |  4996.015 ms |   67.72 ns |   67.22 ns |   67.95 ns |
| `without_address`  | `tdbin_decode_framed`        |      50 |  5384.606 ms |   76.85 ns |   73.48 ns |   77.69 ns |
| `without_address`  | `tdbin_decode_packed_framed` |      50 |  5152.076 ms |  500.57 ns |  489.13 ns |  507.78 ns |
| `without_address`  | `protobuf_decode`            |      50 |  4993.446 ms |   50.06 ns |   49.74 ns |   50.22 ns |
| `without_address`  | `msgpack_decode`             |      50 |  4989.619 ms |  108.75 ns |  107.47 ns |  109.73 ns |
| `metric_batch`     | `tdbin_encode_bare`          |      50 |  5385.510 ms |   7.263 us |   6.474 us |   7.471 us |
| `metric_batch`     | `tdbin_encode_framed`        |      50 |  5386.488 ms |   6.557 us |   6.336 us |   6.871 us |
| `metric_batch`     | `tdbin_encode_packed_framed` |      50 |  4909.781 ms |  20.228 us |  19.324 us |  20.610 us |
| `metric_batch`     | `protobuf_encode`            |      50 |  5047.081 ms |  45.616 us |  44.868 us |  45.992 us |
| `metric_batch`     | `msgpack_encode`             |      50 |  5067.377 ms |  43.619 us |  43.455 us |  43.703 us |
| `metric_batch`     | `tdbin_decode_bare`          |      50 |  4970.291 ms |   5.223 us |   5.216 us |   5.239 us |
| `metric_batch`     | `tdbin_decode_framed`        |      50 |  4964.630 ms |   5.198 us |   5.182 us |   5.208 us |
| `metric_batch`     | `tdbin_decode_packed_framed` |      50 |  4979.641 ms |  28.041 us |  27.999 us |  28.085 us |
| `metric_batch`     | `protobuf_decode`            |      50 |  4924.024 ms |  29.664 us |  29.392 us |  29.919 us |
| `metric_batch`     | `msgpack_decode`             |      50 |  5165.280 ms |  52.304 us |  51.517 us |  53.082 us |
| `person_batch`     | `tdbin_encode_bare`          |      50 |  5078.212 ms |   9.837 us |   9.786 us |   9.880 us |
| `person_batch`     | `tdbin_encode_framed`        |      50 |  5005.247 ms |   9.728 us |   9.711 us |   9.767 us |
| `person_batch`     | `tdbin_encode_packed_framed` |      50 |  5019.039 ms |  13.545 us |  13.457 us |  13.572 us |
| `person_batch`     | `protobuf_encode`            |      50 |  5005.870 ms |  17.986 us |  17.813 us |  18.162 us |
| `person_batch`     | `msgpack_encode`             |      50 |  5005.912 ms |  48.369 us |  48.263 us |  48.658 us |
| `person_batch`     | `tdbin_decode_bare`          |      50 |  5062.145 ms |  35.364 us |  35.191 us |  35.485 us |
| `person_batch`     | `tdbin_decode_framed`        |      50 |  5005.412 ms |  35.157 us |  35.063 us |  35.252 us |
| `person_batch`     | `tdbin_decode_packed_framed` |      50 |  5006.201 ms |  39.554 us |  39.372 us |  39.679 us |
| `person_batch`     | `protobuf_decode`            |      50 |  5059.321 ms |  55.844 us |  55.678 us |  56.069 us |
| `person_batch`     | `msgpack_decode`             |      50 |  5000.367 ms |  87.035 us |  86.460 us |  87.671 us |
| `contact_batch`    | `tdbin_encode_bare`          |      50 |  4972.711 ms |   9.182 us |   9.147 us |   9.262 us |
| `contact_batch`    | `tdbin_encode_framed`        |      50 |  4990.231 ms |   9.169 us |   9.130 us |   9.217 us |
| `contact_batch`    | `tdbin_encode_packed_framed` |      50 |  4967.011 ms |  11.957 us |  11.902 us |  12.001 us |
| `contact_batch`    | `protobuf_encode`            |      50 |  5012.321 ms |  24.761 us |  24.620 us |  25.031 us |
| `contact_batch`    | `msgpack_encode`             |      50 |  5017.045 ms |  67.893 us |  67.626 us |  68.133 us |
| `contact_batch`    | `tdbin_decode_bare`          |      50 |  5001.397 ms |  30.451 us |  30.256 us |  30.601 us |
| `contact_batch`    | `tdbin_decode_framed`        |      50 |  4993.096 ms |  30.351 us |  30.203 us |  30.509 us |
| `contact_batch`    | `tdbin_decode_packed_framed` |      50 |  4995.879 ms |  32.194 us |  32.060 us |  32.293 us |
| `contact_batch`    | `protobuf_decode`            |      50 |  5013.239 ms |  59.681 us |  59.468 us |  59.851 us |
| `contact_batch`    | `msgpack_decode`             |      50 |  5098.326 ms |  92.548 us |  92.048 us |  93.058 us |
| `diagram_document` | `tdbin_encode_bare`          |      50 |  4987.085 ms |  10.234 us |  10.186 us |  10.303 us |
| `diagram_document` | `tdbin_encode_framed`        |      50 |  5037.163 ms |  10.259 us |  10.223 us |  10.348 us |
| `diagram_document` | `tdbin_encode_packed_framed` |      50 |  5009.037 ms |  17.134 us |  17.066 us |  17.208 us |
| `diagram_document` | `protobuf_encode`            |      50 |  5082.265 ms |  21.699 us |  21.502 us |  22.149 us |
| `diagram_document` | `msgpack_encode`             |      50 |  4993.633 ms |  57.093 us |  56.545 us |  57.766 us |
| `diagram_document` | `tdbin_decode_bare`          |      50 |  5130.113 ms |  70.279 us |  69.859 us |  70.710 us |
| `diagram_document` | `tdbin_decode_framed`        |      50 |  5066.610 ms |  69.248 us |  69.011 us |  69.658 us |
| `diagram_document` | `tdbin_decode_packed_framed` |      50 |  5040.853 ms |  78.910 us |  78.557 us |  79.335 us |
| `diagram_document` | `protobuf_decode`            |      50 |  5019.651 ms | 109.277 us | 108.927 us | 109.705 us |
| `diagram_document` | `msgpack_decode`             |      50 |  4999.292 ms | 130.848 us | 130.323 us | 131.115 us |
| `event_batch`      | `tdbin_encode_bare`          |      50 |  5030.536 ms |  33.937 us |  33.889 us |  34.062 us |
| `event_batch`      | `tdbin_encode_framed`        |      50 |  5031.903 ms |  34.150 us |  34.000 us |  34.334 us |
| `event_batch`      | `tdbin_encode_packed_framed` |      50 |  5007.372 ms |  50.872 us |  50.691 us |  50.990 us |
| `event_batch`      | `protobuf_encode`            |      50 |  4992.936 ms |  69.852 us |  69.613 us |  70.240 us |
| `event_batch`      | `msgpack_encode`             |      50 |  5178.803 ms | 139.987 us | 139.564 us | 140.438 us |
| `event_batch`      | `tdbin_decode_bare`          |      50 |  5595.398 ms | 194.821 us | 193.146 us | 196.017 us |
| `event_batch`      | `tdbin_decode_framed`        |      50 |  5537.603 ms | 193.619 us | 191.110 us | 194.725 us |
| `event_batch`      | `tdbin_decode_packed_framed` |      50 |  5223.633 ms | 194.652 us | 194.145 us | 195.373 us |
| `event_batch`      | `protobuf_decode`            |      50 |  5232.959 ms | 275.241 us | 273.705 us | 275.896 us |
| `event_batch`      | `msgpack_decode`             |      50 |  5230.549 ms | 372.344 us | 371.663 us | 373.583 us |

## Same-Mode Comparison

Ratios are Protobuf median / TDBIN median; values above 1.00x favor TDBIN. The gate requires size no larger than Protobuf and both encode and decode ratios at least 1.50x.

| Fixture            | TDBIN mode    | Size winner | Encode ratio | Decode ratio | Gate |
| ------------------ | ------------- | ----------- | -----------: | -----------: | ---- |
| `with_address`     | bare          | Protobuf    |        0.58x |        0.99x | FAIL |
| `with_address`     | framed        | Protobuf    |        0.54x |        0.96x | FAIL |
| `with_address`     | packed framed | Protobuf    |        0.27x |        0.26x | FAIL |
| `without_address`  | bare          | Protobuf    |        0.55x |        0.74x | FAIL |
| `without_address`  | framed        | Protobuf    |        0.52x |        0.65x | FAIL |
| `without_address`  | packed framed | Protobuf    |        0.24x |        0.10x | FAIL |
| `metric_batch`     | bare          | TDBIN       |        6.28x |        5.68x | PASS |
| `metric_batch`     | framed        | TDBIN       |        6.96x |        5.71x | PASS |
| `metric_batch`     | packed framed | TDBIN       |        2.26x |        1.06x | FAIL |
| `person_batch`     | bare          | TDBIN       |        1.83x |        1.58x | PASS |
| `person_batch`     | framed        | TDBIN       |        1.85x |        1.59x | PASS |
| `person_batch`     | packed framed | TDBIN       |        1.33x |        1.41x | FAIL |
| `contact_batch`    | bare          | TDBIN       |        2.70x |        1.96x | PASS |
| `contact_batch`    | framed        | TDBIN       |        2.70x |        1.97x | PASS |
| `contact_batch`    | packed framed | TDBIN       |        2.07x |        1.85x | PASS |
| `diagram_document` | bare          | TDBIN       |        2.12x |        1.55x | PASS |
| `diagram_document` | framed        | TDBIN       |        2.12x |        1.58x | PASS |
| `diagram_document` | packed framed | TDBIN       |        1.27x |        1.38x | FAIL |
| `event_batch`      | bare          | TDBIN       |        2.06x |        1.41x | FAIL |
| `event_batch`      | framed        | TDBIN       |        2.05x |        1.42x | FAIL |
| `event_batch`      | packed framed | TDBIN       |        1.37x |        1.41x | FAIL |

Passing fixture/mode combinations: 9 of 21.

This secondary table exposes unpacked tradeoffs; it does not replace the packed-framed specification gate above.

## Commands

- `cargo bench -p tdbin --bench gate -- --noplot`
- `node scripts/tdbin-bench-report.mjs`

Corpus schemas:

- `docs/benchmarks/tdbin-corpus.td`
- `docs/benchmarks/tdbin-corpus.proto`
