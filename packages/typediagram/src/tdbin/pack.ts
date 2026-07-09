import { ok, type Result } from "../result.js";
import { tdbinErr } from "./error.js";
import type { TdbinError } from "./types.js";
import { WORD_BYTES } from "./word.js";

const MAX_UNPACKED_BYTES = 1 << 29;
const ZERO_RUN_TAG = 0;
const DENSE_RUN_TAG = 0xff;
const MAX_RUN_COUNT = 255;
const DENSE_NONZERO_BYTES = 7;

export const encodePacked = (body: Uint8Array): Result<Uint8Array, TdbinError> => {
  if (body.length % WORD_BYTES !== 0) {
    return tdbinErr("BadLength");
  }
  const out: number[] = [];
  let offset = 0;
  while (offset < body.length) {
    offset = encodeWord(body, offset, out);
  }
  return ok(Uint8Array.from(out));
};

export const decodePacked = (packed: Uint8Array): Result<Uint8Array, TdbinError> => {
  const out: number[] = [];
  let cursor = 0;
  while (cursor < packed.length) {
    const tag = Number(packed[cursor]);
    const decoded = decodeTag(tag, packed, cursor + 1, out);
    if (!decoded.ok) {
      return decoded;
    }
    cursor = decoded.value;
  }
  return ok(Uint8Array.from(out));
};

const encodeWord = (body: Uint8Array, offset: number, out: number[]): number => {
  const word = body.slice(offset, offset + WORD_BYTES);
  const tag = tagWord(word);
  return tag === ZERO_RUN_TAG
    ? encodeZeroRun(body, offset, out)
    : tag === DENSE_RUN_TAG
      ? encodeDenseRun(body, offset, word, out)
      : encodeSparseWord(offset, word, tag, out);
};

const encodeZeroRun = (body: Uint8Array, offset: number, out: number[]): number => {
  const extra = countMatchingExtras(body, offset + WORD_BYTES, isZeroWord);
  out.push(ZERO_RUN_TAG, extra);
  return offset + (extra + 1) * WORD_BYTES;
};

const encodeDenseRun = (body: Uint8Array, offset: number, word: Uint8Array, out: number[]): number => {
  const extra = countMatchingExtras(body, offset + WORD_BYTES, isDenseWord);
  out.push(DENSE_RUN_TAG, ...word, extra);
  const start = offset + WORD_BYTES;
  out.push(...body.slice(start, start + extra * WORD_BYTES));
  return start + extra * WORD_BYTES;
};

const encodeSparseWord = (offset: number, word: Uint8Array, tag: number, out: number[]): number => {
  out.push(tag);
  word.forEach((byte) => (byte === 0 ? undefined : out.push(byte)));
  return offset + WORD_BYTES;
};

const decodeTag = (tag: number, packed: Uint8Array, cursor: number, out: number[]): Result<number, TdbinError> =>
  tag === ZERO_RUN_TAG
    ? decodeZeroRun(packed, cursor, out)
    : tag === DENSE_RUN_TAG
      ? decodeDenseRun(packed, cursor, out)
      : decodeSparseWord(tag, packed, cursor, out);

const decodeZeroRun = (packed: Uint8Array, cursor: number, out: number[]): Result<number, TdbinError> => {
  const extra = packed[cursor];
  if (extra === undefined) {
    return tdbinErr("PackedTruncated");
  }
  return appendBytes(out, new Uint8Array((extra + 1) * WORD_BYTES)).ok ? ok(cursor + 1) : tdbinErr("LimitExceeded");
};

const decodeDenseRun = (packed: Uint8Array, cursor: number, out: number[]): Result<number, TdbinError> => {
  const wordEnd = cursor + WORD_BYTES;
  const word = packed.slice(cursor, wordEnd);
  const extra = packed[wordEnd];
  if (word.length !== WORD_BYTES || extra === undefined) {
    return tdbinErr("PackedTruncated");
  }
  const rawStart = wordEnd + 1;
  const rawEnd = rawStart + extra * WORD_BYTES;
  const raw = packed.slice(rawStart, rawEnd);
  return raw.length === extra * WORD_BYTES && appendBytes(out, word).ok && appendBytes(out, raw).ok
    ? ok(rawEnd)
    : tdbinErr("PackedTruncated");
};

const decodeSparseWord = (
  tag: number,
  packed: Uint8Array,
  cursor: number,
  out: number[]
): Result<number, TdbinError> => {
  const word = new Uint8Array(WORD_BYTES);
  let next = cursor;
  for (let offset = 0; offset < WORD_BYTES; offset += 1) {
    if ((tag & (1 << offset)) !== 0) {
      const byte = packed[next];
      if (byte === undefined) {
        return tdbinErr("PackedTruncated");
      }
      word[offset] = byte;
      next += 1;
    }
  }
  return appendBytes(out, word).ok ? ok(next) : tdbinErr("LimitExceeded");
};

const countMatchingExtras = (body: Uint8Array, start: number, predicate: (word: Uint8Array) => boolean): number => {
  let count = 0;
  let offset = start;
  while (count < MAX_RUN_COUNT && offset < body.length && predicate(body.slice(offset, offset + WORD_BYTES))) {
    count += 1;
    offset += WORD_BYTES;
  }
  return count;
};

const tagWord = (word: Uint8Array): number =>
  word.reduce((tag, byte, offset) => (byte === 0 ? tag : tag | (1 << offset)), 0);

const isZeroWord = (word: Uint8Array): boolean => tagWord(word) === ZERO_RUN_TAG;

const isDenseWord = (word: Uint8Array): boolean => word.filter((byte) => byte !== 0).length >= DENSE_NONZERO_BYTES;

const appendBytes = (out: number[], bytes: Uint8Array): Result<void, TdbinError> => {
  if (out.length + bytes.length > MAX_UNPACKED_BYTES) {
    return tdbinErr("LimitExceeded");
  }
  out.push(...bytes);
  return ok(undefined);
};
