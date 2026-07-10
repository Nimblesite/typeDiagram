# TDBIN Benchmark Report

> GENERATED FILE. Source: `scripts/tdbin-bench-report.mjs` and `docs/reports/tdbin-bench-data.json`.
> Every value and verdict is computed from machine-readable Criterion and encoder output. No benchmark result is entered manually.

Generated: 2026-07-10T03:42:01.823Z

Raw data SHA-256: `7717c402a5b281c57d0fbd7b8083e5a307b611116a11a5e3bbf2a7ab45c5c145`

## Result

**Specification gate: FAIL.** 0 of 7 fixtures pass the packed-framed size, encode, and decode requirements simultaneously.

The release gate requires packed-framed TDBIN to be no larger than Protobuf and at least 1.50x faster for both encode and decode on every fixture.

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

| Fixture            | Shape                         | Items | TDBIN bare | TDBIN framed | TDBIN packed framed | Protobuf | Framed delta | Packed delta |
| ------------------ | ----------------------------- | ----: | ---------: | -----------: | ------------------: | -------: | -----------: | -----------: |
| `with_address`     | tiny nested record and union  |     1 |        160 |          172 |                 109 |       79 |       117.7% |        38.0% |
| `without_address`  | tiny sparse record and union  |     1 |        112 |          124 |                  54 |       31 |       300.0% |        74.2% |
| `metric_batch`     | list-heavy telemetry          | 4,096 |     76,752 |       76,764 |              39,284 |   84,149 |        -8.8% |       -53.3% |
| `person_batch`     | repeated records              |   512 |     65,560 |       65,572 |              35,062 |   29,184 |       124.7% |        20.1% |
| `contact_batch`    | repeated unions               | 2,048 |     81,944 |       81,956 |              43,307 |   35,221 |       132.7% |        23.0% |
| `diagram_document` | record-heavy diagram document |   768 |     90,440 |       90,452 |              55,929 |   50,788 |        78.1% |        10.1% |
| `event_batch`      | union-heavy event stream      | 2,048 |    236,296 |      236,308 |             148,815 |  131,744 |        79.4% |        13.0% |

## Criterion Medians

| Fixture            | Operation                    | Samples | Sampled time |     Median |   CI lower |   CI upper |
| ------------------ | ---------------------------- | ------: | -----------: | ---------: | ---------: | ---------: |
| `with_address`     | `tdbin_encode_bare`          |      50 |  5070.997 ms |  381.84 ns |  379.12 ns |  385.95 ns |
| `with_address`     | `tdbin_encode_framed`        |      50 |  4982.448 ms |  397.07 ns |  395.49 ns |  398.64 ns |
| `with_address`     | `tdbin_encode_packed_framed` |      50 |  5061.741 ms |  482.39 ns |  476.89 ns |  489.65 ns |
| `with_address`     | `protobuf_encode`            |      50 |  4990.455 ms |   50.11 ns |   49.86 ns |   50.34 ns |
| `with_address`     | `tdbin_decode_bare`          |      50 |  5056.585 ms |  181.76 ns |  180.31 ns |  183.52 ns |
| `with_address`     | `tdbin_decode_framed`        |      50 |  4978.913 ms |  183.28 ns |  181.68 ns |  185.11 ns |
| `with_address`     | `tdbin_decode_packed_framed` |      50 |  5009.888 ms |  254.79 ns |  253.09 ns |  255.86 ns |
| `with_address`     | `protobuf_decode`            |      50 |  5005.223 ms |  153.78 ns |  152.80 ns |  155.09 ns |
| `without_address`  | `tdbin_encode_bare`          |      50 |  4944.496 ms |  265.63 ns |  264.50 ns |  267.75 ns |
| `without_address`  | `tdbin_encode_framed`        |      50 |  5015.833 ms |  278.25 ns |  275.89 ns |  279.26 ns |
| `without_address`  | `tdbin_encode_packed_framed` |      50 |  5061.081 ms |  362.78 ns |  358.92 ns |  364.50 ns |
| `without_address`  | `protobuf_encode`            |      50 |  5008.962 ms |   35.35 ns |   35.12 ns |   35.51 ns |
| `without_address`  | `tdbin_decode_bare`          |      50 |  5043.756 ms |   89.40 ns |   88.64 ns |   89.94 ns |
| `without_address`  | `tdbin_decode_framed`        |      50 |  5012.786 ms |   91.78 ns |   91.24 ns |   92.24 ns |
| `without_address`  | `tdbin_decode_packed_framed` |      50 |  4959.405 ms |  182.04 ns |  180.81 ns |  183.14 ns |
| `without_address`  | `protobuf_decode`            |      50 |  4985.055 ms |   53.02 ns |   52.70 ns |   53.55 ns |
| `metric_batch`     | `tdbin_encode_bare`          |      50 |  5547.200 ms |  21.980 us |  20.838 us |  22.174 us |
| `metric_batch`     | `tdbin_encode_framed`        |      50 |  5003.395 ms |  22.587 us |  21.705 us |  22.829 us |
| `metric_batch`     | `tdbin_encode_packed_framed` |      50 |  4907.493 ms |  52.442 us |  51.450 us |  53.063 us |
| `metric_batch`     | `protobuf_encode`            |      50 |  4985.355 ms |  46.490 us |  45.051 us |  46.793 us |
| `metric_batch`     | `tdbin_decode_bare`          |      50 |  5013.935 ms |   6.501 us |   6.478 us |   6.510 us |
| `metric_batch`     | `tdbin_decode_framed`        |      50 |  5019.835 ms |   6.553 us |   6.539 us |   6.608 us |
| `metric_batch`     | `tdbin_decode_packed_framed` |      50 |  4941.259 ms |  22.436 us |  22.367 us |  22.489 us |
| `metric_batch`     | `protobuf_decode`            |      50 |  5001.425 ms |  35.149 us |  34.851 us |  35.332 us |
| `person_batch`     | `tdbin_encode_bare`          |      50 |  5216.040 ms |  29.493 us |  28.926 us |  30.420 us |
| `person_batch`     | `tdbin_encode_framed`        |      50 |  5171.533 ms |  31.689 us |  31.155 us |  31.926 us |
| `person_batch`     | `tdbin_encode_packed_framed` |      50 |  5116.366 ms |  55.780 us |  55.282 us |  56.005 us |
| `person_batch`     | `protobuf_encode`            |      50 |  4995.029 ms |  16.797 us |  16.692 us |  16.968 us |
| `person_batch`     | `tdbin_decode_bare`          |      50 |  4983.664 ms |  57.250 us |  57.098 us |  57.551 us |
| `person_batch`     | `tdbin_decode_framed`        |      50 |  4997.063 ms |  57.762 us |  57.450 us |  57.953 us |
| `person_batch`     | `tdbin_decode_packed_framed` |      50 |  5265.735 ms |  77.003 us |  76.711 us |  77.711 us |
| `person_batch`     | `protobuf_decode`            |      50 |  5021.199 ms |  58.634 us |  58.178 us |  58.995 us |
| `contact_batch`    | `tdbin_encode_bare`          |      50 |  4988.385 ms |  33.997 us |  33.234 us |  35.843 us |
| `contact_batch`    | `tdbin_encode_framed`        |      50 |  5216.026 ms |  37.106 us |  36.591 us |  37.159 us |
| `contact_batch`    | `tdbin_encode_packed_framed` |      50 |  5115.779 ms |  68.410 us |  67.923 us |  68.807 us |
| `contact_batch`    | `protobuf_encode`            |      50 |  5003.808 ms |  26.364 us |  26.286 us |  26.506 us |
| `contact_batch`    | `tdbin_decode_bare`          |      50 |  5073.914 ms |  55.889 us |  55.531 us |  56.469 us |
| `contact_batch`    | `tdbin_decode_framed`        |      50 |  5061.248 ms |  56.154 us |  55.356 us |  56.860 us |
| `contact_batch`    | `tdbin_decode_packed_framed` |      50 |  5361.860 ms |  77.675 us |  76.857 us |  79.554 us |
| `contact_batch`    | `protobuf_decode`            |      50 |  4993.380 ms |  63.114 us |  62.896 us |  63.385 us |
| `diagram_document` | `tdbin_encode_bare`          |      50 |  5255.203 ms |  37.128 us |  36.882 us |  37.372 us |
| `diagram_document` | `tdbin_encode_framed`        |      50 |  4953.430 ms |  38.630 us |  38.413 us |  38.832 us |
| `diagram_document` | `tdbin_encode_packed_framed` |      50 |  4948.430 ms |  76.118 us |  75.905 us |  76.374 us |
| `diagram_document` | `protobuf_encode`            |      50 |  5018.498 ms |  21.132 us |  21.045 us |  21.222 us |
| `diagram_document` | `tdbin_decode_bare`          |      50 |  5272.108 ms | 103.240 us | 102.559 us | 103.905 us |
| `diagram_document` | `tdbin_decode_framed`        |      50 |  5298.246 ms | 103.639 us | 102.467 us | 104.696 us |
| `diagram_document` | `tdbin_decode_packed_framed` |      50 |  5121.262 ms | 125.379 us | 124.877 us | 125.893 us |
| `diagram_document` | `protobuf_decode`            |      50 |  5104.717 ms | 111.181 us | 111.069 us | 111.674 us |
| `event_batch`      | `tdbin_encode_bare`          |      50 |  5116.897 ms | 108.354 us | 107.392 us | 109.113 us |
| `event_batch`      | `tdbin_encode_framed`        |      50 |  5033.307 ms | 112.373 us | 111.228 us | 113.070 us |
| `event_batch`      | `tdbin_encode_packed_framed` |      50 |  5236.717 ms | 215.962 us | 215.422 us | 216.935 us |
| `event_batch`      | `protobuf_encode`            |      50 |  5038.398 ms |  66.328 us |  65.506 us |  67.330 us |
| `event_batch`      | `tdbin_decode_bare`          |      50 |  5002.596 ms | 261.957 us | 260.888 us | 263.504 us |
| `event_batch`      | `tdbin_decode_framed`        |      50 |  5113.540 ms | 267.175 us | 266.753 us | 268.593 us |
| `event_batch`      | `tdbin_decode_packed_framed` |      50 |  5073.051 ms | 330.490 us | 328.873 us | 332.482 us |
| `event_batch`      | `protobuf_decode`            |      50 |  5130.284 ms | 286.854 us | 284.751 us | 288.061 us |

## Same-Mode Comparison

Ratios are Protobuf median / TDBIN median; values above 1.00x favor TDBIN. The gate requires size no larger than Protobuf and both encode and decode ratios at least 1.50x.

| Fixture            | TDBIN mode    | Size winner | Encode ratio | Decode ratio | Gate |
| ------------------ | ------------- | ----------- | -----------: | -----------: | ---- |
| `with_address`     | bare          | Protobuf    |        0.13x |        0.85x | FAIL |
| `with_address`     | framed        | Protobuf    |        0.13x |        0.84x | FAIL |
| `with_address`     | packed framed | Protobuf    |        0.10x |        0.60x | FAIL |
| `without_address`  | bare          | Protobuf    |        0.13x |        0.59x | FAIL |
| `without_address`  | framed        | Protobuf    |        0.13x |        0.58x | FAIL |
| `without_address`  | packed framed | Protobuf    |        0.10x |        0.29x | FAIL |
| `metric_batch`     | bare          | TDBIN       |        2.12x |        5.41x | PASS |
| `metric_batch`     | framed        | TDBIN       |        2.06x |        5.36x | PASS |
| `metric_batch`     | packed framed | TDBIN       |        0.89x |        1.57x | FAIL |
| `person_batch`     | bare          | Protobuf    |        0.57x |        1.02x | FAIL |
| `person_batch`     | framed        | Protobuf    |        0.53x |        1.02x | FAIL |
| `person_batch`     | packed framed | Protobuf    |        0.30x |        0.76x | FAIL |
| `contact_batch`    | bare          | Protobuf    |        0.78x |        1.13x | FAIL |
| `contact_batch`    | framed        | Protobuf    |        0.71x |        1.12x | FAIL |
| `contact_batch`    | packed framed | Protobuf    |        0.39x |        0.81x | FAIL |
| `diagram_document` | bare          | Protobuf    |        0.57x |        1.08x | FAIL |
| `diagram_document` | framed        | Protobuf    |        0.55x |        1.07x | FAIL |
| `diagram_document` | packed framed | Protobuf    |        0.28x |        0.89x | FAIL |
| `event_batch`      | bare          | Protobuf    |        0.61x |        1.10x | FAIL |
| `event_batch`      | framed        | Protobuf    |        0.59x |        1.07x | FAIL |
| `event_batch`      | packed framed | Protobuf    |        0.31x |        0.87x | FAIL |

Passing fixture/mode combinations: 2 of 21.

This secondary table exposes unpacked tradeoffs; it does not replace the packed-framed specification gate above.

## Commands

- `cargo bench -p tdbin --bench gate -- --noplot`
- `node scripts/tdbin-bench-report.mjs`

Corpus schemas:

- `docs/benchmarks/tdbin-corpus.td`
- `docs/benchmarks/tdbin-corpus.proto`
