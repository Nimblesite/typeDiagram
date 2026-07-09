import { ok, type Result } from "../result.js";
import { tdbinErr } from "./error.js";
import type { TdbinError } from "./types.js";

export const WORD_BYTES = 8;
export const WORD_BITS = WORD_BYTES * 8;
const SCRATCH = new ArrayBuffer(WORD_BYTES);
const SCRATCH_VIEW = new DataView(SCRATCH);
const MAX_SAFE_I64 = 9_007_199_254_740_991;
const MIN_SAFE_I64 = -MAX_SAFE_I64;

export const readWord = (bytes: Uint8Array, view: DataView, idx: number): Result<bigint, TdbinError> => {
  const start = idx * WORD_BYTES;
  const end = start + WORD_BYTES;
  return start >= 0 && end <= bytes.length
    ? ok(view.getBigUint64(start, true))
    : tdbinErr("PointerOutOfBounds", { wordIndex: idx });
};

export const wordsToBytes = (words: readonly bigint[]): Uint8Array => {
  const out = new Uint8Array(words.length * WORD_BYTES);
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  words.forEach((word, index) => {
    view.setBigUint64(index * WORD_BYTES, BigInt.asUintN(64, word), true);
  });
  return out;
};

export const i64Bits = (value: number): Result<bigint, TdbinError> =>
  Number.isSafeInteger(value) && value >= MIN_SAFE_I64 && value <= MAX_SAFE_I64
    ? ok(BigInt.asUintN(64, BigInt(value)))
    : tdbinErr("LimitExceeded");

export const i64From = (word: bigint): number => Number(BigInt.asIntN(64, word));

export const f64Bits = (value: number): bigint => {
  SCRATCH_VIEW.setFloat64(0, value, true);
  return SCRATCH_VIEW.getBigUint64(0, true);
};

export const f64From = (word: bigint): number => {
  SCRATCH_VIEW.setBigUint64(0, BigInt.asUintN(64, word), true);
  return SCRATCH_VIEW.getFloat64(0, true);
};

export const boolBits = (value: boolean): bigint => (value ? 1n : 0n);

export const boolFrom = (word: bigint): boolean => (word & 1n) === 1n;

export const bytes16Words = (bytes: Uint8Array): Result<readonly [bigint, bigint], TdbinError> => {
  if (bytes.length !== 16) {
    return tdbinErr("BadLength");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return ok([view.getBigUint64(0, true), view.getBigUint64(8, true)]);
};

export const bytes16FromWords = (first: bigint, second: bigint): Uint8Array => {
  const out = new Uint8Array(16);
  const view = new DataView(out.buffer);
  view.setBigUint64(0, BigInt.asUintN(64, first), true);
  view.setBigUint64(8, BigInt.asUintN(64, second), true);
  return out;
};

export const utf8Encode = (text: string): Uint8Array => new TextEncoder().encode(text);

export const utf8Decode = (bytes: Uint8Array): Result<string, TdbinError> => {
  try {
    return ok(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return tdbinErr("InvalidUtf8");
  }
};
