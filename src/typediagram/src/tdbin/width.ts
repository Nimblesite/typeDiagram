// [TDBIN-WIDTH-RANGE] [TDBIN-WIDTH-LIST] Width-refined integers for generated
// TypeScript codecs, byte-identical to the Rust runtime: one data word per
// scalar (signed = i64 bit pattern, unsigned = raw value), and lists in the
// reserved 1/2/4/8-byte element widths. JavaScript numbers are unbounded, so
// encode AND decode range-check; out of range is `ValueOutOfRange`, never a
// truncation. `U64` is a lossless `bigint`; `Size` is limited to safe integers.
import { ok, type Result } from "../result.js";
import { tdbinErr } from "./error.js";
import * as reader from "./reader.js";
import type { Reader, TdbinError, Writer } from "./types.js";
import * as writer from "./writer.js";

export type NumberWidth = "i32" | "u8" | "u16" | "u32" | "size";

interface Spec {
  readonly min: bigint;
  readonly max: bigint;
  readonly signed: boolean;
  readonly elem: number;
  readonly bytes: number;
}

const SPECS: Record<NumberWidth | "u64", Spec> = {
  i32: { min: -(2n ** 31n), max: 2n ** 31n - 1n, signed: true, elem: 4, bytes: 4 },
  u8: { min: 0n, max: 255n, signed: false, elem: 2, bytes: 1 },
  u16: { min: 0n, max: 65535n, signed: false, elem: 3, bytes: 2 },
  u32: { min: 0n, max: 2n ** 32n - 1n, signed: false, elem: 4, bytes: 4 },
  size: { min: 0n, max: BigInt(Number.MAX_SAFE_INTEGER), signed: false, elem: 5, bytes: 8 },
  u64: { min: 0n, max: 2n ** 64n - 1n, signed: false, elem: 5, bytes: 8 },
};

const checked = (spec: Spec, value: number | bigint): Result<bigint, TdbinError> =>
  (typeof value === "bigint" || Number.isInteger(value)) && BigInt(value) >= spec.min && BigInt(value) <= spec.max
    ? ok(BigInt(value))
    : tdbinErr("ValueOutOfRange");

const wordOf = (spec: Spec, value: bigint): bigint => BigInt.asUintN(64, value);

const valueOf = (spec: Spec, word: bigint): Result<bigint, TdbinError> =>
  checked(spec, spec.signed ? BigInt.asIntN(64, word) : word);

/** Write one width scalar into data word `slot`. */
export const writeScalar = (
  w: Writer,
  at: number,
  slot: number,
  kind: NumberWidth | "u64",
  value: number | bigint
): Result<void, TdbinError> => {
  const spec = SPECS[kind];
  const v = checked(spec, value);
  return v.ok ? writer.scalar(w, at, slot, wordOf(spec, v.value)) : v;
};

/** Read one `number` width scalar from data word `slot`. */
export const readNumber = (r: Reader, at: number, slot: number, kind: NumberWidth): Result<number, TdbinError> => {
  const word = reader.scalar(r, at, slot);
  const v = word.ok ? valueOf(SPECS[kind], word.value) : word;
  return v.ok ? ok(Number(v.value)) : v;
};

/** Read one `U64` scalar (lossless bigint). */
export const readU64 = (r: Reader, at: number, slot: number): Result<bigint, TdbinError> => reader.scalar(r, at, slot);

const encodeList = (spec: Spec, values: readonly (number | bigint)[]): Result<Uint8Array, TdbinError> => {
  const out = new Uint8Array(values.length * spec.bytes);
  const view = new DataView(out.buffer);
  for (const [index, value] of values.entries()) {
    const v = checked(spec, value);
    if (!v.ok) {
      return v;
    }
    const word = wordOf(spec, v.value);
    for (let byte = 0; byte < spec.bytes; byte += 1) {
      view.setUint8(index * spec.bytes + byte, Number((word >> BigInt(byte * 8)) & 0xffn));
    }
  }
  return ok(out);
};

const decodeList = (spec: Spec, data: Uint8Array): Result<bigint[], TdbinError> => {
  const values: bigint[] = [];
  for (let offset = 0; offset < data.length; offset += spec.bytes) {
    let raw = 0n;
    for (let byte = spec.bytes - 1; byte >= 0; byte -= 1) {
      raw = (raw << 8n) | BigInt(data[offset + byte] ?? 0);
    }
    const v = valueOf(spec, spec.signed ? BigInt.asIntN(spec.bytes * 8, raw) : raw);
    if (!v.ok) {
      return v;
    }
    values.push(v.value);
  }
  return ok(values);
};

/** Write a width list (or null) into pointer `slot`. */
export const writeList = (
  w: Writer,
  at: number,
  dataWords: number,
  slot: number,
  kind: NumberWidth | "u64",
  values: readonly (number | bigint)[] | null
): Result<void, TdbinError> => {
  const spec = SPECS[kind];
  const data = values === null ? ok(null) : encodeList(spec, values);
  return data.ok ? writer.rawList(w, at, dataWords, slot, spec.elem, values?.length ?? 0, data.value) : data;
};

const readRaw = (
  r: Reader,
  at: number,
  dataWords: number,
  slot: number,
  kind: NumberWidth | "u64"
): Result<bigint[] | null, TdbinError> => {
  const spec = SPECS[kind];
  const raw = reader.rawList(r, at, dataWords, slot, spec.elem, spec.bytes);
  return !raw.ok ? raw : raw.value === null ? ok(null) : decodeList(spec, raw.value);
};

/** Read a `number` width list from pointer `slot` (null when absent). */
export const readNumberList = (
  r: Reader,
  at: number,
  dataWords: number,
  slot: number,
  kind: NumberWidth
): Result<number[] | null, TdbinError> => {
  const values = readRaw(r, at, dataWords, slot, kind);
  return values.ok ? ok(values.value?.map(Number) ?? null) : values;
};

/** Read a `List<U64>` from pointer `slot` (null when absent). */
export const readU64List = (
  r: Reader,
  at: number,
  dataWords: number,
  slot: number
): Result<bigint[] | null, TdbinError> => readRaw(r, at, dataWords, slot, "u64");
