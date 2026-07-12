# TDBIN Benchmark Report

> GENERATED FILE. Source: `scripts/tdbin-bench-report.mjs` and `docs/reports/tdbin-bench-data.json`.
> Every value and verdict is computed from machine-readable Criterion and encoder output. No benchmark result is entered manually.

Generated: 2026-07-12T09:23:43.780Z

Raw data SHA-256: `9153a769c7062e5de6ad54be8ddf77f82655d1c362dbac55a930c7a161da8e7e`

## Result

**Specification gate ([TDBIN-BENCH-CORPUS] committed workloads): FAIL.** 2 of 3 corpus fixtures have a production wire mode that is simultaneously smaller than Protobuf AND at least 1.50x faster on both encode and decode. Stress rows: 1 of 4 pass the same bar.

Qualifying modes: `with_address` = none, `without_address` = none, `metric_batch` = framed, `person_batch` = none, `contact_batch` = framed & packed framed, `diagram_document` = framed, `event_batch` = none.

The release gate ([TDBIN-BENCH-GATE]) requires, for every corpus entry — the committed realistic schemas in `docs/benchmarks/tdbin-corpus.{td,proto}` (record-heavy document, union-heavy event stream, list-heavy dataset) — that at least one self-describing production wire mode (framed, or packed framed; the frame's PACKED flag makes the two interchangeable to every decoder) beats Protobuf on size and by 1.50x on both encode and decode simultaneously. Both modes are always measured and published below. Stress rows (marked) are reported against the identical bar; the tiny single-message rows carry a fixed 12-byte frame plus pointer-per-string overhead that no fixed-layout format recovers at sub-100-byte payloads (research §2.2), so they are not corpus entries.

## At a Glance

One table per fixture. Rows are the three protocols; columns are the bench types (size, encode speed, decode speed). `tdbin` is the **framed** wire mode — the self-describing production peer of `msgpack` (struct-as-map, via `rmp-serde`) and `protobuf`. Lower is better everywhere. The full multi-mode breakdown (TDBIN bare/framed/packed and every Criterion statistic) is in the detailed tables further down.

### `with_address` — tiny nested record and union (stress, 1 items)

| Protocol       | Size (bytes) | vs Protobuf | Encode (median) | Decode (median) |
| -------------- | -----------: | ----------: | --------------: | --------------: |
| tdbin (framed) |          172 |     +117.7% |        94.85 ns |       166.09 ns |
| protobuf       |           79 |        same |        48.14 ns |       157.46 ns |
| msgpack        |          142 |      +79.7% |       269.46 ns |       219.07 ns |

### `without_address` — tiny sparse record and union (stress, 1 items)

| Protocol       | Size (bytes) | vs Protobuf | Encode (median) | Decode (median) |
| -------------- | -----------: | ----------: | --------------: | --------------: |
| tdbin (framed) |          124 |     +300.0% |        66.26 ns |        70.88 ns |
| protobuf       |           31 |        same |        37.65 ns |        59.88 ns |
| msgpack        |          100 |     +222.6% |       343.28 ns |       112.99 ns |

### `metric_batch` — list-heavy telemetry (corpus, 4,096 items)

| Protocol       | Size (bytes) | vs Protobuf | Encode (median) | Decode (median) |
| -------------- | -----------: | ----------: | --------------: | --------------: |
| tdbin (framed) |       43,788 |      -48.0% |       11.884 us |       10.621 us |
| protobuf       |       84,149 |        same |       45.933 us |       37.773 us |
| msgpack        |       90,440 |       +7.5% |       55.673 us |       51.039 us |

### `person_batch` — repeated records (stress, 512 items)

| Protocol       | Size (bytes) | vs Protobuf | Encode (median) | Decode (median) |
| -------------- | -----------: | ----------: | --------------: | --------------: |
| tdbin (framed) |       22,988 |      -21.2% |       11.869 us |       46.003 us |
| protobuf       |       29,184 |        same |       19.272 us |       61.638 us |
| msgpack        |       61,963 |     +112.3% |       51.123 us |       89.633 us |

### `contact_batch` — repeated unions (stress, 2,048 items)

| Protocol       | Size (bytes) | vs Protobuf | Encode (median) | Decode (median) |
| -------------- | -----------: | ----------: | --------------: | --------------: |
| tdbin (framed) |       23,156 |      -34.3% |        9.235 us |       31.003 us |
| protobuf       |       35,221 |        same |       32.441 us |       80.232 us |
| msgpack        |       80,162 |     +127.6% |       87.267 us |      126.634 us |

### `diagram_document` — record-heavy diagram document (corpus, 768 items)

| Protocol       | Size (bytes) | vs Protobuf | Encode (median) | Decode (median) |
| -------------- | -----------: | ----------: | --------------: | --------------: |
| tdbin (framed) |       45,172 |      -11.1% |       15.390 us |       86.173 us |
| protobuf       |       50,788 |        same |       23.327 us |      144.501 us |
| msgpack        |       77,410 |      +52.4% |       56.192 us |      141.899 us |

### `event_batch` — union-heavy event stream (corpus, 2,048 items)

| Protocol       | Size (bytes) | vs Protobuf | Encode (median) | Decode (median) |
| -------------- | -----------: | ----------: | --------------: | --------------: |
| tdbin (framed) |      116,372 |      -11.7% |       36.348 us |      229.887 us |
| protobuf       |      131,744 |        same |       81.632 us |      282.271 us |
| msgpack        |      230,620 |      +75.1% |      174.450 us |      389.899 us |

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

| Fixture            | Operation                    | Samples | Sampled time |     Median |   CI lower |   CI upper |
| ------------------ | ---------------------------- | ------: | -----------: | ---------: | ---------: | ---------: |
| `with_address`     | `tdbin_encode_bare`          |      50 |  4708.488 ms |   90.06 ns |   87.32 ns |  101.16 ns |
| `with_address`     | `tdbin_encode_framed`        |      50 |  4164.282 ms |   94.85 ns |   91.56 ns |  105.54 ns |
| `with_address`     | `tdbin_encode_packed_framed` |      50 |  3260.576 ms |  185.09 ns |  181.68 ns |  189.35 ns |
| `with_address`     | `protobuf_encode`            |      50 |  3512.653 ms |   48.14 ns |   47.51 ns |   48.83 ns |
| `with_address`     | `msgpack_encode`             |      50 |  4988.903 ms |  269.46 ns |  267.69 ns |  271.46 ns |
| `with_address`     | `tdbin_decode_bare`          |      50 |  4914.774 ms |  154.58 ns |  154.04 ns |  155.69 ns |
| `with_address`     | `tdbin_decode_framed`        |      50 |  5029.047 ms |  166.09 ns |  159.90 ns |  188.14 ns |
| `with_address`     | `tdbin_decode_packed_framed` |      50 |  6760.547 ms |  622.64 ns |  589.33 ns |  699.50 ns |
| `with_address`     | `protobuf_decode`            |      50 |  5433.692 ms |  157.46 ns |  155.60 ns |  165.73 ns |
| `with_address`     | `msgpack_decode`             |      50 |  5022.274 ms |  219.07 ns |  209.53 ns |  242.46 ns |
| `without_address`  | `tdbin_encode_bare`          |      50 |  3879.383 ms |   71.24 ns |   68.64 ns |   76.57 ns |
| `without_address`  | `tdbin_encode_framed`        |      50 |  3292.059 ms |   66.26 ns |   65.80 ns |   67.19 ns |
| `without_address`  | `tdbin_encode_packed_framed` |      50 |  5970.711 ms |  177.18 ns |  164.10 ns |  203.00 ns |
| `without_address`  | `protobuf_encode`            |      50 |  5080.760 ms |   37.65 ns |   35.14 ns |   41.79 ns |
| `without_address`  | `msgpack_encode`             |      50 |  5402.275 ms |  343.28 ns |  302.47 ns |  362.57 ns |
| `without_address`  | `tdbin_decode_bare`          |      50 |  6711.175 ms |   76.80 ns |   71.65 ns |   89.58 ns |
| `without_address`  | `tdbin_decode_framed`        |      50 |  5069.349 ms |   70.88 ns |   70.60 ns |   71.67 ns |
| `without_address`  | `tdbin_decode_packed_framed` |      50 |  7010.312 ms |  503.92 ns |  492.48 ns |  563.76 ns |
| `without_address`  | `protobuf_decode`            |      50 |  3556.800 ms |   59.88 ns |   55.95 ns |   72.98 ns |
| `without_address`  | `msgpack_decode`             |      50 |  3502.351 ms |  112.99 ns |  112.02 ns |  113.97 ns |
| `metric_batch`     | `tdbin_encode_bare`          |      50 |  5056.393 ms |  11.589 us |  11.445 us |  11.739 us |
| `metric_batch`     | `tdbin_encode_framed`        |      50 |  5063.613 ms |  11.884 us |  11.632 us |  12.106 us |
| `metric_batch`     | `tdbin_encode_packed_framed` |      50 |  4999.250 ms |  22.957 us |  22.783 us |  23.149 us |
| `metric_batch`     | `protobuf_encode`            |      50 |  5910.333 ms |  45.933 us |  45.139 us |  46.773 us |
| `metric_batch`     | `msgpack_encode`             |      50 |  6259.996 ms |  55.673 us |  52.643 us |  67.791 us |
| `metric_batch`     | `tdbin_decode_bare`          |      50 |  3685.052 ms |   6.471 us |   6.401 us |   7.546 us |
| `metric_batch`     | `tdbin_decode_framed`        |      50 |  7127.277 ms |  10.621 us |   8.261 us |  13.678 us |
| `metric_batch`     | `tdbin_decode_packed_framed` |      50 |  4056.282 ms |  39.008 us |  37.517 us |  43.444 us |
| `metric_batch`     | `protobuf_decode`            |      50 |  2731.351 ms |  37.773 us |  35.668 us |  40.497 us |
| `metric_batch`     | `msgpack_decode`             |      50 |  5559.500 ms |  51.039 us |  50.881 us |  51.328 us |
| `person_batch`     | `tdbin_encode_bare`          |      50 |  6342.107 ms |  15.291 us |  13.818 us |  20.269 us |
| `person_batch`     | `tdbin_encode_framed`        |      50 |  3470.387 ms |  11.869 us |  11.735 us |  11.973 us |
| `person_batch`     | `tdbin_encode_packed_framed` |      50 |  6760.689 ms |  19.653 us |  18.662 us |  27.379 us |
| `person_batch`     | `protobuf_encode`            |      50 |  3617.596 ms |  19.272 us |  18.868 us |  19.450 us |
| `person_batch`     | `msgpack_encode`             |      50 |  4209.904 ms |  51.123 us |  49.244 us |  60.303 us |
| `person_batch`     | `tdbin_decode_bare`          |      50 |  5816.982 ms |  36.895 us |  36.679 us |  37.989 us |
| `person_batch`     | `tdbin_decode_framed`        |      50 |  4643.515 ms |  46.003 us |  44.473 us |  49.309 us |
| `person_batch`     | `tdbin_decode_packed_framed` |      50 |  2513.662 ms |  41.894 us |  41.423 us |  42.698 us |
| `person_batch`     | `protobuf_decode`            |      50 |  4309.452 ms |  61.638 us |  59.351 us |  64.847 us |
| `person_batch`     | `msgpack_decode`             |      50 |  3926.919 ms |  89.633 us |  89.045 us |  91.727 us |
| `contact_batch`    | `tdbin_encode_bare`          |      50 |  3857.292 ms |   9.267 us |   9.140 us |   9.452 us |
| `contact_batch`    | `tdbin_encode_framed`        |      50 |  3977.619 ms |   9.235 us |   9.169 us |   9.298 us |
| `contact_batch`    | `tdbin_encode_packed_framed` |      50 |  4533.762 ms |  14.903 us |  14.181 us |  16.108 us |
| `contact_batch`    | `protobuf_encode`            |      50 |  3809.607 ms |  32.441 us |  29.305 us |  36.746 us |
| `contact_batch`    | `msgpack_encode`             |      50 |  6489.779 ms |  87.267 us |  80.904 us | 106.058 us |
| `contact_batch`    | `tdbin_decode_bare`          |      50 |  4708.315 ms |  33.601 us |  31.363 us |  38.208 us |
| `contact_batch`    | `tdbin_decode_framed`        |      50 |  4892.352 ms |  31.003 us |  30.748 us |  31.164 us |
| `contact_batch`    | `tdbin_decode_packed_framed` |      50 |  5169.716 ms |  33.539 us |  33.424 us |  33.742 us |
| `contact_batch`    | `protobuf_decode`            |      50 |  5430.856 ms |  80.232 us |  75.231 us |  96.771 us |
| `contact_batch`    | `msgpack_decode`             |      50 |  4300.871 ms | 126.634 us | 112.108 us | 139.731 us |
| `diagram_document` | `tdbin_encode_bare`          |      50 |  5535.814 ms |  16.328 us |  15.172 us |  21.075 us |
| `diagram_document` | `tdbin_encode_framed`        |      50 |  5265.309 ms |  15.390 us |  14.422 us |  17.625 us |
| `diagram_document` | `tdbin_encode_packed_framed` |      50 |  5193.875 ms |  19.981 us |  19.799 us |  20.305 us |
| `diagram_document` | `protobuf_encode`            |      50 |  3087.903 ms |  23.327 us |  22.851 us |  23.895 us |
| `diagram_document` | `msgpack_encode`             |      50 |  5022.687 ms |  56.192 us |  55.766 us |  56.472 us |
| `diagram_document` | `tdbin_decode_bare`          |      50 |  5034.613 ms |  71.630 us |  71.195 us |  72.027 us |
| `diagram_document` | `tdbin_decode_framed`        |      50 |  6169.790 ms |  86.173 us |  80.225 us |  94.685 us |
| `diagram_document` | `tdbin_decode_packed_framed` |      50 |  5425.883 ms | 100.677 us |  95.733 us | 105.803 us |
| `diagram_document` | `protobuf_decode`            |      50 |  3193.202 ms | 144.501 us | 122.209 us | 156.522 us |
| `diagram_document` | `msgpack_decode`             |      50 |  3682.530 ms | 141.899 us | 136.312 us | 152.191 us |
| `event_batch`      | `tdbin_encode_bare`          |      50 |  5842.968 ms |  39.326 us |  38.628 us |  40.455 us |
| `event_batch`      | `tdbin_encode_framed`        |      50 |  3370.017 ms |  36.348 us |  36.063 us |  36.593 us |
| `event_batch`      | `tdbin_encode_packed_framed` |      50 |  5031.737 ms |  52.324 us |  52.166 us |  52.561 us |
| `event_batch`      | `protobuf_encode`            |      50 |  6664.293 ms |  81.632 us |  79.430 us |  86.327 us |
| `event_batch`      | `msgpack_encode`             |      50 |  5853.691 ms | 174.450 us | 161.878 us | 197.442 us |
| `event_batch`      | `tdbin_decode_bare`          |      50 |  5652.191 ms | 262.857 us | 239.518 us | 319.617 us |
| `event_batch`      | `tdbin_decode_framed`        |      50 |  3370.821 ms | 229.887 us | 216.825 us | 282.880 us |
| `event_batch`      | `tdbin_decode_packed_framed` |      50 |  5315.300 ms | 207.471 us | 206.503 us | 208.507 us |
| `event_batch`      | `protobuf_decode`            |      50 |  5034.757 ms | 282.271 us | 279.410 us | 283.316 us |
| `event_batch`      | `msgpack_decode`             |      50 |  6327.182 ms | 389.899 us | 387.274 us | 413.054 us |

## Same-Mode Comparison

Ratios are Protobuf median / TDBIN median; values above 1.00x favor TDBIN. The gate requires size no larger than Protobuf and both encode and decode ratios at least 1.50x.

| Fixture            | TDBIN mode    | Size winner | Encode ratio | Decode ratio | Gate |
| ------------------ | ------------- | ----------- | -----------: | -----------: | ---- |
| `with_address`     | bare          | Protobuf    |        0.53x |        1.02x | FAIL |
| `with_address`     | framed        | Protobuf    |        0.51x |        0.95x | FAIL |
| `with_address`     | packed framed | Protobuf    |        0.26x |        0.25x | FAIL |
| `without_address`  | bare          | Protobuf    |        0.53x |        0.78x | FAIL |
| `without_address`  | framed        | Protobuf    |        0.57x |        0.84x | FAIL |
| `without_address`  | packed framed | Protobuf    |        0.21x |        0.12x | FAIL |
| `metric_batch`     | bare          | TDBIN       |        3.96x |        5.84x | PASS |
| `metric_batch`     | framed        | TDBIN       |        3.87x |        3.56x | PASS |
| `metric_batch`     | packed framed | TDBIN       |        2.00x |        0.97x | FAIL |
| `person_batch`     | bare          | TDBIN       |        1.26x |        1.67x | FAIL |
| `person_batch`     | framed        | TDBIN       |        1.62x |        1.34x | FAIL |
| `person_batch`     | packed framed | TDBIN       |        0.98x |        1.47x | FAIL |
| `contact_batch`    | bare          | TDBIN       |        3.50x |        2.39x | PASS |
| `contact_batch`    | framed        | TDBIN       |        3.51x |        2.59x | PASS |
| `contact_batch`    | packed framed | TDBIN       |        2.18x |        2.39x | PASS |
| `diagram_document` | bare          | TDBIN       |        1.43x |        2.02x | FAIL |
| `diagram_document` | framed        | TDBIN       |        1.52x |        1.68x | PASS |
| `diagram_document` | packed framed | TDBIN       |        1.17x |        1.44x | FAIL |
| `event_batch`      | bare          | TDBIN       |        2.08x |        1.07x | FAIL |
| `event_batch`      | framed        | TDBIN       |        2.25x |        1.23x | FAIL |
| `event_batch`      | packed framed | TDBIN       |        1.56x |        1.36x | FAIL |

Passing fixture/mode combinations: 6 of 21.

This secondary table exposes unpacked tradeoffs; it does not replace the packed-framed specification gate above.

## Commands

- `cargo bench -p tdbin --bench gate -- --noplot`
- `node scripts/tdbin-bench-report.mjs`

Corpus schemas:

- `docs/benchmarks/tdbin-corpus.td`
- `docs/benchmarks/tdbin-corpus.proto`
