import { ok, type Result } from "../result.js";
import { tdbinErr } from "./error.js";
import { decodePointer, targetWord } from "./pointer.js";
import type { Pointer, TdbinError } from "./types.js";
import { WORD_BITS, WORD_BYTES, readWord, requireWordRange } from "./word.js";

const MAX_DEPTH = 64;

interface Budget {
  value: number;
}

export const verifyMessage = (bytes: Uint8Array, view: DataView): Result<void, TdbinError> => {
  const budget = { value: bytes.length / WORD_BYTES - 1 };
  return verifyPointerWord(bytes, view, 0, MAX_DEPTH + 1, budget);
};

const verifyPointerWord = (
  bytes: Uint8Array,
  view: DataView,
  at: number,
  depth: number,
  budget: Budget
): Result<void, TdbinError> => {
  const word = readWord(bytes, view, at);
  const pointer = word.ok ? decodePointer(word.value) : word;
  return pointer.ok ? verifyPointer(bytes, view, at, pointer.value, depth, budget) : pointer;
};

const verifyPointer = (
  bytes: Uint8Array,
  view: DataView,
  at: number,
  pointer: Pointer,
  depth: number,
  budget: Budget
): Result<void, TdbinError> => {
  if (pointer.kind === "null") {
    return ok(undefined);
  }
  return pointer.kind === "struct"
    ? verifyStruct(bytes, view, at, pointer, depth, budget)
    : verifyList(bytes, view, at, pointer, depth, budget);
};

const verifyStruct = (
  bytes: Uint8Array,
  view: DataView,
  at: number,
  pointer: Extract<Pointer, { kind: "struct" }>,
  depth: number,
  budget: Budget
): Result<void, TdbinError> => {
  const nextDepth = descend(depth);
  const target = targetWord(at, pointer.offset);
  const words = pointer.dataWords + pointer.ptrWords;
  const bounds = target.ok ? requireWordRange(bytes, target.value, words) : target;
  const consumed = bounds.ok ? consume(budget, words) : bounds;
  return target.ok && consumed.ok && nextDepth.ok
    ? verifyStructPointers(bytes, view, target.value, pointer.dataWords, pointer.ptrWords, nextDepth.value, budget)
    : firstError(target, consumed, nextDepth);
};

const verifyStructPointers = (
  bytes: Uint8Array,
  view: DataView,
  target: number,
  dataWords: number,
  ptrWords: number,
  depth: number,
  budget: Budget
): Result<void, TdbinError> => {
  for (let slot = 0; slot < ptrWords; slot += 1) {
    const verified = verifyPointerWord(bytes, view, target + dataWords + slot, depth, budget);
    if (!verified.ok) {
      return verified;
    }
  }
  return ok(undefined);
};

const verifyList = (
  bytes: Uint8Array,
  view: DataView,
  at: number,
  pointer: Extract<Pointer, { kind: "list" }>,
  depth: number,
  budget: Budget
): Result<void, TdbinError> => {
  const nextDepth = descend(depth);
  const target = targetWord(at, pointer.offset);
  if (!target.ok || !nextDepth.ok) {
    return firstError(target, nextDepth);
  }
  return pointer.elem === 6
    ? verifyPointerList(bytes, view, target.value, pointer.count, nextDepth.value, budget)
    : pointer.elem === 7
      ? verifyCompositeList(bytes, view, target.value, pointer.count, nextDepth.value, budget)
      : verifyFlatList(bytes, target.value, flatListWords(pointer.elem, pointer.count), budget);
};

const verifyFlatList = (
  bytes: Uint8Array,
  target: number,
  words: Result<number, TdbinError>,
  budget: Budget
): Result<void, TdbinError> => {
  const bounds = words.ok ? requireWordRange(bytes, target, words.value) : words;
  return words.ok && bounds.ok ? consume(budget, words.value) : firstError(words, bounds);
};

const verifyPointerList = (
  bytes: Uint8Array,
  view: DataView,
  target: number,
  count: number,
  depth: number,
  budget: Budget
): Result<void, TdbinError> => {
  const bounds = requireWordRange(bytes, target, count);
  const consumed = bounds.ok ? consume(budget, count) : bounds;
  if (!consumed.ok) {
    return consumed;
  }
  for (let slot = 0; slot < count; slot += 1) {
    const verified = verifyPointerWord(bytes, view, target + slot, depth, budget);
    if (!verified.ok) {
      return verified;
    }
  }
  return ok(undefined);
};

const verifyCompositeList = (
  bytes: Uint8Array,
  view: DataView,
  tagAt: number,
  bodyWords: number,
  depth: number,
  budget: Budget
): Result<void, TdbinError> => {
  const bounds = requireWordRange(bytes, tagAt, bodyWords + 1);
  const consumed = bounds.ok ? consume(budget, bodyWords + 1) : bounds;
  const word = consumed.ok ? readWord(bytes, view, tagAt) : consumed;
  const tag = word.ok ? decodePointer(word.value) : word;
  return tag.ok && tag.value.kind === "struct"
    ? verifyCompositeTag(bytes, view, tagAt, bodyWords, tag.value, depth, budget)
    : tag.ok
      ? tdbinErr("MalformedCompositeTag")
      : tag;
};

const verifyCompositeTag = (
  bytes: Uint8Array,
  view: DataView,
  tagAt: number,
  bodyWords: number,
  tag: Extract<Pointer, { kind: "struct" }>,
  depth: number,
  budget: Budget
): Result<void, TdbinError> => {
  const stride = tag.dataWords + tag.ptrWords;
  const valid = tag.offset >= 0 && stride * tag.offset === bodyWords && (stride !== 0 || tag.offset === 0);
  if (!valid) {
    return tdbinErr("MalformedCompositeTag");
  }
  for (let index = 0; index < tag.offset; index += 1) {
    const target = tagAt + 1 + stride * index;
    const verified = verifyStructPointers(bytes, view, target, tag.dataWords, tag.ptrWords, depth, budget);
    if (!verified.ok) {
      return verified;
    }
  }
  return ok(undefined);
};

const flatListWords = (elem: number, count: number): Result<number, TdbinError> => {
  const bits = [0, 1, 8, 16, 32, 64][elem];
  const total = bits === undefined ? Number.NaN : bits * count;
  return Number.isSafeInteger(total) && total >= 0 ? ok(Math.ceil(total / WORD_BITS)) : tdbinErr("PointerKindMismatch");
};

const consume = (budget: Budget, words: number): Result<void, TdbinError> => {
  if (words > budget.value) {
    return tdbinErr("AmplificationExceeded");
  }
  budget.value -= words;
  return ok(undefined);
};

const descend = (depth: number): Result<number, TdbinError> => (depth > 0 ? ok(depth - 1) : tdbinErr("DepthExceeded"));

const firstError = (...results: readonly Result<unknown, TdbinError>[]): Result<never, TdbinError> => {
  const failure = results.find((result) => !result.ok);
  return failure ?? tdbinErr("LimitExceeded");
};
