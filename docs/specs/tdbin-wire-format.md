# TDBIN Wire Format Specification

> **Status:** DRAFT v1 — normative spec derived from [docs/research/binary-format-research.md](../research/binary-format-research.md).
> **Scope:** the language-neutral binary wire format for typeDiagram ADTs (records + tagged unions). The Rust codec API is specified in [tdbin-rust-api.md](tdbin-rust-api.md); the implementation plan is [docs/plans/tdbin-implementation-plan.md](../plans/tdbin-implementation-plan.md).
> **Goal (non-negotiable):** smaller AND faster than Protobuf, measured by the bench gate `[TDBIN-BENCH-GATE]` (Rust API spec).
> **Design thesis (research §0):** schema-known fixed layout (no field tags → smaller) + zero-parse/verify-on-access (no decode materialization → faster) + XOR-default word-packing (reclaims zero-copy padding → smaller again).
> **Roadmap constraint:** TDBIN will carry **bidirectional streaming and an RPC framework** (research §6). Every message is therefore self-delimiting, the encoder is forward-only between messages, and a pointer kind is reserved for RPC capabilities.

All statements marked **MUST** are normative. Every normative rule lives under a spec ID; code and tests reference these IDs so `grep '\[TDBIN-'` traces spec → code → tests.

---

## [TDBIN-WIRE] Ground rules

### [TDBIN-WIRE-WORD]
- The unit of layout is the **word**: 8 bytes.
- All multi-byte values MUST be **little-endian**. Bit fields MUST use **little-endian bit order** (bit 0 = least-significant bit of the byte at the lowest address).
- Every object (struct body, list body) MUST begin on a word boundary within the message body.

### [TDBIN-WIRE-LIMITS]
Hard limits; a message exceeding any of them is invalid:
| Limit | Value | Where enforced |
|---|---|---|
| Body size | ≤ 2³² − 1 bytes | `[TDBIN-MSG-FRAME]` |
| Struct data section | ≤ 2¹⁶ − 1 words | `[TDBIN-PTR-STRUCT]` |
| Struct pointer section | ≤ 2¹⁶ − 1 slots | `[TDBIN-PTR-STRUCT]` |
| List element count | ≤ 2²⁹ − 1 | `[TDBIN-PTR-LIST]` |
| Composite list total | ≤ 2²⁹ − 1 words | `[TDBIN-LIST-COMPOSITE]` |
| Pointer depth | ≤ 64 | `[TDBIN-SAFE-DEPTH]` |
| Union variants | ≤ 2¹⁶ | `[TDBIN-UNION-DISC]` |

---

## [TDBIN-MSG] Message envelope

### [TDBIN-MSG-BARE]
A **bare message** is a sequence of words. Word 0 MUST be the **root pointer**: a struct pointer (`[TDBIN-PTR-STRUCT]`) to the root object. All pointer targets MUST lie within the message body (single segment in v1; multi-segment far pointers are reserved, `[TDBIN-PTR-RESERVED]`).

### [TDBIN-MSG-FRAME]
A **framed message** wraps a bare (optionally packed) body for transport and streams:

| Offset | Size | Field | Rule |
|---|---|---|---|
| 0 | 4 | magic | bytes `0x54 0x44 0x42 0x31` (`"TDB1"`) |
| 4 | 1 | version | `1` |
| 5 | 1 | flags | bit 0 `PACKED` (`[TDBIN-PACK]`), bit 1 `HASH`; other bits MUST be 0 |
| 6 | 2 | reserved | MUST be 0 |
| 8 | 4 | body_len | u32 LE, byte length of `body` **as it appears on the wire** (post-packing when `PACKED`) |
| 12 | 8 | schema_hash | u64 LE (`[TDBIN-SCHEMA-HASH]`); present iff `HASH` flag set |
| 12 or 20 | body_len | body | bare message, packed when `PACKED` |

Readers MUST reject wrong magic, unknown version, nonzero reserved bits/fields, and `body_len` disagreeing with available bytes.

### [TDBIN-MSG-STREAM]
Framing is what makes the RPC/streaming roadmap work (research §6.5): messages are self-delimiting via `body_len`, so they concatenate into a stream with no delimiters. On a stream, the schema hash MUST be negotiated **once per stream** (first frame carries `HASH`; subsequent frames elide it). Stream-level concerns (multiplexing, flow control, method dispatch, promise pipelining) belong to the future `[TDRPC-*]` spec, not this one — but this envelope is the frame it will carry.

---

## [TDBIN-PTR] Pointers

A pointer is one word. Bits 0–1 select the kind: `00` struct, `01` list, `10`/`11` reserved.

### [TDBIN-PTR-NULL]
An all-zero word in a pointer slot is the **null pointer**: the field takes its schema default (empty string/bytes/list, default record, `None`). Writers MUST encode absent pointer fields as null.

### [TDBIN-PTR-STRUCT]
| Bits | Field | Meaning |
|---|---|---|
| 0–1 | kind | `00` |
| 2–31 | offset | signed 30-bit count of **words** from the end of the pointer word to the start of the target's data section |
| 32–47 | data_words | u16: size of the data section in words |
| 48–63 | ptr_words | u16: number of pointer slots following the data section |

The target object is `data_words` words of scalar data followed by `ptr_words` pointer words.

### [TDBIN-PTR-LIST]
| Bits | Field | Meaning |
|---|---|---|
| 0–1 | kind | `01` |
| 2–31 | offset | signed 30-bit words from end of pointer word to first element (or to the tag word for composite) |
| 32–34 | elem | element kind, table below |
| 35–63 | count | u29: element count, EXCEPT composite (`elem=7`): total words excluding the tag word |

| elem | Element | Used by |
|---|---|---|
| 0 | void (0 bits) | `List<Unit>` |
| 1 | 1 bit | `List<Bool>` (bit-packed, `[TDBIN-WIRE-WORD]` bit order) |
| 2 | 1 byte | `String`, `Bytes`, `List<enum>` (`[TDBIN-LIST-ELEM]`) |
| 3 | 2 bytes | reserved for width-refined ints (`[TDBIN-FUTURE-WIDTH-TYPES]`) |
| 4 | 4 bytes | reserved for width-refined ints/floats |
| 5 | 8 bytes | `List<Int>`, `List<Float>`, `List<DateTime>` |
| 6 | pointer | `List<String>`, `List<Bytes>`, `List<List<T>>`, `List<record>`, `List<union>` |
| 7 | composite | inline struct elements (`[TDBIN-LIST-COMPOSITE]`) |

List bodies MUST be zero-padded to a word boundary.

### [TDBIN-PTR-RESERVED]
Kind `10` is reserved for **far pointers** (multi-segment messages). Kind `11` is reserved for **capabilities** (the RPC layer's remote-object references — research §6.4 promise pipelining). Readers MUST reject reserved kinds in v1.

---

## [TDBIN-PRIM] Primitive types (DSL → wire)

### [TDBIN-PRIM-MAP]
typeDiagram built-ins map to exactly these wire representations:

| DSL | Wire | Width |
|---|---|---|
| `Bool` | 1 bit in the data section | 1 bit |
| `Int` | two's-complement i64 LE | 64 bits |
| `Float` | IEEE-754 binary64 LE | 64 bits |
| `String` | pointer → byte list, UTF-8, **no NUL terminator** | ptr slot |
| `Bytes` | pointer → byte list | ptr slot |
| `Unit` | nothing (zero bits, no slot) | 0 |
| `DateTime` | i64 LE microseconds since Unix epoch, UTC | 64 bits |
| `Uuid` | 16 bytes, RFC 4122 big-endian byte order (the canonical textual order) | 128 bits |
| `Decimal` | 16 bytes: i96 LE unsigned mantissa (bytes 0–11), scale u8 (byte 12, 0–28), flags u8 (byte 13, bit 7 = sign), bytes 14–15 zero | 128 bits |
| enum-union (`[TDBIN-UNION-ENUM]`) | discriminant bit field | 1/2/4/8/16 bits |

`String` payloads MUST be valid UTF-8 (`[TDBIN-SAFE-UTF8]`). Width-refined numeric DSL types (`I8…U64`, `F32`) are a schema-language extension (`[TDBIN-FUTURE-WIDTH-TYPES]`); the wire format already reserves their widths and list element kinds.

### [TDBIN-PRIM-OPTION]
`Option<T>` is built in and layout-frozen (it can never evolve, so inlining is safe — the exception to `[TDBIN-UNION-STRUCT]`):
- **T is pointer-typed** (String, Bytes, List, record, union): the field is one pointer slot; **null pointer = `None`**. Zero overhead.
- **T is scalar** (Bool, Int, Float, DateTime, Uuid, Decimal, enum): a 1-bit **presence flag** plus a T-width value slot, both allocated by `[TDBIN-REC-ALLOC]` in that order. Presence 0 ⇒ `None` and the value slot MUST be zero.
- **T is `Unit`**: presence bit only.
- **T is itself `Option`**: the inner `Option` is encoded via the general union path (pointer to an `Option` union struct).
- In `List<Option<T>>`, each element is the inline group `{present: 1 bit, value: T}` encoded as a composite list element (scalar T) or a pointer list with nulls (pointer T). Columnar validity bitmaps supersede this in `[TDBIN-FUTURE-COLUMNAR]`.

---

## [TDBIN-REC] Records (product types)

### [TDBIN-REC-SECTIONS]
A record encodes as a struct: a **data section** (bit-packed scalars) followed by a **pointer section** (one word per pointer field), per `[TDBIN-PTR-STRUCT]`. Nested record- and union-typed fields are **pointer-typed** — always a separate struct reached by pointer, never inlined. This keeps every type's layout independent (evolution) and makes recursive types (trees, lists) representable.

### [TDBIN-REC-ALLOC]
Field positions are a **pure function of the schema** — no tags on the wire. The layout algorithm:

1. Assign each field an **ordinal** = its declaration index (0-based, textual order).
2. Process fields in ordinal order. Classify each as **scalar** (width w bits, w ∈ {1, 2, 4, 8, 16, 32, 64, 128}), **pointer**, or **Unit** (no allocation). `Option<scalar>` allocates its presence bit (w=1) then its value slot, in that order.
3. **Scalar:** allocate the lowest bit offset that is a multiple of w and does not overlap any previously allocated interval.
4. **Pointer:** allocate the next sequential pointer slot (0, 1, 2, …).
5. Data section size = ⌈(highest allocated bit end) / 64⌉ words; pointer section size = pointer slots allocated. Unused bits/bytes MUST be zero.

Determinism of this algorithm is what golden vectors (`[TDBIN-TEST-GOLDEN]`) pin down.

### [TDBIN-REC-XOR]
Every scalar field is stored **XOR'd with the w-bit representation of its schema default**. typeDiagram currently defines all defaults as the zero value, so today's stored bytes equal the raw values — but the XOR rule is normative now so a future DSL default-value annotation changes no wire logic, and defaulted fields always encode as zeros that `[TDBIN-PACK]` deletes (research §3.4).

### [TDBIN-REC-SHORT]
Readers MUST accept a struct whose `data_words`/`ptr_words` are **smaller or larger** than the reader's schema expects. Fields beyond the actual sections read as default (all-zero ⇒ XOR gives the default). Extra sections are ignored on read but MUST be preserved by the verifier's bounds accounting. This is what makes `[TDBIN-EVOLVE-APPEND]` bidirectionally compatible.

---

## [TDBIN-UNION] Tagged unions (sum types)

### [TDBIN-UNION-STRUCT]
A named `union` type encodes as a struct of its own (reached by pointer, like any record): a **discriminant** bit field allocated first, then each variant's payload fields. There are no other fields in a union struct.

### [TDBIN-UNION-DISC]
- The discriminant value is the variant's **declaration ordinal** (0-based). DSL-pinned values (`ParseError = -32700`) are a codegen-surface mapping and MUST NOT appear on the wire.
- Discriminant width = the smallest w ∈ {1, 2, 4, 8, 16} with 2ʷ ≥ capacity, where **capacity** = variant count (or a schema-declared reserved capacity ≥ variant count, once the schema language grows a reserve annotation — until then capacity = variant count). A 2-variant union costs **1 bit**; ≤ 4 variants cost 2 bits (research §3.3 — vs Protobuf's ≥ 2 bytes for `oneof`).
- More than 2¹⁶ variants is a schema error.

### [TDBIN-UNION-OVERLAP]
Variant payload fields are laid out by `[TDBIN-REC-ALLOC]` with one change: intervals and pointer slots allocated by **other variants of the same union are treated as free** (only one variant is ever live). Allocation order is global and deterministic: variants in declaration order, fields within a variant in declaration order. Tuple-form payloads (`Number(Int)`) are positional fields ordinal 0, 1, …. Writers MUST zero all slots belonging to inactive variants (`[TDBIN-SAFE-ZEROSLOT]`).

### [TDBIN-UNION-ENUM]
A union whose variants are **all bare** (no payloads) is an **enum-union**: it is NOT pointer-encoded. As a field it inlines directly into the parent's data section as a scalar of the discriminant width; in lists it occupies 1 byte per element (`[TDBIN-LIST-ELEM]`). Its width is a pure function of its own definition, so parents' layouts shift only if the enum's width changes — governed by `[TDBIN-EVOLVE-WIDTH]`.

### [TDBIN-UNION-UNKNOWN]
A discriminant ≥ the reader's known variant count (a newer writer) is **not** a structural error: the verifier MUST still pass the message (all pointer slots are verified regardless of liveness, `[TDBIN-SAFE-ZEROSLOT]`), and decode MUST surface a typed `UnknownVariant { type_name, ordinal }` error — never a panic, never silent misreading.

---

## [TDBIN-LIST] Lists

### [TDBIN-LIST-ELEM]
- `List<Bool>`: elem 1, bit-packed.
- `List<Int> / List<Float> / List<DateTime>`: elem 5, raw 8-byte values.
- `List<Uuid> / List<Decimal>`: composite (elem 7) with data_words = 2, ptr_words = 0.
- `List<enum-union>`: elem 2, one byte per element, value = discriminant ordinal (sub-byte packing for enum columns arrives with `[TDBIN-FUTURE-COLUMNAR]`).
- `String`/`Bytes` are byte lists (elem 2).
- Lists of pointer-typed elements: elem 6.
- `List<record>` and `List<union>`: composite, `[TDBIN-LIST-COMPOSITE]`.

### [TDBIN-LIST-RAW]
List elements are stored **raw** — `[TDBIN-REC-XOR]` does NOT apply inside list bodies (uniform elements keep the SIMD path branch-free; research §1 Regime C: keep the decode path uniform).

### [TDBIN-LIST-COMPOSITE]
A composite list body begins with one **tag word** shaped like a struct pointer (`[TDBIN-PTR-STRUCT]`) whose offset field instead holds the **element count**; its `data_words`/`ptr_words` give every element's struct size. Elements follow back-to-back, each `data_words + ptr_words` words. The list pointer's count field holds total words excluding the tag word, which MUST equal element count × (data_words + ptr_words).

---

## [TDBIN-PACK] Wire packing (the size-recovery layer)

Applied to the whole body when the `PACKED` flag is set (research §3.4 — worst case 2 bytes per 2 KiB; deletes the zeros produced by padding + XOR-default). It is the Cap'n Proto packing scheme:

### [TDBIN-PACK-WORD]
Each word becomes: 1 **tag byte** — bit n set ⇔ byte n of the word is nonzero — followed by the nonzero bytes only, in order.

### [TDBIN-PACK-RUNS]
- Tag `0x00` is followed by one count byte N: N **additional** all-zero words follow the current zero word (run of N+1 zero words total).
- Tag `0xFF` is followed by the word's 8 literal bytes, then one count byte N, then N words verbatim (uncompressible run passthrough).

Unpackers MUST bounds-check every read, MUST cap output at the decoder's configured limit, and MUST reject packed streams that end mid-element. Block compression (zstd/Snappy) MUST NOT be part of this format (research §3.6: up to 4.2× scan penalty) — it may only ever be an explicit outer transport layer.

---

## [TDBIN-EVOLVE] Schema evolution (no tags, still compatible)

The evolution invariant (research §3.7): **a field's position and width depend only on its own definition and lower-ordinal definitions.** Any schema change preserving all previously assigned positions/widths is **wire-compatible**; both directions work because short/long structs read correctly (`[TDBIN-REC-SHORT]`) and absent fields decode to defaults (`[TDBIN-REC-XOR]`).

### [TDBIN-EVOLVE-APPEND]
Compatible changes:
- **Append a field at the end of a record.** New allocations come after all existing ones (they may land in existing padding — that is the point).
- **Append a bare or payload-carrying variant at the end of a union**, provided the discriminant width does not change (`[TDBIN-EVOLVE-WIDTH]`).
- **Rename** a type, field, or variant (layout is positional; this breaks source compatibility only).
- Add whole new types.

### [TDBIN-EVOLVE-BREAKING]
Breaking changes (MUST bump the schema major version; the schema hash changes and readers reject mismatched framed messages):
- Remove or reorder fields or variants; insert anywhere but the end.
- Change any field's type.
- Add a field to an **existing** union variant (it would reorder the global allocation sequence of `[TDBIN-UNION-OVERLAP]`). Per-declaration explicit ordinals are the future escape hatch (`[TDBIN-FUTURE-ORDINALS]`).
- Change a default value (stored XOR'd — old data would re-read wrong).

### [TDBIN-EVOLVE-WIDTH]
Growing a union/enum past its discriminant-width capacity (e.g. variant 5 of a 4-capacity union) changes the width and therefore every dependent layout: **breaking**. Schemas expecting growth should declare reserved capacity (`[TDBIN-UNION-DISC]`).

---

## [TDBIN-SCHEMA] Schema identity

### [TDBIN-SCHEMA-MONO]
Generic types (`Pair<A,B>`, `Option<T>`, `List<T>`, `Result<T,E>`) are **monomorphized** at schema-build time: every concrete instantiation reachable from a root type gets its own layout. Generics never appear on the wire.

### [TDBIN-SCHEMA-ALIAS]
`alias` is transparent: `alias Email = String` encodes exactly as `String` and does not contribute to the schema hash beyond its expansion.

### [TDBIN-SCHEMA-HASH]
The schema hash is **FNV-1a 64-bit** (offset basis `0xcbf29ce484222325`, prime `0x100000001b3`) over the UTF-8 bytes of the canonical schema text `[TDBIN-SCHEMA-CANON]`.

### [TDBIN-SCHEMA-CANON]
Canonical schema text: all reachable monomorphized types, aliases expanded, sorted by type name (byte-wise), each rendered with no whitespace as
`type Name{field:Type,…}` / `union Name{Variant{field:Type,…},Bare,…}`
with fields and variants in ordinal order and type references themselves canonical (monomorphized names render as `Name<Arg,…>`). Two schemas are identical for framing purposes iff their canonical texts are byte-equal.

---

## [TDBIN-ENC] Encoding rules (writer obligations)

### [TDBIN-ENC-ORDER]
The encoder allocates the root struct first, then children in a **preorder DFS following ordinal order**, appending each object after all previously allocated words. Pointer back-patching is bounded to **within the current message** — the write path stays forward-only *between* messages (streaming constraint, research §6.1/§6.5).

### [TDBIN-ENC-CANON]
Encoding is **deterministic**: identical (schema, value) pairs MUST produce byte-identical bare bodies. This is required for golden vectors and reproducible hashes.

### [TDBIN-ENC-ZERO]
All unallocated padding, dead union-variant slots, and list tail padding MUST be written as zero — for `[TDBIN-PACK]` efficiency, deterministic output, and so the verifier can validate every pointer slot without knowing union liveness.

---

## [TDBIN-SAFE] Verification (untrusted input)

Verification is a **single O(n) pass** (research §3.8). Decode always verifies; a trusted-path zero-copy reader (`[TDBIN-FUTURE-READER]`) may rely on a prior explicit verify. The verifier proves the buffer is **safe to read** — it does not prove the buffer is the *intended* value (a wrong-typed buffer passing the schema hash check can still decode to garbage values; the hash is the type check, `[TDBIN-MSG-FRAME]`).

### [TDBIN-SAFE-BOUNDS]
Every pointer's full target range (data + pointer sections; list body incl. composite tag) MUST lie within the message body. All arithmetic MUST be overflow-checked. Reserved pointer kinds and malformed composite tags (`[TDBIN-LIST-COMPOSITE]` count equation) MUST be rejected.

### [TDBIN-SAFE-DEPTH]
Pointer traversal depth is capped at **64**; deeper messages are rejected (recursion-bomb DoS, research §3.8).

### [TDBIN-SAFE-AMPLIFY]
Total traversed words MUST NOT exceed the body's word count. Aliased pointers (two pointers into the same region) are structurally readable but exceed this budget under fan-out abuse (DAG amplification bombs) and MUST be rejected.

### [TDBIN-SAFE-UTF8]
Every `String` payload is UTF-8-validated during the verify pass, so post-verify access never re-validates.

### [TDBIN-SAFE-ZEROSLOT]
The verifier validates **every** non-null pointer slot in every struct, live or not — legal because writers zero dead slots (`[TDBIN-ENC-ZERO]`). Unknown union discriminants are not rejected (`[TDBIN-UNION-UNKNOWN]`).

---

## [TDBIN-FUTURE] Reserved forward paths (not in v1)

- **[TDBIN-FUTURE-COLUMNAR]** — struct-of-arrays encoding for `List<record>` / `List<union>` (dense-union columns, validity bitmaps, SIMD-BP128 bit-packed integer columns; research §3.3/§3.5, the 13%-smaller + SIMD-scannable regime). Will occupy a new list element kind or flag.
- **[TDBIN-FUTURE-READER]** — zero-copy verify-once/access-lazily reader (nanosecond field access; research §2.4).
- **[TDBIN-FUTURE-RPC]** — the `[TDRPC-*]` spec: typeDiagram **function definitions as the service contract** (research §6.0), streaming modes from signature shape, numeric method ids (no method-name strings on the wire), capability pointers (kind `11`), promise pipelining. Fed by the dedicated RPC research pass.
- **[TDBIN-FUTURE-TS]** — TypeScript codec in `packages/typediagram/` implementing this spec byte-for-byte (golden vectors are the conformance suite).
- **[TDBIN-FUTURE-WIDTH-TYPES]** — width-refined DSL numerics (`I8…U64`, `F32`); wire widths and list element kinds already reserved.
- **[TDBIN-FUTURE-ORDINALS]** — explicit per-declaration ordinal annotations to allow non-append evolution (Cap'n Proto-style).

## Decision trace (research → spec)

| Decision | Research anchor |
|---|---|
| No field tags; layout from schema | §0 tax #1, §3.7 `[S10]` |
| Struct = data + pointer sections, word-aligned | §3.1 `[S10]` |
| XOR-with-default scalars | §3.4 `[S10]` |
| Sub-byte discriminants (⌈log₂N⌉ → pow2 width) | §3.3 `[S21]`, §4.3 |
| Dense payloads, variant overlap | §3.3 `[S5][S6]` |
| Word packing, no block compression | §3.4 `[S10]`, §3.6 `[S12]` |
| Verify O(n) + depth + amplification caps | §3.8 `[S24][S25]` |
| Fixed-width scalars, no scalar varints in v1 | §3.2 (branch mispredicts `[S11]`), §5 Q3 |
| Length-prefixed self-delimiting frames | §6.2/§6.5 |
| Append-only evolution into padding | §3.7 `[S10]` |
