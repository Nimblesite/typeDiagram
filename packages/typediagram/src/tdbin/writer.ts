import { ok, type Result } from "../result.js";
import { tdbinErr } from "./error.js";
import {
  ELEM_BIT,
  ELEM_BYTE,
  ELEM_COMPOSITE,
  ELEM_EIGHT_BYTES,
  ELEM_POINTER,
  encodeList,
  encodeStruct,
  relOffset,
} from "./pointer.js";
import type { StructCodec, TdbinError, Writer } from "./types.js";
import { WORD_BITS, WORD_BYTES, utf8Encode, wordsToBytes } from "./word.js";

const MAX_WORDS = 1 << 26;

export const createWriter = (): Writer => ({ body: [] });

export const message = <T>(codec: StructCodec<T>, value: T): Result<Uint8Array, TdbinError> => {
  const writer: Writer = { body: [0n] };
  const root = 0;
  const body = reserve(writer, codec.dataWords + codec.ptrWords);
  if (!body.ok) {
    return body;
  }
  const written = codec.write(writer, body.value, value);
  if (!written.ok) {
    return written;
  }
  const ptr = structPtr(body.value, root, codec.dataWords, codec.ptrWords);
  if (!ptr.ok) {
    return ptr;
  }
  writer.body[root] = ptr.value;
  return ok(wordsToBytes(writer.body));
};

export const scalar = (writer: Writer, at: number, slot: number, bits: bigint): Result<void, TdbinError> =>
  setWord(writer, at + slot, bits);

export const boolBit = (writer: Writer, at: number, slot: number, bit: number, value: boolean) => {
  const idx = at + slot;
  const current = writer.body[idx];
  if (current === undefined || bit < 0 || bit >= WORD_BITS) {
    return tdbinErr<undefined>("LimitExceeded");
  }
  const mask = 1n << BigInt(bit);
  writer.body[idx] = value ? current | mask : current & ~mask;
  return ok(undefined);
};

export const string = (writer: Writer, at: number, dataWords: number, slot: number, value: string | null) =>
  bytes(writer, at, dataWords, slot, value === null ? null : utf8Encode(value));

export const bytes = (
  writer: Writer,
  at: number,
  dataWords: number,
  slot: number,
  value: Uint8Array | null
): Result<void, TdbinError> => {
  const ptrWord = ptrIndex(at, dataWords, slot);
  return value === null ? setWord(writer, ptrWord, 0n) : writeByteList(writer, ptrWord, value);
};

export const boolList = (
  writer: Writer,
  at: number,
  dataWords: number,
  slot: number,
  values: readonly boolean[] | null
) => {
  const ptrWord = ptrIndex(at, dataWords, slot);
  return values === null ? setWord(writer, ptrWord, 0n) : writeBoolList(writer, ptrWord, values);
};

export const byteList = bytes;

export const wordList = (
  writer: Writer,
  at: number,
  dataWords: number,
  slot: number,
  values: readonly bigint[] | null
): Result<void, TdbinError> => {
  const ptrWord = ptrIndex(at, dataWords, slot);
  return values === null ? setWord(writer, ptrWord, 0n) : writeWordList(writer, ptrWord, values);
};

export const bytes16List = (
  writer: Writer,
  at: number,
  dataWords: number,
  slot: number,
  values: readonly (readonly [bigint, bigint])[] | null
): Result<void, TdbinError> => {
  const ptrWord = ptrIndex(at, dataWords, slot);
  return values === null ? setWord(writer, ptrWord, 0n) : writeBytes16List(writer, ptrWord, values);
};

export const stringList = (
  writer: Writer,
  at: number,
  dataWords: number,
  slot: number,
  values: readonly string[] | null
) => {
  const ptrWord = ptrIndex(at, dataWords, slot);
  return values === null ? setWord(writer, ptrWord, 0n) : writePointerList(writer, ptrWord, values, writeStringPointer);
};

export const bytesList = (
  writer: Writer,
  at: number,
  dataWords: number,
  slot: number,
  values: readonly Uint8Array[] | null
): Result<void, TdbinError> => {
  const ptrWord = ptrIndex(at, dataWords, slot);
  return values === null ? setWord(writer, ptrWord, 0n) : writePointerList(writer, ptrWord, values, writeBytesPointer);
};

export const child = <T>(
  writer: Writer,
  at: number,
  dataWords: number,
  slot: number,
  codec: StructCodec<T>,
  value: T | null
): Result<void, TdbinError> => {
  const ptrWord = ptrIndex(at, dataWords, slot);
  return value === null ? setWord(writer, ptrWord, 0n) : writeChild(writer, ptrWord, codec, value);
};

export const childList = <T>(
  writer: Writer,
  at: number,
  dataWords: number,
  slot: number,
  codec: StructCodec<T>,
  values: readonly T[] | null
): Result<void, TdbinError> => {
  const ptrWord = ptrIndex(at, dataWords, slot);
  return values === null ? setWord(writer, ptrWord, 0n) : writeChildList(writer, ptrWord, codec, values);
};

const reserve = (writer: Writer, words: number): Result<number, TdbinError> => {
  const start = writer.body.length;
  const end = start + words;
  if (!Number.isSafeInteger(end) || end > MAX_WORDS) {
    return tdbinErr("LimitExceeded");
  }
  writer.body.length = end;
  writer.body.fill(0n, start, end);
  return ok(start);
};

const setWord = (writer: Writer, idx: number, value: bigint): Result<void, TdbinError> => {
  if (idx < 0 || idx >= writer.body.length) {
    return tdbinErr("LimitExceeded");
  }
  writer.body[idx] = BigInt.asUintN(64, value);
  return ok(undefined);
};

const ptrIndex = (at: number, dataWords: number, slot: number): number => at + dataWords + slot;

const structPtr = (target: number, ptrWord: number, dataWords: number, ptrWords: number) => {
  const offset = relOffset(target, ptrWord);
  return offset.ok ? encodeStruct(offset.value, dataWords, ptrWords) : offset;
};

const listPtr = (target: number, ptrWord: number, elem: number, count: number) => {
  const offset = relOffset(target, ptrWord);
  return offset.ok ? encodeList(offset.value, elem, count) : offset;
};

const setListPtr = (writer: Writer, ptrWord: number, target: number, elem: number, count: number) => {
  const ptr = listPtr(target, ptrWord, elem, count);
  return ptr.ok ? setWord(writer, ptrWord, ptr.value) : ptr;
};

const writeByteList = (writer: Writer, ptrWord: number, data: Uint8Array) => {
  const words = Math.ceil(data.length / WORD_BYTES);
  const start = reserve(writer, words);
  const packed = start.ok ? packBytes(writer, start.value, data) : start;
  return start.ok && packed.ok ? setListPtr(writer, ptrWord, start.value, ELEM_BYTE, data.length) : packed;
};

const writeBoolList = (writer: Writer, ptrWord: number, values: readonly boolean[]) => {
  const start = reserve(writer, Math.ceil(values.length / WORD_BITS));
  const packed = start.ok ? packBools(writer, start.value, values) : start;
  return start.ok && packed.ok ? setListPtr(writer, ptrWord, start.value, ELEM_BIT, values.length) : packed;
};

const writeWordList = (writer: Writer, ptrWord: number, values: readonly bigint[]) => {
  const start = reserve(writer, values.length);
  const copied = start.ok ? copyWords(writer, start.value, values) : start;
  return start.ok && copied.ok ? setListPtr(writer, ptrWord, start.value, ELEM_EIGHT_BYTES, values.length) : copied;
};

const writePointerList = <T>(
  writer: Writer,
  ptrWord: number,
  values: readonly T[],
  writeOne: (writer: Writer, ptrWord: number, value: T) => Result<void, TdbinError>
) => {
  const start = reserve(writer, values.length);
  const ptr = start.ok ? setListPtr(writer, ptrWord, start.value, ELEM_POINTER, values.length) : start;
  return start.ok && ptr.ok ? writeEachPointer(writer, start.value, values, writeOne) : ptr;
};

const writeChild = <T>(writer: Writer, ptrWord: number, codec: StructCodec<T>, value: T) => {
  const start = reserve(writer, codec.dataWords + codec.ptrWords);
  if (!start.ok) {
    return start;
  }
  const written = codec.write(writer, start.value, value);
  if (!written.ok) {
    return written;
  }
  const ptr = structPtr(start.value, ptrWord, codec.dataWords, codec.ptrWords);
  return ptr.ok ? setWord(writer, ptrWord, ptr.value) : ptr;
};

const writeChildList = <T>(writer: Writer, ptrWord: number, codec: StructCodec<T>, values: readonly T[]) => {
  const stride = codec.dataWords + codec.ptrWords;
  const elemWords = stride * values.length;
  const start =
    stride === 0 && values.length !== 0 ? tdbinErr<number>("LimitExceeded") : reserve(writer, elemWords + 1);
  const tag = start.ok ? writeCompositeTag(writer, start.value, values.length, codec.dataWords, codec.ptrWords) : start;
  const items = start.ok && tag.ok ? writeCompositeItems(writer, start.value, stride, codec, values) : tag;
  return start.ok && items.ok ? setListPtr(writer, ptrWord, start.value, ELEM_COMPOSITE, elemWords) : items;
};

const writeBytes16List = (writer: Writer, ptrWord: number, values: readonly (readonly [bigint, bigint])[]) => {
  const elemWords = values.length * 2;
  const start = reserve(writer, elemWords + 1);
  const tag = start.ok ? writeCompositeTag(writer, start.value, values.length, 2, 0) : start;
  const items = start.ok && tag.ok ? writeBytes16Items(writer, start.value, values) : tag;
  return start.ok && items.ok ? setListPtr(writer, ptrWord, start.value, ELEM_COMPOSITE, elemWords) : items;
};

const writeCompositeTag = (writer: Writer, start: number, count: number, dataWords: number, ptrWords: number) => {
  const tag = encodeStruct(count, dataWords, ptrWords);
  return tag.ok ? setWord(writer, start, tag.value) : tag;
};

const writeCompositeItems = <T>(
  writer: Writer,
  start: number,
  stride: number,
  codec: StructCodec<T>,
  values: readonly T[]
) =>
  values.reduce<Result<void, TdbinError>>(
    (state, value, index) => (state.ok ? codec.write(writer, start + 1 + stride * index, value) : state),
    ok(undefined)
  );

const writeBytes16Items = (writer: Writer, start: number, values: readonly (readonly [bigint, bigint])[]) =>
  values.reduce<Result<void, TdbinError>>((state, value, index) => {
    const first = value[0];
    const second = value[1];
    const at = start + 1 + index * 2;
    const written = state.ok ? setWord(writer, at, first) : state;
    return written.ok ? setWord(writer, at + 1, second) : written;
  }, ok(undefined));

const packBytes = (writer: Writer, start: number, data: Uint8Array) => {
  for (let offset = 0; offset < data.length; offset += WORD_BYTES) {
    const chunk = data.slice(offset, offset + WORD_BYTES);
    const word = new Uint8Array(WORD_BYTES);
    word.set(chunk);
    const view = new DataView(word.buffer);
    writer.body[start + offset / WORD_BYTES] = view.getBigUint64(0, true);
  }
  return ok(undefined);
};

const packBools = (writer: Writer, start: number, values: readonly boolean[]) =>
  values.reduce<Result<void, TdbinError>>((state, value, index) => {
    const word = Math.floor(index / WORD_BITS);
    const bit = index % WORD_BITS;
    return state.ok && value ? boolBit(writer, start, word, bit, true) : state;
  }, ok(undefined));

const copyWords = (writer: Writer, start: number, values: readonly bigint[]) =>
  values.reduce<Result<void, TdbinError>>(
    (state, word, index) => (state.ok ? setWord(writer, start + index, word) : state),
    ok(undefined)
  );

const writeEachPointer = <T>(
  writer: Writer,
  start: number,
  values: readonly T[],
  writeOne: (writer: Writer, ptrWord: number, value: T) => Result<void, TdbinError>
) =>
  values.reduce<Result<void, TdbinError>>(
    (state, value, index) => (state.ok ? writeOne(writer, start + index, value) : state),
    ok(undefined)
  );

const writeStringPointer = (writer: Writer, ptrWord: number, value: string) =>
  writeByteList(writer, ptrWord, utf8Encode(value));

const writeBytesPointer = (writer: Writer, ptrWord: number, value: Uint8Array) => writeByteList(writer, ptrWord, value);
