# TDBIN Benchmark Report

Date: 2026-07-09 (Australia/Melbourne)

Command:

```sh
cargo bench -p tdbin --bench gate
```

## Verdict

`[TDBIN-BENCH-GATE]` passes on the realistic list-heavy metric-batch corpus row.

The tiny `Person` fixtures remain useful negative controls: TDBIN is still
larger and slower there. The passing claim is therefore scoped to realistic
list-heavy entries, where the wire format uses raw word lists and bit-packed
bool lists instead of Protobuf varints and byte-per-bool packed fields.

## Size

| Fixture           | TDBIN bare | TDBIN packed | Protobuf | Result                  |
| ----------------- | ---------: | -----------: | -------: | ----------------------- |
| `with_address`    |        160 |           97 |       79 | packed is 22.8% larger  |
| `without_address` |        112 |           42 |       31 | packed is 35.5% larger  |
| `metric_batch`    |     76,752 |       39,272 |   84,149 | packed is 53.3% smaller |

## Criterion Timing

| Fixture           | Operation          | TDBIN median | Protobuf median | Result              |
| ----------------- | ------------------ | -----------: | --------------: | ------------------- |
| `with_address`    | encode             |    349.02 ns |       48.016 ns | prost ~7.3x faster  |
| `with_address`    | decode bare        |    159.64 ns |       139.27 ns | prost ~1.1x faster  |
| `with_address`    | decode packed body |    224.65 ns |       139.27 ns | prost ~1.6x faster  |
| `without_address` | encode             |    239.29 ns |       35.207 ns | prost ~6.8x faster  |
| `without_address` | decode bare        |    71.391 ns |       46.538 ns | prost ~1.5x faster  |
| `without_address` | decode packed body |    155.58 ns |       46.538 ns | prost ~3.3x faster  |
| `metric_batch`    | encode             |    16.989 us |       46.797 us | TDBIN ~2.8x faster  |
| `metric_batch`    | decode bare        |    12.074 us |       31.054 us | TDBIN ~2.6x faster  |
| `metric_batch`    | decode packed body |    29.605 us |       31.054 us | TDBIN ~1.05x faster |

For the strict packed-byte decode comparison on `metric_batch`, the confidence
intervals do not overlap: TDBIN `[29.428 us, 29.834 us]`, Protobuf
`[30.719 us, 31.330 us]`.

## Follow-Up

Small-message overhead remains a known weakness and must not be described as a
general win. The defensible release claim is: TDBIN beats Protobuf on the
realistic list-heavy metric-batch corpus while tiny record fixtures remain a
negative-control loss.
