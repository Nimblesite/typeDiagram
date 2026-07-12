# TDBIN Columnar Layout Specification

> **Status:** NORMATIVE for layout major 2. Implements the research-mandated
> column-oriented encoding for repeated ADT data (research §3.3/§3.5, PLUR
> `[S6]`, Arrow `[S5]`, Dremel `[S8]`). Companion to
> [tdbin-wire-format.md](tdbin-wire-format.md), which stays authoritative for
> words, pointers, packing, framing, and safety. The roadmap that led here is
> [tdbin-future-columnar.md](tdbin-future-columnar.md).
> **Compatibility:** selecting columnar layout for a schema is a breaking
> layout change ([TDBIN-EVOLVE-BREAKING]); it MUST publish a new
> compatibility-major manifest/hash. Layout major 1 (row-wise composite lists)
> remains valid wire; both runtimes keep decoding it.

All statements marked **MUST** are normative. Code and tests reference the
`[TDBIN-COL-*]` IDs below.

---

## [TDBIN-COL-POLICY] Layout selection

- The physical encoding of every logical list is a **pure function of the
  schema and its declared layout major** — never of runtime values, element
  counts, or CPU features.
- **Layout major 1**: every list uses the v1 forms ([TDBIN-LIST-ELEM],
  [TDBIN-LIST-COMPOSITE]).
- **Layout major 2**: `List<record>`, `List<union>`, `List<String>`,
  `List<Bytes>`, and every list nested inside a column group use the column
  forms in this document; `List<Int>` fields and `Int` group columns use
  integer delta blocks ([TDBIN-COL-INTBLOCK]). Other scalar lists
  (`List<Bool|Float|DateTime>`, `List<Uuid|Decimal>`) keep their v1 flat
  forms in non-nested positions — they are already tag-free contiguous
  columns. Non-list fields keep their v1 encodings.
- The selection is frozen into the canonical layout manifest
  ([TDBIN-SCHEMA-CANON]) and therefore into the layout hash
  ([TDBIN-SCHEMA-HASH]). Generated Rust and TypeScript codecs MUST agree.

## [TDBIN-COL-GROUP] The column group

A columnar `List<R>` encodes as an ordinary struct pointer
([TDBIN-PTR-STRUCT]) to a **column-group struct**:

- **Data section: exactly 1 word** — the element count as a u64
  (≤ 2²⁹ − 1, [TDBIN-WIRE-LIMITS]).
- **Pointer section: one slot per column**, allocated by [TDBIN-COL-PLAN].

The schema-independent verifier sees only ordinary structs and lists; no new
pointer kinds or element kinds are introduced beyond the already-reserved
elem 3/4 widths ([TDBIN-PTR-LIST]).

- A **required empty list** MUST encode as the null pointer (its schema
  default, [TDBIN-PTR-NULL]).
- An **`Option<List<...>>`** field distinguishes `None` (null pointer) from
  `Some(empty)` (a group with count 0 and every column slot null).
- A column of an empty group MUST be null. A column whose body would be empty
  (for example the payload column of all-empty strings) MUST be null.

## [TDBIN-COL-PLAN] Column allocation

Columns are allocated by walking `R`'s fields in declaration order. Each field
appends pointer slots to the group:

| Field type                         | Slots | Columns, in order                                                                   |
| ---------------------------------- | ----: | ----------------------------------------------------------------------------------- |
| `Bool`                             |     1 | bit column: elem-1 list, one bit per row, LSB-first ([TDBIN-WIRE-WORD])             |
| `Int` / `Float` / `DateTime`       |     1 | word column: elem-5 list, raw LE per row ([TDBIN-LIST-RAW])                         |
| `Uuid` / `Decimal`                 |     1 | 16-byte column: v1 composite list, data 2 / ptr 0 ([TDBIN-LIST-ELEM])               |
| enum-union (all-bare union)        |     1 | tag column: elem-2 byte list, ordinal per row (< 256 variants)                      |
| `String` / `Bytes`                 |     2 | **var column**: length column + payload column ([TDBIN-COL-VAR])                    |
| `Option<scalar/semantic/enum>`     |   1+n | validity column ([TDBIN-COL-VALIDITY]) then the value column(s); absent lanes zero  |
| `Option<String>` / `Option<Bytes>` |     3 | validity column, then var column (absent rows have length 0)                        |
| record `R2`                        |     1 | child column group of `R2`, count = parent count                                    |
| `Option<record R2>`                |     2 | validity column + **dense** child group (count = present rows, in row order)        |
| union `U` (payload-bearing)        |     1 | union column group ([TDBIN-COL-UNION]), count = parent count                        |
| `Option<union U>`                  |     2 | validity column + dense union group                                                 |
| `List<T>` (nested list)            |   1+n | row-count column (elem-4 u32 inner count per row) then `T`'s concatenated column(s) |
| `Option<List<T>>`                  |   2+n | validity column then the nested-list columns (absent rows have row-count 0)         |

Nested `List<T>` concatenation: the inner elements of every row are laid
end-to-end in row order and encoded as `T`'s column form over the total
element count (`List<scalar>` → one flat value column; `List<String>` → one
var column; `List<record>` → one child group; deeper nesting recurses).

`Unit` fields allocate nothing. `Map`/`Any` remain unsupported and MUST fail
loudly at generation time.

## [TDBIN-COL-VAR] Var columns (String / Bytes)

A var column is two physical columns:

1. **Length column**: an elem-4 list (u32 LE) with one length per row.
2. **Payload column**: an elem-2 byte list holding every row's bytes
   concatenated in row order, with no separators.

Rules:

- The sum of the lengths MUST equal the payload column's element count;
  decoders MUST reject a mismatch.
- Row offsets are derived by prefix sum — they are never stored.
- For `String` columns every row's slice MUST be valid UTF-8
  ([TDBIN-SAFE-UTF8]).
- A row longer than 2³² − 1 bytes is unrepresentable and MUST be rejected at
  encode time (payload columns are already bounded by the u29 list count).

## [TDBIN-COL-INTBLOCK] Integer delta blocks

`Int` value columns inside groups and `List<Int>` fields at layout major 2
encode as a **frame-of-reference delta block** carried in one elem-2 byte
list (research §3.2 `[S13]` — the scalar reference form of the SIMD-BP128
family; a vectorized decoder MUST produce identical bytes):

| Offset | Size | Field                                                     |
| -----: | ---: | --------------------------------------------------------- |
|      0 |    4 | count: u32 LE, number of logical values                   |
|      4 |    8 | first value: i64 LE                                       |
|     12 |    8 | floor: u64 LE, minimum zigzagged delta                    |
|     20 |    1 | width: bits per packed delta (0-64)                       |
|     21 |    … | count−1 deltas: little-endian bit stream, width bits each |

Rules:

- Delta i = zigzag(value[i+1] − value[i], wrapping); the stream stores
  delta − floor. Width MUST be the minimal width covering every stored
  delta (canonical bytes, [TDBIN-ENC-CANON]).
- The byte list's length MUST equal 21 + ⌈(count−1)·width/8⌉; a
  disagreement, width > 64, or count 0 with a non-null column is
  `MalformedColumn`.
- An empty column/list is the null pointer. In a group, count MUST equal the
  row count (or the nested-list total).
- Monotonic ID columns therefore collapse to the 21-byte header; arbitrary
  values degrade to at most raw width plus the header.

## [TDBIN-COL-VALIDITY] Validity columns

An elem-1 bit list, one bit per row, bit i = row i, 1 = present. Absent rows
MUST contribute canonical zero lanes to aligned value columns (scalar forms)
or zero lengths (var columns), and contribute **no** rows to dense child
groups. Encoders MUST zero every absent lane ([TDBIN-ENC-ZERO]).

## [TDBIN-COL-UNION] Union column groups

A columnar `List<U>` (or a union-typed field's group) encodes as:

- Data word 0: row count.
- Pointer slot 0: **tag column** — elem-2 byte list, one byte per row holding
  the variant's declaration ordinal ([TDBIN-UNION-DISC]). Unions with more
  than 256 variants are unsupported under columnar layout and MUST fail
  loudly at generation time.
- Then, for each **payload-bearing** variant in declaration order: the
  variant's payload columns, **dense** — only rows carrying that tag
  contribute, in row order. A record payload appends 1 slot (child group); a
  `String` payload appends a var column (2 slots). Bare variants append
  nothing.

Variant-local row indices are **derived** (the number of earlier rows with an
equal tag) — never stored (PLUR dense-union semantics, research `[S6]`).

Unknown tags (≥ the reader's variant count) follow [TDBIN-UNION-UNKNOWN]:
structural verification MUST still pass when the group is well-formed — every
column of the group is visited by the typed group read itself before tags are
matched — and typed decode MUST surface `UnknownVariant`, never a panic, never
silent misreads.

## [TDBIN-COL-EVOLVE] Evolution

The v1 evolution invariant holds: a column's slot position depends only on its
own field and lower-ordinal fields. Under [TDBIN-EVOLVE-APPEND]:

- Appending a field to a record appends its column slots after all existing
  slots; older data reads the new columns as null → schema defaults
  ([TDBIN-REC-SHORT] applied to the group struct).
- Appending a variant to a union appends its payload slots; older readers
  decode unknown tags to `UnknownVariant`.
- Everything in [TDBIN-EVOLVE-BREAKING] stays breaking; additionally,
  switching a published list between row-wise and columnar layout is breaking.

## [TDBIN-COL-ORDER] Encode order and canonicality

Within a group the writer MUST append column bodies in slot order, after the
group struct itself, following the preorder rule ([TDBIN-ENC-ORDER]). Encoding
stays deterministic ([TDBIN-ENC-CANON]): identical (schema, value) pairs
produce byte-identical bare bodies.

## [TDBIN-COL-SAFE] Safety

Column groups and columns are ordinary structs and lists, so every
[TDBIN-SAFE] rule applies unchanged: bounds, depth (each nested group level
consumes one depth unit), amplification (charged by physical body words), and
UTF-8 validation. Var-column length/payload consistency and dense-group count
consistency (tag histogram vs child group count) are typed-decode checks and
MUST surface typed errors.

Additionally, decoders MUST bound total materialization per message: group
rows and integer-block values charge a shared absolute budget of 2²⁶
rows/values (mirroring the unpack output cap), so forged counts over all-null
columns or header-only delta blocks cannot amplify allocation without bound.
Exceeding the budget is `AmplificationExceeded`.

## Decision trace (research → spec)

| Decision                                 | Research anchor                            |
| ---------------------------------------- | ------------------------------------------ |
| Struct-of-arrays for repeated records    | §3.5 `[S6][S8][S19]`, §4.4                 |
| Dense union: tag column + dense payloads | §3.3 `[S5][S6]`                            |
| Derived (unstored) variant-local offsets | PLUR `[S6]`                                |
| 1-bit validity bitmaps                   | §3.4 `[S5][S6]`                            |
| Length column + contiguous payload       | Dremel length/presence, 13% smaller `[S8]` |
| Uniform per-column decode path           | §1 Regime C `[S12]`                        |
| Columns stay raw (no XOR inside bodies)  | [TDBIN-LIST-RAW]                           |
