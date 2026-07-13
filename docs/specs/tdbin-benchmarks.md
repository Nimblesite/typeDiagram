# TDBIN Benchmarks

TDBIN is the compact binary codec typeDiagram generates for algebraic data types. This page compares it against two widely used serialization formats — **Protocol Buffers** and **MessagePack** — on realistic workloads, so you can judge what the format buys you.

Numbers below are measured, not estimated: they are produced by `scripts/tdbin-bench-report.mjs` from Criterion timings and exact encoder output, and regenerate whenever the benchmark runs. For the full breakdown — all wire modes, every fixture, confidence intervals — see the generated benchmark report at `docs/reports/tdbin-bench-report.md`.

## What each format is for

- **TDBIN (framed)** — a self-describing frame around typeDiagram's columnar layout. It shines on _batches of the same shape_ (telemetry rows, event streams, repeated records): the columnar layout lets it skip the per-field tags every other format repeats, so it is both the smallest and the fastest here. Reach for it when you control both ends and your data is list- or record-heavy.
- **Protocol Buffers** — schema-driven, tag-per-field. Extremely compact and fast on _small, sparse messages_ (a single record with optional fields), and the industry default for cross-language RPC with a shared `.proto`. Reach for it when messages are small, schemas are shared, and you need the broadest ecosystem.
- **MessagePack** — schemaless, self-describing (`struct-as-map`, via `rmp-serde`). It carries field names on the wire, so it is the largest and slowest of the three, but it needs _no schema at all_ and any language can read it. Reach for it for loosely-typed interchange, config blobs, or when a schema is impractical.

## Results

The tables use typeDiagram's committed **corpus** workloads — the realistic schemas the release gate is defined on. TDBIN is shown in its **framed** production mode, the self-describing peer of the other two.

### list-heavy telemetry

4,096 items. Lower is better in every column; **1.00x** marks the winner of that column.

| Format         | Size (bytes) |  Size | Encode | Decode |
| -------------- | -----------: | ----: | -----: | -----: |
| tdbin (framed) |       43,788 | 1.00x |  1.00x |  1.00x |
| protobuf       |       84,149 | 1.92x |  3.87x |  3.56x |
| msgpack        |       90,440 | 2.07x |  4.68x |  4.81x |

### record-heavy diagram document

768 items. Lower is better in every column; **1.00x** marks the winner of that column.

| Format         | Size (bytes) |  Size | Encode | Decode |
| -------------- | -----------: | ----: | -----: | -----: |
| tdbin (framed) |       45,172 | 1.00x |  1.00x |  1.00x |
| protobuf       |       50,788 | 1.12x |  1.52x |  1.68x |
| msgpack        |       77,410 | 1.71x |  3.65x |  1.65x |

### union-heavy event stream

2,048 items. Lower is better in every column; **1.00x** marks the winner of that column.

| Format         | Size (bytes) |  Size | Encode | Decode |
| -------------- | -----------: | ----: | -----: | -----: |
| tdbin (framed) |      116,372 | 1.00x |  1.00x |  1.00x |
| protobuf       |      131,744 | 1.13x |  2.25x |  1.23x |
| msgpack        |      230,620 | 1.98x |  4.80x |  1.70x |

## Methodology

- **Same values, three encoders.** Every fixture builds one logical value; the exact same value is fed to the TDBIN codec, to a hand-written Protobuf mirror (`prost`), and — via `serde` derives on that same mirror — to MessagePack (`rmp-serde`). No format gets a different or more favorable input.
- **Self-describing modes compared.** TDBIN _framed_, Protobuf, and MessagePack _struct-as-map_ are all self-describing, so the comparison is like-for-like. (TDBIN's smaller _packed_ mode and the tiny single-message stress fixtures appear in the full report, not here.)
- **Sizes are exact byte counts** from each encoder — not estimates.
- **Timings are Criterion medians** over 50 samples per operation on the environment below; each measured value flows through `black_box` so the optimizer cannot elide the work.
- **Reproduce it yourself** with the commands below; the page and its numbers regenerate together.

### Environment

| Field    | Value                               |
| -------- | ----------------------------------- |
| Platform | darwin 25.5.0 (arm64)               |
| CPU      | Apple M4 Max                        |
| Rust     | rustc 1.97.0 (2d8144b78 2026-07-07) |

### Reproduce

- `cargo bench -p tdbin --bench gate -- --noplot`
- `node scripts/tdbin-bench-report.mjs`
