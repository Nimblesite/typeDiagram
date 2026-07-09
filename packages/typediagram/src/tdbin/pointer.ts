import { ok, type Result } from "../result.js";
import { tdbinErr } from "./error.js";
import type { Pointer, TdbinError } from "./types.js";

export const ELEM_BIT = 1;
export const ELEM_BYTE = 2;
export const ELEM_EIGHT_BYTES = 5;
export const ELEM_POINTER = 6;
export const ELEM_COMPOSITE = 7;

const KIND_STRUCT = 0n;
const KIND_LIST = 1n;
const KIND_MASK = 0b11n;
const OFFSET_MASK = 0x3fff_ffffn;
const OFFSET_SIGN = 1n << 29n;
const OFFSET_SPAN = 1n << 30n;
const OFFSET_MIN = -(1 << 29);
const OFFSET_MAX = (1 << 29) - 1;
const COUNT_MAX = 0x1fff_ffff;
const SECTION_MAX = 0xffff;

const offsetBits = (offset: number): Result<bigint, TdbinError> =>
  Number.isInteger(offset) && offset >= OFFSET_MIN && offset <= OFFSET_MAX
    ? ok(BigInt.asUintN(64, BigInt(offset)) & OFFSET_MASK)
    : tdbinErr("OffsetOutOfRange");

const signExtend = (shifted: bigint): Result<number, TdbinError> => {
  const masked = shifted & OFFSET_MASK;
  const signed = (masked & OFFSET_SIGN) === 0n ? masked : masked - OFFSET_SPAN;
  return ok(Number(signed));
};

export const encodeStruct = (offset: number, dataWords: number, ptrWords: number): Result<bigint, TdbinError> => {
  const bits = offsetBits(offset);
  return bits.ok && dataWords <= SECTION_MAX && ptrWords <= SECTION_MAX
    ? ok(KIND_STRUCT | (bits.value << 2n) | (BigInt(dataWords) << 32n) | (BigInt(ptrWords) << 48n))
    : bits.ok
      ? tdbinErr("LimitExceeded")
      : bits;
};

export const encodeList = (offset: number, elem: number, count: number): Result<bigint, TdbinError> => {
  const bits = offsetBits(offset);
  return bits.ok && count <= COUNT_MAX
    ? ok(KIND_LIST | (bits.value << 2n) | (BigInt(elem) << 32n) | (BigInt(count) << 35n))
    : bits.ok
      ? tdbinErr("LimitExceeded")
      : bits;
};

export const decodePointer = (word: bigint): Result<Pointer, TdbinError> => {
  if (word === 0n) {
    return ok({ kind: "null" });
  }
  const offset = signExtend(word >> 2n);
  return offset.ok ? decodeNonNull(word, offset.value) : offset;
};

const decodeNonNull = (word: bigint, offset: number): Result<Pointer, TdbinError> => {
  const kind = word & KIND_MASK;
  if (kind === KIND_STRUCT) {
    return ok({
      kind: "struct",
      offset,
      dataWords: Number((word >> 32n) & 0xffffn),
      ptrWords: Number((word >> 48n) & 0xffffn),
    });
  }
  return kind === KIND_LIST
    ? ok({
        kind: "list",
        offset,
        elem: Number((word >> 32n) & 0b111n),
        count: Number((word >> 35n) & 0x1fff_ffffn),
      })
    : tdbinErr("ReservedPointerKind");
};

export const targetWord = (ptrWord: number, offset: number): Result<number, TdbinError> => {
  const target = ptrWord + 1 + offset;
  return Number.isSafeInteger(target) && target >= 0
    ? ok(target)
    : tdbinErr("PointerOutOfBounds", { wordIndex: ptrWord });
};

export const relOffset = (target: number, ptrWord: number): Result<number, TdbinError> => {
  const offset = target - (ptrWord + 1);
  return Number.isSafeInteger(offset) ? ok(offset) : tdbinErr("LimitExceeded");
};
