# typeDiagram Binary Format — Research (RAW)

> **Status:** raw research dump. Not a spec. Feeds the future `[TDBIN-*]` spec.
> **Goal:** a cross-language binary serialization format for typeDiagram ADTs (records + tagged unions) that is **smaller AND faster than Protobuf/gRPC** — both axes, no excuses.
> **Method:** deep-research fan-out over authoritative sources (peer-reviewed papers — IPL, VLDB, SIGMOD, SPE; format authors' own specs/design rationale; Lemire's integer-decoding work). 118 claims, adversarially verified. Sources listed at the bottom, each numbered `[Sn]`.
> **Scope note:** typeDiagram is the _definition language_ (the schema). This doc is about the _wire format_ the schema compiles to. Rust + TypeScript are the first codegen targets, but the format is language-neutral by design.
> **Roadmap note:** the format will grow **bidirectional streaming** and become an **RPC framework (gRPC-class)**. That is a second, distinct literature (framing, multiplexing, flow control, promise pipelining) — captured at interim depth in §6, with a dedicated research pass running to deepen it. It reshapes several §4 decisions _now_, so it is not deferred.

---

## 0. TL;DR — how we beat Protobuf on both axes

Protobuf pays two taxes on **every message**:

1. **A per-field tag varint** (field number + wire type), plus a length varint for every length-delimited field. This is pure overhead repeated on the wire millions of times. `[S9][S15]`
2. **A full decode pass** — every field is parsed out of varints and materialized into heap objects before you can read anything. `[S9][S18][S19]`

The state of the art kills each tax with a different family of format, but **each family loses the other axis**:

- **Zero-parse formats (Cap'n Proto, FlatBuffers, SBE)** kill tax #2 — in-memory layout == wire layout, no decode step → decode is ~free (FlatBuffers is **~3,700× faster** than Protobuf on decode+traverse `[S17]`, **~60× faster** decode in Go `[S16]`). **But** fixed-width fields + alignment padding make them **bigger** than Protobuf (FlatBuffers 344 B vs Protobuf 228 B for the same object — ~50% larger `[S17]`; 432 B vs 299 B in `[S16]`).
- **Varint/columnar formats (Protobuf, Parquet, ORC)** kill wire size — but pay tax #2 in decode CPU (LEB128 branch-mispredicts; heavy encoding = up to **4.2× scan penalty** `[S12]`).

**Our thesis: you can have both, because the two taxes are independent.** The winning recipe is:

1. **Schema-known, layout-fixed body (Cap'n Proto/SBE style)** → _no field tags on the wire at all._ Kills tax #1 → smaller than Protobuf. `[S9][S10]`
2. **Zero-parse / verify-on-access reads** → point into the buffer, don't materialize. Kills tax #2 → faster than Protobuf. `[S9][S17][S18]`
3. **Recover the padding that would otherwise make us bigger** via Cap'n Proto's XOR-with-default + word-packing trick (worst case **2 bytes per 2 KiB** overhead, mostly SIMD-friendly zero-run removal). `[S10]`
4. **SIMD-friendly integer/bit encodings on the hot path** — bit-packing (SIMD-BP128 is _both_ ~2× faster than varint-G8IU _and_ up to 2 bits/int smaller `[S13]`) and stream-vbyte (control/data split, >4B ints/s `[S2][S3]`) — never scalar LEB128.
5. **Sub-byte packing** for bits and small union discriminants (8 bools/byte `[S10]`; a 4-variant union needs **2 bits**, not a tag byte + varint).
6. **Column-orient arrays of records** (ADT-shaped repeated data): ~13% smaller _and_ O(1) random access _and_ SIMD-scannable. `[S8][S6]`

The result is a format that is **schema-driven like Protobuf** (so it stays small) but **decode-free like Cap'n Proto** (so it stays fast), with the size-cost of zero-copy clawed back by packing and sub-byte encoding.

---

## 1. The size ↔ speed Pareto — three regimes

Not every choice is a tradeoff. Sort every technique into one of three buckets and the design writes itself.

### Regime A — Free wins (smaller AND faster; take all of them)

| Technique                                 | Why it wins both                                                                                                                  | Source          |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| Drop per-field tags (schema-known layout) | Fewer bytes _and_ no tag-parse branch                                                                                             | `[S9][S10]`     |
| Zero-parse / verify-on-access             | No decode step; also no allocation (FlatBuffers stores decoded wire in **0 bytes / 0 blocks** vs Protobuf-LITE 760 B / 20 blocks) | `[S17]`         |
| SIMD bit-packing (SIMD-BP128)             | ~2× faster than varint-G8IU _and_ saves up to 2 bits/int, ~1.5 cycles/int                                                         | `[S13]`         |
| Bit-pack bools & small enums              | 8 bools/byte; 2-bit discriminant                                                                                                  | `[S10]`         |
| Column layout for record arrays           | 13% smaller (length/presence) _and_ SIMD-scannable _and_ O(1) access                                                              | `[S8][S6][S19]` |
| Store field XOR default                   | New/absent fields = zeros → free defaults _and_ packing deflates them                                                             | `[S10]`         |

### Regime B — Real tradeoffs (pick a point; make it a knob)

| Axis            | Small end                     | Fast end                                 | Where the data says to sit                                                                                                                                                                       |
| --------------- | ----------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Integer width   | LEB128 varint (compact)       | Fixed-width (no branch)                  | **Varint for cold scalars, SIMD bit-pack for hot arrays.** Scalar LEB128 mispredicts: a Haswell mispredict is **15+ cycles** `[S11]`.                                                            |
| Alignment       | Tight-packed (small)          | Word-aligned (zero-copy)                 | **Align in-memory, pack on the wire** (Cap'n Proto packing recovers padding at 2 B/2 KiB worst case) `[S10]`.                                                                                    |
| Compression     | zstd/Snappy (8× smaller)      | None (fast)                              | **None by default.** Block compression = up to **4.2× scan overhead** `[S12]`; on modern storage the bandwidth saving doesn't pay for decode CPU `[S12]`. Optional zstd _layer_, never the base. |
| Nested encoding | length/presence (13% smaller) | rep/def levels (read only target column) | **length/presence for our row-ish reads; rep/def only if we go deep-columnar** `[S8]`.                                                                                                           |

### Regime C — Anti-patterns (avoid; they lose a axis for little gain)

- **Multiple integer encodings switched at decode time** (ORC does 4) → **3× more branch mispredictions, 4× more subsequences** than Parquet's simpler scheme → slower. Keep the decode critical path _uniform_. `[S12]`
- **RLE for short runs** → hard to SIMD, slower than bit-packing when repetition counts are small. `[S12]`
- **General-purpose byte compressors on integer arrays** → specialized integer codecs are an _order of magnitude_ faster than Snappy while compressing better. `[S13]`

---

## 2. Hard benchmark numbers (the Pareto, measured)

These are the head-to-head numbers that anchor "faster and smaller than Protobuf" in reality, not vibes.

### 2.1 FlatBuffers vs Protobuf-LITE — official FlatBuffers benchmark `[S17]`

| Metric                           | FlatBuffers        | Protobuf-LITE     | Ratio              |
| -------------------------------- | ------------------ | ----------------- | ------------------ |
| Decode + traverse + dealloc, 1M× | **0.08 s**         | 302 s             | **~3,700× faster** |
| Encode 1M objects                | **3.2 s**          | 185 s             | ~58× faster        |
| Memory to store decoded wire     | **0 B / 0 blocks** | 760 B / 20 blocks | zero-alloc         |
| Wire size (uncompressed)         | 344 B              | **228 B**         | FB ~50% _bigger_   |
| Wire size (zlib)                 | 220 B              | **174 B**         | FB bigger          |

➡️ **Lesson:** zero-copy crushes decode but _loses on size_. We must reclaim size (§4).

### 2.2 Go: Protobuf vs FlatBuffers vs Cap'n Proto — `[S16]`

| Metric       | Protobuf | gogofaster | FlatBuffers | Cap'n Proto | capnp-packed |
| ------------ | -------- | ---------- | ----------- | ----------- | ------------ |
| Decode ns/op | 1179     | 496.2      | **18.89**   | 830.8       | 1716         |
| Encode ns/op | 883.8    | **384.4**  | 856.8       | 1709        | 2591         |
| Wire bytes   | 299      | 299        | 432         | 440         | 344          |

➡️ **Lesson:** the zero-copy win is concentrated on **decode/read**. FlatBuffers _encode_ is slower than Protobuf. Cap'n Proto **packed** cuts 440→344 B but ~doubles both encode and decode → packing is a size/speed knob, not free.

### 2.3 Rust: same benchmark — `[S16]`

| Metric       | rust-protobuf | prost  | FlatBuffers |
| ------------ | ------------- | ------ | ----------- |
| Decode ns/op | 751.61        | 1058.7 | **331.12**  |
| Encode ns/op | —             | 642.90 | 878.02      |

➡️ **Lesson:** the decode edge is **only ~2–3× in Rust** vs ~60× in Go → _implementation/language quality dominates absolute numbers._ Our Rust + TS codegen quality matters as much as the format.

### 2.4 Rust serialization benchmark (djkoloski) — `[S15]`

- **Zero-copy access:** rkyv **1.2450 ns**, matched by nibblecode → nanosecond field access vs microsecond parse-based formats.
- **Fastest encode/decode:** Bitcode (tag-free) — 138.30 µs ser, 1.4597 ms deser — beats Protobuf, bincode, MessagePack.
- **Smallest:** Compactly (bit-packing) 239,520 B vs Bitcode 703,710 B → **smallest ≠ fastest** (different formats win each axis).
- Protobuf variants (prost, 3.7.2, 4.35.1): "higher overhead from schema/tag processing" — neither smallest nor fastest.

### 2.5 Empirical eval of 13 serializers (arXiv 2407.13494, 2024) — `[S18]`

- **Cap'n Proto: fastest serialize AND deserialize of all 13** (beats Protobuf, Thrift, Avro, MessagePack, CBOR, BSON, text) — because in-memory repr == encoded repr, no serialize step.
- On **size**, capnp-packed / Protobuf / CBOR / BSON / UBJSON / Thrift are all competitive; Pickle/Avro/XML worst.
- Thrift best raw throughput; MessagePack best _schemaless_.

---

## 3. Findings by topic (with the authoritative detail)

### 3.1 Zero-copy / zero-parse formats

- **Cap'n Proto core principle:** data laid out identically in memory and on the wire → eliminates encode/decode entirely. `[S9]`
- **Cap'n Proto struct layout:** fixed body = **data section** (scalars) followed by **pointer section**; struct pointer carries data-size and pointer-size in words; everything word-aligned so intra-segment relative pointers are followed without parsing. `[S10]`
- **FlatBuffers:** nested objects addressed by offsets, traversed in-place, no unpack step. Tables use a **vtable** recording where each field lives (vs Protobuf field IDs); missing/deprecated fields resolve to defaults; a table can cost _less_ than a struct because default-valued fields aren't stored. `[S22][S1]`
- **Arrow:** columnar, O(1) random access, **relocatable without pointer swizzling** → true zero-copy in shared memory. `[S5]`
- **The catch (all zero-copy):** fixed-width + alignment ⇒ padding, which can **double or triple** message size; Protobuf avoids padding _only because_ it accepts a separate encode/decode step. `[S9]` Arena allocation is forced — you can't free individual objects, only the whole arena. `[S9]`
- **"Real zero-copy" caveat:** the term is often overstated — variable-length/validation still costs; treat zero-copy as "no materialization on read," not literally zero work. `[S20]`

### 3.2 Fast integer decoding (the varint problem)

- **Why scalar LEB128 is slow:** variable length ⇒ unpredictable per-byte branches ⇒ branch mispredictions + pipeline stalls + no vectorization. A Haswell mispredict = **15+ cycles**; worst when 1-byte and 2-byte values interleave so the length branch is unpredictable. `[S11][S3]`
- **Stream VByte (Lemire, IPL 2018):** _separates the control stream (length descriptors) from the data bytes_ → SIMD can batch-decode. **>4 billion ints/s** on 3.4 GHz Haswell, **up to 2× faster than varint-G8IU**, at times **exceeding memcpy**. Patent-free. `[S2][S3]`
- **Masked VByte:** SIMD-decodes the _unmodified_ VByte wire format 2–4× faster (650–2700 M ints/s vs 300–1100 scalar) using `pmovmskb` to pull continuation bits into a mask, then a `pshufb` shuffle table. No wire change needed. `[S4]`
- **SIMD-BP128 (Lemire & Boytsov, SPE 2015):** vectorized **bit-packing** decodes **~2.3 billion 32-bit ints/s at ~1.5 cycles/int**, nearly **2× faster than varint-G8IU/PFOR** _and_ saves up to **2 bits/int**. The both-axes proof. Companion **SIMD-FastPFOR**: within 10% of Simple-8b's ratio but **2× faster decode**. Even the prefix-sum (delta) step must be vectorized to cross 2B ints/s. `[S13]`
- **SFVInt (2024):** decodes LEB128 up to **2× faster than Protobuf/Folly** varint decoders using BMI2 **PEXT/PDEP** to extract continuation bits in parallel, ~500 LOC, handles 32- and 64-bit in one generic path. Gain is workload-dependent (2× on skewed W4, 45% W3, 19% W2). `[S14]`
- **varint-simd (Rust):** branchless SIMD LEB128 — 554 M u8/s single, **896 M u8/s** 8× batch, beats prost / rustc / integer-encoding-rs. Provides zigzag for Protobuf compatibility. **CPU-feature dependent:** SSSE3 min, optionally POPCNT/LZCNT/BMI2/AVX2. `[S7]`
- ⚠️ **Portability tax:** all the fastest decoders are x86 SIMD/BMI2. TS/WASM and ARM need fallbacks → the wire format must be **fast to decode _scalar_ too** (favors fixed-width + bit-packing over exotic varints on the hot path).

### 3.3 Tagged unions / sum types on the wire

- **Arrow dense union:** `int8` type-id buffer + `int32` offsets buffer into per-variant child arrays → stores **only the present variant's value**. **Sparse union:** every child array is full-length (no offsets) — simpler random access, wastes space. `[S5]`
- **PLUR (arXiv 1708.08319):** a minimal ADT type system of exactly **4 constructors — Primitive, List, Union (sum), Record (product)** — encodes a Union as a **tag array + per-variant data arrays** (Arrow dense union). Crucially: **the schema can be a naming convention on the arrays — zero per-object type metadata.** Zero-copy on a memory-mapped file, no materialization → analysis ran at 6–18 MHz vs **0.4 MHz** for full object materialization (**~15–45×**). `[S6]`
- **Discriminant sizing:** a tagged union with _N_ variants needs ⌈log₂N⌉ bits. Cap'n Proto/typeDiagram should **bit-pack the discriminant** (2 bits for ≤4 variants) rather than spend a tag byte + varint like Protobuf `oneof`. Tagged-union theory: the discriminant + payload, discriminant packed into spare bits where the payload leaves room. `[S21]`

### 3.4 Bit-packing / sub-byte fields

- **Cap'n Proto:** 8 `Bool`s per byte, little-endian bit order (first bit = LSB of first byte). `[S10]`
- **Arrow validity bitmap:** 1 bit/value, LSB numbering, 1 = non-null — a 5-element array's null mask is **5 bits**. `[S5][S6]`
- **XOR-with-default:** Cap'n Proto stores each data field XOR'd with its schema default → absent/new fields read back as default at **zero storage**, and the buffer becomes mostly zeros → the packing compressor deflates it. `[S10]`
- **Cap'n Proto packing:** each 8-byte word → 1 tag byte + 0–8 non-zero content bytes (zero bit in tag ⇒ omit that byte), plus run-length tags for all-zero and all-dense spans. **Worst case: 2 bytes per 2 KiB.** Cheap, streaming, SIMD-able. `[S10]`

### 3.5 Columnar vs row layout

- **Dremel (VLDB 2020):** across **65 Google datasets**, **length/presence encoding (ORC/Arrow) is on average 13% smaller** than rep/def-level encoding. Tradeoff: rep/def is self-contained per column (read _only_ the target column); length/presence needs the target's **ancestor columns** → extra I/O/seeks. `[S8]`
- **Row reordering to lengthen RLE runs:** 17% avg byte savings across 40 datasets (up to 75%); optimal reordering is **NP-complete** → heuristics/sampling. `[S8]`
- **Arrow vs Parquet:** Parquet uses Dremel shredding + varlen encoding + block compression → drastically smaller **but sacrifices random access**; Arrow is the in-memory, decode-free counterpart. Parquet encodes nulls as **16-bit definition levels** (+ compression); Arrow as a **1-bit validity mask**. `[S1]`
- **Columnar CPU win:** processing large contiguous blocks _without intervening conditional branches_ is the core analytics speedup — directly attacks branch-misprediction cost. `[S1]`
- **When to column-orient in typeDiagram:** arrays of records / repeated fields (ADT-shaped bulk data). Single records stay row-ish. `[S6]`

### 3.6 Storage-format tradeoff studies (the "don't over-compress" evidence)

- **Columnar Storage Formats (VLDB 2023):** on modern hardware **favor fast decode over compression ratio**; **do NOT apply block compression (Snappy/zstd) by default** — bandwidth savings don't justify decode CPU. Block compression = up to **4.2× scan overhead**. Keep the decode path _uniform_ (ORC's 4 switched encodings cost 3× mispredicts). Parquet bit-unpacks with SIMD + codegen to avoid branches. `[S12]`
- **Data Formats in Analytical DBMSs (2024):** encoding-heavy formats pay a heavy read penalty. Arrow is **fastest to deserialize** (no decode). Encoding buys ~8× smaller (Parquet CR 0.13, ORC 0.27 vs Arrow 1.07, dict-Arrow 0.48) but loses random access. **No single format is optimal across compress/deserialize/access → co-design in-memory + on-disk for the target workload.** `[S19]`

### 3.7 Schema evolution vs compactness

- **Protobuf's cost of evolution:** the per-field tag varint _is_ the evolution mechanism (unknown fields skipped by tag) — that's the tax we remove. So our evolution has to come from **layout**, not tags.
- **Cap'n Proto (compact + evolvable):** field byte-position depends only on its own definition + lower-numbered fields, **never higher-numbered** → new fields append into leftover padding; XOR-with-default makes absent fields read correctly. Backward _and_ forward compatible **with no tags**. `[S10]` ⬅️ **this is our evolution model.**
- **FlatBuffers:** vtable indirection; new fields appended at end (or explicit `id`); **fields can never be removed — only `deprecated`** (slot preserved); defaults omitted from wire so **changing a default breaks old data**; type change only allowed if same byte width (sign changes unsafe); adding tables/vectors/structs always safe; new union variants appended. `[S23]`

### 3.8 Verify-on-access safety (the cost of skipping parse)

- **FlatBuffers/flatcc:** no bounds checking unless you **explicitly** call the verifier; verification is a **full O(n) pass**. `[S9][S24]`
- **What verification does _not_ guarantee:** it proves the buffer is **safe to read (not write)**, **not** that it has the correct type — a wrong-typed buffer that passes may yield garbage, not a crash. `[S24]`
- **Attack surface:** deep nesting ⇒ stack-recursion DoS (flatcc hard-limits ~100 levels); shared references (DAGs) can unfold **exponentially** on copy/print even when read-safe; in-place modification is unsafe even after verification. `[S24]`
- **Cap'n Proto stance:** validation-as-anti-feature — bounds are checked lazily _on pointer traversal_ rather than up-front, so you pay only for what you read. `[S25]`
- ➡️ **typeDiagram implication:** ship a **fast O(n) verifier** + typed buffer header (magic + schema hash) + depth limit; make verify **opt-in for trusted, mandatory for untrusted** input.

---

## 4. Design blueprint for the typeDiagram binary format

Synthesizing the above into a concrete, both-axes-winning design. (Working name: **TDBIN**. Spec IDs will be `[TDBIN-*]`.)

### 4.1 Primitive types (tight, as the DSL demands)

| DSL type            | Wire                                      | Notes                                                        |
| ------------------- | ----------------------------------------- | ------------------------------------------------------------ |
| `bit` / `bool`      | 1 bit, packed 8/byte                      | Cap'n Proto style, LE bit order `[S10]`                      |
| `u8…u64`, `i8…i64`  | fixed-width LE                            | fixed on hot path (no branch); zigzag for signed varint mode |
| `f32` / `f64`       | IEEE-754 LE fixed                         |                                                              |
| `int` (cold scalar) | LEB128 varint (optional)                  | only where size matters and it's not a hot array             |
| `string`            | offset + length into a data region, UTF-8 | Arrow-style `offsets[j+1]-offsets[j]` for O(1) `[S5]`        |
| `bytes`             | offset + length                           | same                                                         |
| enum (≤N variants)  | ⌈log₂N⌉ bits, packed                      | 2 bits for 4 variants                                        |

### 4.2 Records (product types)

- **Fixed body = data section (scalars, bit-packed) + pointer/offset section (variable-length children).** Cap'n Proto layout. `[S10]`
- **No field tags.** Field position is schema-derived; depends only on own + lower-numbered fields → append-only evolution. `[S10]`
- **Store scalars XOR default** → absent/new fields free; buffer trends to zeros. `[S10]`
- Word-align **in memory**; **pack on the wire** (§4.5).

### 4.3 Tagged unions (sum types) — the ADT heart

- **Discriminant:** ⌈log₂N⌉ bits, packed into the record's bit region (not a byte tag). `[S21]`
- **Payload:** only the present variant is stored (dense-union semantics). `[S5][S6]`
- **Arrays of unions:** dense-union columnar — a discriminant column + per-variant data columns. `[S6]`

### 4.4 Arrays of records (bulk ADT data) — go columnar

- **Struct-of-arrays** for repeated records: each field its own contiguous buffer → SIMD scan, O(1) random access, 13% smaller via length/presence nesting. `[S6][S8][S19]`
- **Nulls:** 1-bit validity mask per column (Arrow). `[S5]`
- **Hot integer columns:** SIMD bit-packing (SIMD-BP128 family) — smaller _and_ faster; scalar fallback stays branch-light. `[S13]`
- Keep the decode path **uniform** — one integer encoding per column, not switched. `[S12]`

### 4.5 The size-recovery layer (so we beat Protobuf on bytes)

- **Wire packing** (Cap'n Proto scheme): strip zero bytes word-by-word, 2 B/2 KiB worst case. Turns the padding/zeros from fixed layout + XOR-default into near-zero overhead. `[S10]`
- **NO block compression by default** (4.2× scan penalty). Optional `zstd` as an outer, explicit layer for cold storage/transport only. `[S12][S19]`

### 4.6 Safety

- Typed buffer header: magic + schema hash + version.
- **Fast O(n) verifier**, opt-in for trusted / required for untrusted. `[S9][S24]`
- Depth limit (~100) against recursion DoS; reject DAG expansion on copy. `[S24]`

### 4.7 Cross-language decode strategy

- Wire format must decode **fast scalar** (TS/WASM/ARM) _and_ SIMD-accelerated (native x86/ARM-NEON) — fixed-width + bit-packing satisfy both; exotic SIMD-only varints do not. `[S7][S14]`
- Codegen quality dominates absolute perf (§2.3) → invest in the Rust and TS generators, not just the format.

---

## 5. Open questions / risks to resolve in the spec

1. **Random access vs streaming:** SBE forbids random access (preorder, no offsets) but is maximally compact/fast to write; Cap'n Proto uses pointers for random access at a size cost `[S9]`. typeDiagram likely wants **pointer-based random access** for the general case — confirm against target workloads.
2. **Alignment target:** 8-byte (Cap'n Proto word) vs 64-byte (Arrow SIMD) `[S5]`. 64-byte helps SIMD scans but bloats small messages — probably **8-byte for messages, 64-byte for columnar bulk buffers**.
3. **Varint on cold scalars — worth the branch?** Measure: does LEB128 on cold fields save enough bytes to justify the misprediction risk vs fixed-width + wire packing?
4. **Evolution guarantees to promise:** adopt Cap'n Proto's "append into padding, XOR default" rules exactly `[S10]`; decide FlatBuffers-style "never remove, only deprecate" `[S23]`.
5. **Which SIMD integer codec** to standardize the columnar hot path on: SIMD-BP128 (both-axes best `[S13]`) vs Stream VByte (memcpy-speed, simpler `[S2]`) — likely **bit-packing primary, stream-vbyte fallback**.
6. **Nested encoding:** length/presence (13% smaller, needs ancestors) vs rep/def (read-one-column) `[S8]` — depends on whether we expect column-selective reads.
7. **Transport for the RPC layer (§6):** ride HTTP/2-then-HTTP/3 and win on payload only (fast to ship, capped upside) vs a lean custom framing over TCP/QUIC (higher ceiling, more work). Decide after the RPC research pass; either way adopt **QUIC** to beat gRPC's TCP head-of-line blocking, and target **promise pipelining** as the round-trip-collapsing feature gRPC lacks.

---

## 6. Streaming & RPC (forward-looking — the format becomes a gRPC-class framework)

Two-way streaming + an RPC layer is an explicit end goal, so "faster than gRPC" is now a **protocol-level** target, not just a payload-size one. This is a distinct research axis (transport / framing / session), so a dedicated deep-research pass is running to deepen it. Interim implications from the serialization research above:

### 6.0 typeDiagram is the unified IDL (models + functions)

One language defines both sides of the contract — the equivalent of Protobuf's `message` **and** `service`/`rpc` collapsed into typeDiagram:

- **Model / `type` definitions** → the wire ADTs (records + tagged unions) encoded by TDBIN (§4). These are the request/response/stream payloads.
- **Function definitions** → the **RPC service contract**. A typeDiagram function signature _is_ the RPC method: its parameter type(s) and return type are TDBIN-encoded ADTs, and its shape encodes the streaming directionality.
- **Streaming directionality lives in the signature**, not a separate keyword soup — the four gRPC modes map onto function shape:
  | Mode             | typeDiagram function shape       |
  | ---------------- | -------------------------------- |
  | Unary            | `f(Req) -> Resp`                 |
  | Server-streaming | `f(Req) -> Stream<Resp>`         |
  | Client-streaming | `f(Stream<Req>) -> Resp`         |
  | Bidirectional    | `f(Stream<Req>) -> Stream<Resp>` |
- Because functions are first-class typeDiagram definitions, the **method set, argument types, and return types are all schema-known** → the RPC dispatch surface carries **no per-call method-name/tag overhead on the wire** (a numeric method id from the schema, like fields in §4.2), and codegen emits typed client/server stubs for Rust + TS from the same source. This is the RPC analogue of "drop the field tags" (§0): drop the method-name strings too.
- **Promise pipelining (§6.4) is expressible** because a function's return type is a known ADT — a pipelined call references a _field of a not-yet-returned result_ by its schema-known offset.

### 6.1 The streaming ↔ zero-copy tension (decide now, it constrains §4)

- Zero-copy formats that address children by **offset/pointer** (Cap'n Proto, FlatBuffers) generally need a child's size _before_ writing the parent pointer → **back-patching**, which fights forward-only streaming writes. `[S10]`
- **SBE is the streaming-native counter-design:** preorder, forward-only, no random access, no back-patching — built for low-latency financial message streams; the cost is _no random access_. `[S9]`
- ➡️ **Reconcile:** length-prefixed **frames** on the stream (forward-only, SBE-like framing) with Cap'n Proto-style **pointers _inside_ a frame** (random access within a message). Keep the write path forward-only _between_ messages; bound back-patching to _within_ a single message so encode can start emitting frames before the whole stream is built.

### 6.2 Framing

- Streaming needs **message framing** so a reader finds boundaries without parsing content. gRPC uses a **5-byte prefix per message** (1 byte compressed-flag + 4-byte big-endian length) carried over HTTP/2 DATA frames.
- Our frame: `[len][schema-hash/version (once per stream, then elided)][body]`; body stays zero-copy-accessible after the O(n) verify (§3.8).

### 6.3 Multiplexing, flow control, backpressure

- gRPC gets bidirectional streaming, multiplexing, and header compression **for free from HTTP/2** (stream IDs, credit-based flow control, HPACK). To _beat_ it we either (a) ride HTTP/2 / HTTP/3 and win purely on the payload (safe first step), or (b) design leaner framing over raw TCP/QUIC with our own stream IDs + credit-based flow control (higher ceiling, more work).
- **HTTP/3 / QUIC** removes the TCP head-of-line blocking that penalizes multiplexed HTTP/2-over-TCP → the transport target to actually out-latency gRPC.

### 6.4 The protocol-level bar to beat: Cap'n Proto RPC

- Cap'n Proto RPC does what gRPC structurally cannot: **promise pipelining ("time-travel")** — the result of a call can be used as the argument to further calls _before the first returns_, collapsing dependent round-trips into one. That, not payload size, is where "faster than gRPC" is won at the protocol level. (Being quantified in the running research pass.)

### 6.5 What this pins down in the value format _today_

- Messages must be **length-prefixed / self-delimiting** so they compose into a stream.
- Write path **forward-only where possible**, back-patching bounded to within one message → low-latency incremental encode.
- **Schema/version negotiated once per stream**, not per message → the per-message schema-hash header is elided after handshake, reclaiming those bytes.

---

## 7. Sources

Ranked-in tier per the research (primary = peer-reviewed paper / format author's own spec/rationale; blog = author's technical blog; secondary = reference doc).

| #   | Source                                                                                                                                                                                              | Tier      | Date    |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ------- |
| S1  | [Arrow & Parquet Part 1: Primitive Types & Nullability](https://arrow.apache.org/blog/2022/10/05/arrow-parquet-encoding-part-1/)                                                                    | primary   | 2022-10 |
| S2  | [Stream VByte: Faster Byte-Oriented Integer Compression (Lemire, Kurz, Rupp), IPL 2018](https://arxiv.org/abs/1709.08990)                                                                           | primary   | 2018-02 |
| S3  | [Stream VByte: breaking new speed records — Daniel Lemire](https://lemire.me/blog/2017/09/27/stream-vbyte-breaking-new-speed-records-for-integer-compression/)                                      | blog      | 2017-09 |
| S4  | [Vectorized VByte Decoding / Masked VByte (Plaisance, Kurz, Lemire)](https://arxiv.org/pdf/1503.07387)                                                                                              | primary   | 2015-06 |
| S5  | [Apache Arrow Columnar Format Specification](https://arrow.apache.org/docs/format/Columnar.html)                                                                                                    | primary   | v1.5    |
| S6  | [Fast Access to Columnar, Hierarchically Nested Data via Code Transformation (PLUR)](https://arxiv.org/pdf/1708.08319)                                                                              | primary   | 2017-11 |
| S7  | [varint-simd — SIMD LEB128 in Rust](https://github.com/as-com/varint-simd)                                                                                                                          | primary   | —       |
| S8  | [Dremel: A Decade of Interactive SQL Analysis at Web Scale (VLDB 2020)](https://www.vldb.org/pvldb/vol13/p3461-melnik.pdf)                                                                          | primary   | 2020    |
| S9  | [Cap'n Proto, FlatBuffers, and SBE — author's design rationale](https://capnproto.org/news/2014-06-17-capnproto-flatbuffers-sbe.html)                                                               | primary   | 2014-06 |
| S10 | [Cap'n Proto Encoding Spec](https://capnproto.org/encoding.html)                                                                                                                                    | primary   | —       |
| S11 | [LEB128 — Wikipedia](https://en.wikipedia.org/wiki/LEB128)                                                                                                                                          | secondary | —       |
| S12 | [An Empirical Evaluation of Columnar Storage Formats (VLDB 2023, CMU)](https://arxiv.org/pdf/2304.05028)                                                                                            | primary   | 2023-11 |
| S13 | [Decoding billions of integers per second through vectorization (Lemire & Boytsov, SPE 2015)](https://arxiv.org/pdf/1209.2137) · [Wiley](https://onlinelibrary.wiley.com/doi/full/10.1002/spe.2203) | primary   | 2015    |
| S14 | [SFVInt: Simple, Fast and Generic Variable-Length Integer Decoding using Bit Manipulation](https://arxiv.org/html/2403.06898v4)                                                                     | primary   | 2024    |
| S15 | [rust_serialization_benchmark (djkoloski)](https://github.com/djkoloski/rust_serialization_benchmark)                                                                                               | primary   | ~2025   |
| S16 | [buffer-benchmarks — Protobuf/FlatBuffers/Cap'n Proto on Go & Rust](https://github.com/kcchu/buffer-benchmarks)                                                                                     | blog      | 2023-01 |
| S17 | [FlatBuffers Official Benchmarks](https://flatbuffers.dev/benchmarks/)                                                                                                                              | primary   | —       |
| S18 | [Streaming Technologies and Serialization Protocols: Empirical Performance Analysis (arXiv 2407.13494)](https://arxiv.org/html/2407.13494v2)                                                        | primary   | 2024-07 |
| S19 | [Data Formats in Analytical DBMSs: Performance Trade-offs and Future Directions](https://arxiv.org/pdf/2411.14331)                                                                                  | primary   | 2024-11 |
| S20 | [Real Zero-Copy: A Technical Autopsy of Cap'n Proto](https://dev.to/rafacalderon/real-zero-copy-a-technical-autopsy-of-capn-proto-and-the-serialization-fallacy-3n64)                               | blog      | —       |
| S21 | [Tagged union — Wikipedia (discriminant encoding/packing)](https://en.wikipedia.org/wiki/Tagged_union)                                                                                              | secondary | —       |
| S22 | [FlatBuffers White Paper (design rationale)](https://flatbuffers.dev/white_paper/)                                                                                                                  | primary   | —       |
| S23 | [FlatBuffers Schema Evolution rules](https://flatbuffers.dev/evolution/)                                                                                                                            | primary   | —       |
| S24 | [flatcc — FlatBuffers Security (verify-on-access attack surface)](https://github.com/dvidelabs/flatcc/blob/master/doc/security.md)                                                                  | primary   | —       |
| S25 | [Cap'n Proto FAQ (validation-as-anti-feature)](https://capnproto.org/faq.html)                                                                                                                      | primary   | —       |

_Additional benchmark corpora consulted: [JS/TS serialization benchmark](https://github.com/Adelost/javascript-serialization-benchmark), [Protobuf vs MessagePack vs CBOR vs FlatBuffers](https://medium.com/@the_atomic_architect/your-api-isnt-slow-your-payload-is-protobuf-vs-messagepack-vs-cbor-vs-flatbuffers-benchmarked-ca6d0193477c)._
