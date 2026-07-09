import { ok, type Result } from "../result.js";
import { tdbinErr } from "./error.js";
import { ELEM_BIT, ELEM_BYTE, ELEM_COMPOSITE, ELEM_EIGHT_BYTES, ELEM_POINTER, decodePointer, targetWord } from "./pointer.js";
import type { Pointer, Reader, StructCodec, TdbinError } from "./types.js";
import { WORD_BITS, WORD_BYTES, readWord, utf8Decode } from "./word.js";

const MAX_DEPTH = 64;

interface CompositeList {
  readonly first: number;
  readonly count: number;
  readonly dataWords: number;
  readonly ptrWords: number;
  readonly stride: number;
}

export const message = <T>(codec: StructCodec<T>, bytes: Uint8Array): Result<T, TdbinError> => {
  if (bytes.length === 0 || bytes.length % WORD_BYTES !== 0) {
    return tdbinErr<T>("BadLength");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const head = readWord(bytes, view, 0);
  const ptr = head.ok ? decodePointer(head.value) : head;
  return ptr.ok ? readRoot(codec, bytes, view, ptr.value) : ptr;
};

export const scalar = (reader: Reader, at: number, slot: number): Result<bigint, TdbinError> =>
  slot >= reader.dataWords ? ok(0n) : readWord(reader.bytes, reader.view, at + slot);

export const boolBit = (reader: Reader, at: number, slot: number, bit: number): Result<boolean, TdbinError> => {
  const word = scalar(reader, at, slot);
  return word.ok && bit >= 0 && bit < WORD_BITS
    ? ok((word.value & (1n << BigInt(bit))) !== 0n)
    : tdbinErr<boolean>("LimitExceeded");
};

export const string = (reader: Reader, at: number, _dataWords: number, slot: number): Result<string | null, TdbinError> => {
  const raw = bytes(reader, at, _dataWords, slot);
  if (!raw.ok) {
    return raw;
  }
  if (raw.value === null) {
    return ok(null);
  }
  return utf8Decode(raw.value);
};

export const bytes = (reader: Reader, at: number, _dataWords: number, slot: number): Result<Uint8Array | null, TdbinError> =>
  readBytes(reader, at, slot);

export const byteList = bytes;

export const boolList = (reader: Reader, at: number, _dataWords: number, slot: number): Result<boolean[] | null, TdbinError> =>
  readList(reader, at, slot, ELEM_BIT, readBoolBody);

export const wordList = (reader: Reader, at: number, _dataWords: number, slot: number): Result<bigint[] | null, TdbinError> =>
  readList(reader, at, slot, ELEM_EIGHT_BYTES, readWordBody);

export const bytes16List = (
  reader: Reader,
  at: number,
  _dataWords: number,
  slot: number
): Result<readonly (readonly [bigint, bigint])[] | null, TdbinError> =>
  readComposite(reader, at, slot, readBytes16Body);

export const stringList = (reader: Reader, at: number, _dataWords: number, slot: number): Result<string[] | null, TdbinError> =>
  readPointerList(reader, at, slot, readStringPointer);

export const bytesList = (reader: Reader, at: number, _dataWords: number, slot: number): Result<Uint8Array[] | null, TdbinError> =>
  readPointerList(reader, at, slot, readBytesPointer);

export const child = <T>(
  reader: Reader,
  at: number,
  _dataWords: number,
  slot: number,
  codec: StructCodec<T>
): Result<T | null, TdbinError> => {
  if (slot >= reader.ptrWords) {
    return ok(null);
  }
  const ptrWord = ptrIndex(reader, at, slot);
  const word = readWord(reader.bytes, reader.view, ptrWord);
  const ptr = word.ok ? decodePointer(word.value) : word;
  return ptr.ok ? readChildPointer(reader, ptrWord, codec, ptr.value) : ptr;
};

export const childList = <T>(
  reader: Reader,
  at: number,
  _dataWords: number,
  slot: number,
  codec: StructCodec<T>
): Result<T[] | null, TdbinError> =>
  readComposite(reader, at, slot, (r, info) => readChildBody(r, info, codec));

const readRoot = <T>(codec: StructCodec<T>, source: Uint8Array, view: DataView, ptr: Pointer): Result<T, TdbinError> => {
  if (ptr.kind !== "struct") {
    return ptr.kind === "null" ? tdbinErr<T>("NullRoot") : tdbinErr<T>("PointerKindMismatch");
  }
  const at = targetWord(0, ptr.offset);
  if (!at.ok) {
    return at;
  }
  const bounds = requireStructBounds(source, at.value, ptr.dataWords, ptr.ptrWords);
  if (!bounds.ok) {
    return bounds;
  }
  const reader = createReader(source, view, ptr.dataWords, ptr.ptrWords, source.length / WORD_BYTES);
  return codec.read(reader, at.value);
};

const createReader = (source: Uint8Array, view: DataView, dataWords: number, ptrWords: number, wordCount: number): Reader => ({
  bytes: source,
  view,
  dataWords,
  ptrWords,
  depth: MAX_DEPTH,
  budget: { value: wordCount },
});

const ptrIndex = (reader: Reader, at: number, slot: number): number => at + reader.dataWords + slot;

const readBytes = (reader: Reader, at: number, slot: number): Result<Uint8Array | null, TdbinError> => {
  if (slot >= reader.ptrWords) {
    return ok(null);
  }
  const ptrWord = ptrIndex(reader, at, slot);
  const word = readWord(reader.bytes, reader.view, ptrWord);
  const ptr = word.ok ? decodePointer(word.value) : word;
  return ptr.ok ? readBytesPointerKind(reader, ptrWord, ptr.value) : ptr;
};

const readList = <T>(
  reader: Reader,
  at: number,
  slot: number,
  elem: number,
  readBody: (reader: Reader, ptrWord: number, offset: number, count: number) => Result<T, TdbinError>
): Result<T | null, TdbinError> => {
  if (slot >= reader.ptrWords) {
    return ok(null);
  }
  const ptrWord = ptrIndex(reader, at, slot);
  const word = readWord(reader.bytes, reader.view, ptrWord);
  const ptr = word.ok ? decodePointer(word.value) : word;
  return ptr.ok ? readListPointer(reader, ptrWord, elem, readBody, ptr.value) : ptr;
};

const readComposite = <T>(
  reader: Reader,
  at: number,
  slot: number,
  readBody: (reader: Reader, info: CompositeList) => Result<T, TdbinError>
): Result<T | null, TdbinError> =>
  readList<T>(reader, at, slot, ELEM_COMPOSITE, (r, ptrWord, offset, count) => {
    const header = readCompositeHeader(r, ptrWord, offset, count);
    return header.ok ? readBody(r, header.value) : header;
  });

const readPointerList = <T>(
  reader: Reader,
  at: number,
  slot: number,
  readOne: (reader: Reader, ptrWord: number) => Result<T, TdbinError>
): Result<T[] | null, TdbinError> =>
  readList<T[]>(reader, at, slot, ELEM_POINTER, (r, ptrWord, offset, count) =>
    readPointerBody(r, ptrWord, offset, count, readOne)
  );

const readChildPointer = <T>(reader: Reader, ptrWord: number, codec: StructCodec<T>, ptr: Pointer): Result<T | null, TdbinError> => {
  if (ptr.kind === "null") {
    return ok(null);
  }
  return ptr.kind === "struct" ? followStruct(reader, ptrWord, codec, ptr) : tdbinErr<T | null>("PointerKindMismatch");
};

const readBytesPointerKind = (reader: Reader, ptrWord: number, ptr: Pointer): Result<Uint8Array | null, TdbinError> => {
  if (ptr.kind === "null") {
    return ok(null);
  }
  return ptr.kind === "list" && ptr.elem === ELEM_BYTE
    ? readListBytes(reader, ptrWord, ptr.offset, ptr.count)
    : tdbinErr<Uint8Array | null>("PointerKindMismatch");
};

const readListPointer = <T>(
  reader: Reader,
  ptrWord: number,
  elem: number,
  readBody: (reader: Reader, ptrWord: number, offset: number, count: number) => Result<T, TdbinError>,
  ptr: Pointer
): Result<T | null, TdbinError> => {
  if (ptr.kind === "null") {
    return ok(null);
  }
  return ptr.kind === "list" && ptr.elem === elem
    ? readBody(reader, ptrWord, ptr.offset, ptr.count)
    : tdbinErr<T | null>("PointerKindMismatch");
};

const followStruct = <T>(
  reader: Reader,
  ptrWord: number,
  codec: StructCodec<T>,
  ptr: Extract<Pointer, { kind: "struct" }>
): Result<T, TdbinError> => {
  const target = targetWord(ptrWord, ptr.offset);
  if (!target.ok) {
    return target;
  }
  const bounds = requireStructBounds(reader.bytes, target.value, ptr.dataWords, ptr.ptrWords);
  if (!bounds.ok) {
    return bounds;
  }
  const childReader = descend(reader, ptr.dataWords, ptr.ptrWords);
  return childReader.ok ? codec.read(childReader.value, target.value) : childReader;
};

const descend = (reader: Reader, dataWords: number, ptrWords: number): Result<Reader, TdbinError> => {
  if (reader.depth <= 0) {
    return tdbinErr("DepthExceeded");
  }
  if (reader.budget.value <= 0) {
    return tdbinErr("AmplificationExceeded");
  }
  reader.budget.value = reader.budget.value - 1;
  return ok({ ...reader, dataWords, ptrWords, depth: reader.depth - 1 });
};

const readListBytes = (reader: Reader, ptrWord: number, offset: number, count: number): Result<Uint8Array, TdbinError> => {
  const startWord = targetWord(ptrWord, offset);
  if (!startWord.ok) {
    return startWord;
  }
  const start = startWord.value * WORD_BYTES;
  const end = start + count;
  return end <= reader.bytes.length ? ok(reader.bytes.slice(start, end)) : tdbinErr("PointerOutOfBounds", { wordIndex: ptrWord });
};

const readBoolBody = (reader: Reader, ptrWord: number, offset: number, count: number): Result<boolean[], TdbinError> => {
  const start = targetWord(ptrWord, offset);
  if (!start.ok) {
    return start;
  }
  const words = Math.ceil(count / WORD_BITS);
  const bounds = requireWordRange(reader.bytes, start.value, words);
  return bounds.ok ? unpackBools(reader, start.value, count) : bounds;
};

const readWordBody = (reader: Reader, ptrWord: number, offset: number, count: number): Result<bigint[], TdbinError> => {
  const start = targetWord(ptrWord, offset);
  if (!start.ok) {
    return start;
  }
  const bounds = requireWordRange(reader.bytes, start.value, count);
  return bounds.ok ? readWords(reader, start.value, count) : bounds;
};

const readPointerBody = <T>(
  reader: Reader,
  ptrWord: number,
  offset: number,
  count: number,
  readOne: (reader: Reader, ptrWord: number) => Result<T, TdbinError>
): Result<T[], TdbinError> => {
  const start = targetWord(ptrWord, offset);
  if (!start.ok) {
    return start;
  }
  const bounds = requireWordRange(reader.bytes, start.value, count);
  return bounds.ok ? readPointerItems(reader, start.value, count, readOne) : bounds;
};

const readStringPointer = (reader: Reader, ptrWord: number): Result<string, TdbinError> => {
  const raw = readBytesPointer(reader, ptrWord);
  return raw.ok ? utf8Decode(raw.value) : raw;
};

const readBytesPointer = (reader: Reader, ptrWord: number): Result<Uint8Array, TdbinError> => {
  const word = readWord(reader.bytes, reader.view, ptrWord);
  const ptr = word.ok ? decodePointer(word.value) : word;
  const raw = ptr.ok ? readBytesPointerKind(reader, ptrWord, ptr.value) : ptr;
  return raw.ok ? ok(raw.value ?? new Uint8Array()) : raw;
};

const readBytes16Body = (reader: Reader, info: CompositeList): Result<readonly (readonly [bigint, bigint])[], TdbinError> => {
  if (info.dataWords !== 2 || info.ptrWords !== 0) {
    return tdbinErr<readonly (readonly [bigint, bigint])[]>("PointerKindMismatch");
  }
  return readBytes16Items(reader, info);
};

const readChildBody = <T>(reader: Reader, info: CompositeList, codec: StructCodec<T>): Result<T[], TdbinError> =>
  Array.from({ length: info.count }).reduce<Result<T[], TdbinError>>((state, _value, index) => {
    if (!state.ok) {
      return state;
    }
    const at = elemAt(info, index);
    if (!at.ok) {
      return at;
    }
    const childValue = readInlineStruct(reader, at.value, info, codec);
    return childValue.ok ? ok([...state.value, childValue.value]) : childValue;
  }, ok([]));

const readCompositeHeader = (
  reader: Reader,
  ptrWord: number,
  offset: number,
  elemWords: number
): Result<CompositeList, TdbinError> => {
  const tagAt = targetWord(ptrWord, offset);
  const word = tagAt.ok ? readWord(reader.bytes, reader.view, tagAt.value) : tagAt;
  const ptr = word.ok ? decodePointer(word.value) : word;
  return tagAt.ok && ptr.ok && ptr.value.kind === "struct"
    ? compositeInfo(reader.bytes, tagAt.value, ptr.value.offset, ptr.value.dataWords, ptr.value.ptrWords, elemWords)
    : tdbinErr<CompositeList>("PointerKindMismatch");
};

const compositeInfo = (
  source: Uint8Array,
  tagAt: number,
  count: number,
  dataWords: number,
  ptrWords: number,
  elemWords: number
): Result<CompositeList, TdbinError> => {
  const stride = dataWords + ptrWords;
  const expected = stride * count;
  const valid = expected === elemWords && (stride !== 0 || count === 0);
  if (!valid) {
    return tdbinErr<CompositeList>("PointerKindMismatch");
  }
  const bounds = requireWordRange(source, tagAt, expected + 1);
  return bounds.ok ? ok({ first: tagAt + 1, count, dataWords, ptrWords, stride }) : bounds;
};

const readInlineStruct = <T>(reader: Reader, at: number, info: CompositeList, codec: StructCodec<T>): Result<T, TdbinError> => {
  const bounds = requireStructBounds(reader.bytes, at, info.dataWords, info.ptrWords);
  if (!bounds.ok) {
    return bounds;
  }
  const childReader = descend(reader, info.dataWords, info.ptrWords);
  return childReader.ok ? codec.read(childReader.value, at) : childReader;
};

const unpackBools = (reader: Reader, start: number, count: number): Result<boolean[], TdbinError> =>
  Array.from({ length: count }).reduce<Result<boolean[], TdbinError>>((state, _value, index) => {
    if (!state.ok) {
      return state;
    }
    const word = readWord(reader.bytes, reader.view, start + Math.floor(index / WORD_BITS));
    return word.ok ? ok([...state.value, (word.value & (1n << BigInt(index % WORD_BITS))) !== 0n]) : word;
  }, ok([]));

const readWords = (reader: Reader, start: number, count: number): Result<bigint[], TdbinError> =>
  Array.from({ length: count }).reduce<Result<bigint[], TdbinError>>((state, _value, index) => {
    if (!state.ok) {
      return state;
    }
    const word = readWord(reader.bytes, reader.view, start + index);
    return word.ok ? ok([...state.value, word.value]) : word;
  }, ok([]));

const readPointerItems = <T>(
  reader: Reader,
  start: number,
  count: number,
  readOne: (reader: Reader, ptrWord: number) => Result<T, TdbinError>
): Result<T[], TdbinError> =>
  Array.from({ length: count }).reduce<Result<T[], TdbinError>>((state, _value, index) => {
    if (!state.ok) {
      return state;
    }
    const item = readOne(reader, start + index);
    return item.ok ? ok([...state.value, item.value]) : item;
  }, ok([]));

const readBytes16Items = (
  reader: Reader,
  info: CompositeList
): Result<readonly (readonly [bigint, bigint])[], TdbinError> =>
  Array.from({ length: info.count }).reduce<Result<readonly (readonly [bigint, bigint])[], TdbinError>>((state, _value, index) => {
    if (!state.ok) {
      return state;
    }
    const at = elemAt(info, index);
    if (!at.ok) {
      return at;
    }
    const first = readWord(reader.bytes, reader.view, at.value);
    if (!first.ok) {
      return first;
    }
    const second = readWord(reader.bytes, reader.view, at.value + 1);
    return second.ok ? ok([...state.value, [first.value, second.value]]) : second;
  }, ok([]));

const elemAt = (info: CompositeList, index: number): Result<number, TdbinError> => ok(info.first + info.stride * index);

const requireStructBounds = (source: Uint8Array, at: number, dataWords: number, ptrWords: number) =>
  requireWordRange(source, at, dataWords + ptrWords);

const requireWordRange = (source: Uint8Array, at: number, words: number): Result<void, TdbinError> =>
  at >= 0 && at + words <= source.length / WORD_BYTES ? ok(undefined) : tdbinErr("PointerOutOfBounds", { wordIndex: at });
