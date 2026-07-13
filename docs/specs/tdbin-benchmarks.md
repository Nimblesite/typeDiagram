# TDBIN Benchmarks

TDBIN is typeDiagram's compact binary codec for algebraic data types, measured here against **Protocol Buffers** and **MessagePack** on realistic workloads. Every number is data-derived — produced by `scripts/tdbin-bench-report.mjs` from Criterion timings and exact encoder output — and regenerates on each benchmark run.

## The three formats

**TDBIN (framed)** is a self-describing frame around typeDiagram's columnar layout; it drops the per-field tags the others repeat on every record, so on batches of the same shape — telemetry, event streams, repeated records — it is both the smallest and the fastest here, and it is the format to reach for when you control both ends and your data is list- or record-heavy.

**Protocol Buffers** is schema-driven with a tag per field, extremely compact and fast on small sparse messages and the industry default for cross-language RPC over a shared `.proto`, so reach for it when messages are small, schemas are shared, and you need the broadest ecosystem.

**MessagePack** is schemaless and self-describing (`struct-as-map`, via `rmp-serde`); it carries field names on the wire so it is the largest and slowest of the three, but it needs no schema at all and any language can read it, which makes it the pick for loosely-typed interchange, config blobs, or wherever a schema is impractical.

## Results

Each table is one committed **corpus** workload. Rows are the three formats; columns are the encoded size and the whole-operation timings. TDBIN is shown in its **framed** production mode — the self-describing peer of the other two.

### list-heavy telemetry

4,096 items. Lower is better in every column. "Serialize" is the whole ADT→binary conversion, "Deserialize" the whole binary→ADT conversion, and "Round-trip" the two summed.

| Format         | Size (bytes) | Serialize | Deserialize | Round-trip |
| -------------- | -----------: | --------: | ----------: | ---------: |
| tdbin (framed) |       43,788 | 11.637 us |    6.251 us |  17.888 us |
| protobuf       |       84,149 | 45.467 us |   31.317 us |  76.784 us |
| msgpack        |       90,440 | 43.944 us |   50.870 us |  94.814 us |

### record-heavy diagram document

768 items. Lower is better in every column. "Serialize" is the whole ADT→binary conversion, "Deserialize" the whole binary→ADT conversion, and "Round-trip" the two summed.

| Format         | Size (bytes) | Serialize | Deserialize | Round-trip |
| -------------- | -----------: | --------: | ----------: | ---------: |
| tdbin (framed) |       45,172 | 12.340 us |   71.705 us |  84.046 us |
| protobuf       |       50,788 | 21.809 us |  110.587 us | 132.396 us |
| msgpack        |       77,410 | 55.735 us |  134.250 us | 189.985 us |

### union-heavy event stream

2,048 items. Lower is better in every column. "Serialize" is the whole ADT→binary conversion, "Deserialize" the whole binary→ADT conversion, and "Round-trip" the two summed.

| Format         | Size (bytes) |  Serialize | Deserialize | Round-trip |
| -------------- | -----------: | ---------: | ----------: | ---------: |
| tdbin (framed) |      116,372 |  35.490 us |  201.602 us | 237.093 us |
| protobuf       |      131,744 |  66.930 us |  279.422 us | 346.352 us |
| msgpack        |      230,620 | 138.809 us |  387.002 us | 525.811 us |

## Methodology

- **Same values, three encoders.** Every fixture builds one logical value; the exact same value is fed to the TDBIN codec, to a hand-written Protobuf mirror (`prost`), and — via `serde` derives on that same mirror — to MessagePack (`rmp-serde`). No format gets a different or more favorable input.
- **Self-describing modes compared.** TDBIN _framed_, Protobuf, and MessagePack _struct-as-map_ are all self-describing, so the comparison is like-for-like. (TDBIN's smaller _packed_ mode and the tiny single-message stress fixtures appear in the full report, not here.)
- **Sizes are exact byte counts** from each encoder — not estimates.
- **Timings are Criterion medians** over 50 samples per operation on the environment below; each measured value flows through `black_box` so the optimizer cannot elide the work. Round-trip is the encode median plus the decode median.
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
