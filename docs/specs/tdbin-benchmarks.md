# TDBIN Benchmarks

TDBIN is typeDiagram's compact binary codec for algebraic data types, measured here against **Protocol Buffers** and **MessagePack**. Every number below is data-derived — produced by [`scripts/tdbin-bench-report.mjs`](https://github.com/Nimblesite/typeDiagram/blob/main/scripts/tdbin-bench-report.mjs) from Criterion timings and exact encoder output — and regenerates on each benchmark run.

> **Scope: these figures are for the Rust implementation only.** Both the encoded sizes and the speeds are measured against the Rust `tdbin` codec crate ([`crates/tdbin`](https://github.com/Nimblesite/typeDiagram/blob/main/crates/tdbin)), the Rust `prost` Protobuf encoder, and the Rust `rmp-serde` MessagePack encoder. The TDBIN **wire format** and its byte sizes are language-neutral, but serialize/deserialize **speeds** depend on each language's implementation — typeDiagram's other codec targets, and other Protobuf/MessagePack libraries, will differ, sometimes substantially.

## Size and Speed

One row per test. Sizes are exact encoded bytes; "Serialize" is the whole ADT→binary conversion and "Deserialize" the whole binary→ADT conversion, each a Criterion median. typeDiagram is its **framed** production wire mode; MessagePack is struct-as-map (via `rmp-serde`). Lower is better in every column.

| Test               | typeDiagram Size | Protobuf Size | MessagePack Size | typeDiagram Serialize | Protobuf Serialize | MessagePack Serialize | typeDiagram Deserialize | Protobuf Deserialize | MessagePack Deserialize |
| ------------------ | ---------------: | ------------: | ---------------: | --------------------: | -----------------: | --------------------: | ----------------------: | -------------------: | ----------------------: |
| `with_address`     |              172 |            79 |              142 |              87.51 ns |           46.84 ns |             252.33 ns |               153.21 ns |            152.49 ns |               195.31 ns |
| `without_address`  |              124 |            31 |              100 |              65.76 ns |           32.68 ns |             228.84 ns |                71.52 ns |             50.66 ns |               109.68 ns |
| `metric_batch`     |           43,788 |        84,149 |           90,440 |             11.637 us |          45.467 us |             43.944 us |                6.251 us |            31.317 us |               50.870 us |
| `person_batch`     |           22,988 |        29,184 |           61,963 |             11.587 us |          18.195 us |             48.224 us |               36.786 us |            57.952 us |               87.828 us |
| `contact_batch`    |           23,156 |        35,221 |           80,162 |              9.025 us |          24.957 us |             69.630 us |               31.045 us |            61.434 us |               95.623 us |
| `diagram_document` |           45,172 |        50,788 |           77,410 |             12.340 us |          21.809 us |             55.735 us |               71.705 us |           110.587 us |              134.250 us |
| `event_batch`      |          116,372 |       131,744 |          230,620 |             35.490 us |          66.930 us |            138.809 us |              201.602 us |           279.422 us |              387.002 us |

## What the numbers show

The following are read directly off the table above — each is a comparison of the measured values, nothing more:

- **`with_address`** (tiny nested record and union, 1 item): smallest encoding is **Protobuf**; fastest round-trip is **Protobuf**. typeDiagram's encoding is 0.5× the size of Protobuf and 0.8× the size of MessagePack here (values <1 mean typeDiagram is smaller, >1 larger).
- **`without_address`** (tiny sparse record and union, 1 item): smallest encoding is **Protobuf**; fastest round-trip is **Protobuf**. typeDiagram's encoding is 0.3× the size of Protobuf and 0.8× the size of MessagePack here (values <1 mean typeDiagram is smaller, >1 larger).
- **`metric_batch`** (list-heavy telemetry, 4,096 items): smallest encoding is **typeDiagram**; fastest round-trip is **typeDiagram**. typeDiagram's encoding is 1.9× the size of Protobuf and 2.1× the size of MessagePack here (values <1 mean typeDiagram is smaller, >1 larger).
- **`person_batch`** (repeated records, 512 items): smallest encoding is **typeDiagram**; fastest round-trip is **typeDiagram**. typeDiagram's encoding is 1.3× the size of Protobuf and 2.7× the size of MessagePack here (values <1 mean typeDiagram is smaller, >1 larger).
- **`contact_batch`** (repeated unions, 2,048 items): smallest encoding is **typeDiagram**; fastest round-trip is **typeDiagram**. typeDiagram's encoding is 1.5× the size of Protobuf and 3.5× the size of MessagePack here (values <1 mean typeDiagram is smaller, >1 larger).
- **`diagram_document`** (record-heavy diagram document, 768 items): smallest encoding is **typeDiagram**; fastest round-trip is **typeDiagram**. typeDiagram's encoding is 1.1× the size of Protobuf and 1.7× the size of MessagePack here (values <1 mean typeDiagram is smaller, >1 larger).
- **`event_batch`** (union-heavy event stream, 2,048 items): smallest encoding is **typeDiagram**; fastest round-trip is **typeDiagram**. typeDiagram's encoding is 1.1× the size of Protobuf and 2× the size of MessagePack here (values <1 mean typeDiagram is smaller, >1 larger).

## Methodology

- **Rust implementations.** Every timing is for a Rust codec: typeDiagram's [`tdbin`](https://github.com/Nimblesite/typeDiagram/blob/main/crates/tdbin) crate, Protobuf via `prost`, and MessagePack via `rmp-serde`. Encoded sizes are a property of the wire format and hold across languages; speeds do not — typeDiagram's other language targets and other Protobuf/MessagePack libraries will produce different timings.
- **Same values, three encoders.** Every test builds one logical value and feeds the identical value to the typeDiagram codec, to a hand-written Protobuf mirror (`prost`), and — via `serde` derives on that same mirror — to MessagePack (`rmp-serde`). No format receives a different input. See the fixtures in [`crates/tdbin/tests/support/bench_corpus.rs`](https://github.com/Nimblesite/typeDiagram/blob/main/crates/tdbin/tests/support/bench_corpus.rs).
- **Self-describing modes only.** typeDiagram _framed_, Protobuf, and MessagePack _struct-as-map_ all carry enough structure to be decoded without an external schema, so the comparison is like-for-like.
- **Sizes are exact byte counts** emitted by each encoder (see [`crates/tdbin/examples/bench_data.rs`](https://github.com/Nimblesite/typeDiagram/blob/main/crates/tdbin/examples/bench_data.rs)) — not estimates.
- **Timings are Criterion medians** over 50 samples per operation; each measured value flows through `black_box` so the optimizer cannot elide the work. The benchmark harness is [`crates/tdbin/benches/gate.rs`](https://github.com/Nimblesite/typeDiagram/blob/main/crates/tdbin/benches/gate.rs).
- **Corpus schemas** are committed at [`docs/benchmarks/tdbin-corpus.td`](https://github.com/Nimblesite/typeDiagram/blob/main/docs/benchmarks/tdbin-corpus.td) and [`docs/benchmarks/tdbin-corpus.proto`](https://github.com/Nimblesite/typeDiagram/blob/main/docs/benchmarks/tdbin-corpus.proto).

## Test machine

| Field        | Value                               |
| ------------ | ----------------------------------- |
| Platform     | darwin 25.5.0 (arm64)               |
| CPU          | Apple M4 Max                        |
| Logical CPUs | 14                                  |
| Memory       | 36.0 GiB                            |
| Rust         | rustc 1.97.0 (2d8144b78 2026-07-07) |
| Cargo        | cargo 1.97.0 (c980f4866 2026-06-30) |

## Reproduce

Run the benchmark, then regenerate this page:

- `cargo bench -p tdbin --bench gate -- --noplot`
- `node scripts/tdbin-bench-report.mjs`
