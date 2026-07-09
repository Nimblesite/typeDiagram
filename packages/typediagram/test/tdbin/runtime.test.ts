import { describe, expect, it } from "vitest";
import { ok, type Result } from "../../src/result.js";
import * as tdbin from "../../src/tdbin/index.js";
import type { Reader, StructCodec, TdbinError, Writer } from "../../src/tdbin/index.js";

interface Child {
  readonly count: number;
}

interface Lists {
  readonly raw: Uint8Array;
  readonly flags: readonly boolean[];
  readonly nums: readonly number[];
  readonly ids: readonly Uint8Array[];
  readonly names: readonly string[];
  readonly blobs: readonly Uint8Array[];
  readonly kids: readonly Child[];
  readonly maybeNums: readonly number[] | undefined;
}

interface Maybe {
  readonly text: string | undefined;
  readonly blob: Uint8Array | undefined;
  readonly child: Child | undefined;
  readonly nums: readonly number[] | undefined;
}

const expectOk = <T>(result: Result<T, TdbinError>): T => {
  expect(result.ok, result.ok ? "" : result.error.message).toBe(true);
  return result.ok ? result.value : (undefined as never);
};

const expectErr = <T>(result: Result<T, TdbinError>, code: TdbinError["code"]) => {
  expect(result.ok ? "" : result.error.code).toBe(code);
};

const intBits = (value: number): bigint => expectOk(tdbin.scalar.i64Bits(value));

const writeInt = (writer: Writer, at: number, slot: number, value: number): Result<void, TdbinError> =>
  tdbin.writer.scalar(writer, at, slot, intBits(value));

const readInt = (reader: Reader, at: number, slot: number): Result<number, TdbinError> => {
  const word = tdbin.reader.scalar(reader, at, slot);
  return word.ok ? ok(tdbin.scalar.i64From(word.value)) : word;
};

const ChildCodec: StructCodec<Child> = {
  dataWords: 1,
  ptrWords: 0,
  write: (writer, at, value) => writeInt(writer, at, 0, value.count),
  read: (reader, at) => {
    const count = readInt(reader, at, 0);
    return count.ok ? ok({ count: count.value }) : count;
  },
};

const ListsCodec: StructCodec<Lists> = {
  dataWords: 0,
  ptrWords: 8,
  write: (writer, at, value) => {
    const raw = tdbin.writer.byteList(writer, at, ListsCodec.dataWords, 0, value.raw);
    const flags = raw.ok ? tdbin.writer.boolList(writer, at, ListsCodec.dataWords, 1, value.flags) : raw;
    const nums = flags.ok ? writeNumberList(writer, at, 2, value.nums) : flags;
    const ids = nums.ok ? tdbin.writer.bytes16List(writer, at, ListsCodec.dataWords, 3, value.ids.map(words16)) : nums;
    const names = ids.ok ? tdbin.writer.stringList(writer, at, ListsCodec.dataWords, 4, value.names) : ids;
    const blobs = names.ok ? tdbin.writer.bytesList(writer, at, ListsCodec.dataWords, 5, value.blobs) : names;
    const kids = blobs.ok ? tdbin.writer.childList(writer, at, ListsCodec.dataWords, 6, ChildCodec, value.kids) : blobs;
    return kids.ok ? writeNumberList(writer, at, 7, value.maybeNums ?? null) : kids;
  },
  read: (reader, at) => {
    const raw = tdbin.reader.byteList(reader, at, ListsCodec.dataWords, 0);
    const flags = raw.ok ? tdbin.reader.boolList(reader, at, ListsCodec.dataWords, 1) : raw;
    const nums = flags.ok ? readNumberList(reader, at, 2, false) : flags;
    const ids = nums.ok ? tdbin.reader.bytes16List(reader, at, ListsCodec.dataWords, 3) : nums;
    const names = ids.ok ? tdbin.reader.stringList(reader, at, ListsCodec.dataWords, 4) : ids;
    const blobs = names.ok ? tdbin.reader.bytesList(reader, at, ListsCodec.dataWords, 5) : names;
    const kids = blobs.ok ? tdbin.reader.childList(reader, at, ListsCodec.dataWords, 6, ChildCodec) : blobs;
    const maybeNums = kids.ok ? readNumberList(reader, at, 7, true) : kids;
    return raw.ok && flags.ok && nums.ok && ids.ok && names.ok && blobs.ok && kids.ok && maybeNums.ok
      ? ok({
          raw: raw.value ?? new Uint8Array(),
          flags: flags.value ?? [],
          nums: nums.value ?? [],
          ids: (ids.value ?? []).map((pair) => tdbin.scalar.bytes16FromWords(pair[0], pair[1])),
          names: names.value ?? [],
          blobs: blobs.value ?? [],
          kids: kids.value ?? [],
          maybeNums: maybeNums.value ?? undefined,
        })
      : readFallback();
  },
};

const MaybeCodec: StructCodec<Maybe> = {
  dataWords: 0,
  ptrWords: 4,
  write: (writer, at, value) => {
    const text = tdbin.writer.string(writer, at, MaybeCodec.dataWords, 0, value.text ?? null);
    const blob = text.ok ? tdbin.writer.bytes(writer, at, MaybeCodec.dataWords, 1, value.blob ?? null) : text;
    const child = blob.ok
      ? tdbin.writer.child(writer, at, MaybeCodec.dataWords, 2, ChildCodec, value.child ?? null)
      : blob;
    return child.ok ? writeNumberListFor(MaybeCodec, writer, at, 3, value.nums ?? null) : child;
  },
  read: (reader, at) => {
    const text = tdbin.reader.string(reader, at, MaybeCodec.dataWords, 0);
    const blob = text.ok ? tdbin.reader.bytes(reader, at, MaybeCodec.dataWords, 1) : text;
    const child = blob.ok ? tdbin.reader.child(reader, at, MaybeCodec.dataWords, 2, ChildCodec) : blob;
    const nums = child.ok ? readNumberListFor(MaybeCodec, reader, at, 3, true) : child;
    return text.ok && blob.ok && child.ok && nums.ok
      ? ok({
          text: text.value ?? undefined,
          blob: blob.value ?? undefined,
          child: child.value ?? undefined,
          nums: nums.value ?? undefined,
        })
      : readFallback();
  },
};

const writeNumberList = (
  writer: Writer,
  at: number,
  slot: number,
  values: readonly number[] | null
): Result<void, TdbinError> =>
  values === null
    ? tdbin.writer.wordList(writer, at, ListsCodec.dataWords, slot, null)
    : tdbin.writer.wordList(writer, at, ListsCodec.dataWords, slot, values.map(intBits));

const writeNumberListFor = (
  codec: StructCodec<unknown>,
  writer: Writer,
  at: number,
  slot: number,
  values: readonly number[] | null
): Result<void, TdbinError> =>
  values === null
    ? tdbin.writer.wordList(writer, at, codec.dataWords, slot, null)
    : tdbin.writer.wordList(writer, at, codec.dataWords, slot, values.map(intBits));

const readNumberList = (
  reader: Reader,
  at: number,
  slot: number,
  optional: boolean
): Result<readonly number[] | null, TdbinError> => {
  const words = tdbin.reader.wordList(reader, at, ListsCodec.dataWords, slot);
  return words.ok ? ok(words.value === null && optional ? null : (words.value ?? []).map(tdbin.scalar.i64From)) : words;
};

const readNumberListFor = (
  codec: StructCodec<unknown>,
  reader: Reader,
  at: number,
  slot: number,
  optional: boolean
): Result<readonly number[] | null, TdbinError> => {
  const words = tdbin.reader.wordList(reader, at, codec.dataWords, slot);
  return words.ok ? ok(words.value === null && optional ? null : (words.value ?? []).map(tdbin.scalar.i64From)) : words;
};

const words16 = (bytes: Uint8Array): readonly [bigint, bigint] => expectOk(tdbin.scalar.bytes16Words(bytes));

const readFallback = (): Result<never, TdbinError> => tdbin.readerError("LimitExceeded");

const wordBytes = (word: bigint): Uint8Array => {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, word, true);
  return out;
};

const onePointerMessage = (slotPointer: bigint): Uint8Array => {
  const root = expectOk(tdbin.pointer.encodeStruct(0, 0, 1));
  const out = new Uint8Array(16);
  const view = new DataView(out.buffer);
  view.setBigUint64(0, root, true);
  view.setBigUint64(8, slotPointer, true);
  return out;
};

const onePointerReader = (slotPointer: bigint, extraWords = 0): Reader => {
  const out = new Uint8Array(16 + extraWords * 8);
  const view = new DataView(out.buffer);
  view.setBigUint64(0, expectOk(tdbin.pointer.encodeStruct(0, 0, 1)), true);
  view.setBigUint64(8, slotPointer, true);
  return fakeReader(out, 0, 1);
};

const setWord = (bytes: Uint8Array, index: number, word: bigint): Uint8Array => {
  new DataView(bytes.buffer).setBigUint64(index * 8, word, true);
  return bytes;
};

const rootWithOneDataWord = (): Uint8Array => {
  const root = expectOk(tdbin.pointer.encodeStruct(0, 1, 0));
  const out = new Uint8Array(16);
  new DataView(out.buffer).setBigUint64(0, root, true);
  return out;
};

const SlotBytesCodec: StructCodec<Uint8Array | null> = {
  dataWords: 0,
  ptrWords: 1,
  write: () => ok(undefined),
  read: (reader, at) => tdbin.reader.bytes(reader, at, 0, 0),
};

const SlotChildCodec: StructCodec<Child | null> = {
  dataWords: 0,
  ptrWords: 1,
  write: () => ok(undefined),
  read: (reader, at) => tdbin.reader.child(reader, at, 0, 0, ChildCodec),
};

const SlotBoolListCodec: StructCodec<readonly boolean[] | null> = {
  dataWords: 0,
  ptrWords: 1,
  write: () => ok(undefined),
  read: (reader, at) => tdbin.reader.boolList(reader, at, 0, 0),
};

const SlotChildListCodec: StructCodec<readonly Child[] | null> = {
  dataWords: 0,
  ptrWords: 1,
  write: () => ok(undefined),
  read: (reader, at) => tdbin.reader.childList(reader, at, 0, 0, ChildCodec),
};

const EmptyCodec: StructCodec<undefined> = {
  dataWords: 0,
  ptrWords: 0,
  write: () => ok(undefined),
  read: () => ok(undefined),
};

const failingCodec = (phase: "write" | "read"): StructCodec<undefined> => ({
  dataWords: 1,
  ptrWords: 0,
  write: () => (phase === "write" ? tdbin.readerError("LimitExceeded") : ok(undefined)),
  read: () => (phase === "read" ? tdbin.readerError("LimitExceeded") : ok(undefined)),
});

const fakeReader = (bytes: Uint8Array, dataWords: number, ptrWords: number, depth = 64, budget = 8): Reader => ({
  bytes,
  view: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
  dataWords,
  ptrWords,
  depth,
  budget: { value: budget },
});

const listFixture: Lists = {
  raw: Uint8Array.of(1, 2, 3, 4),
  flags: [true, false, true, true],
  nums: [1, -2, 3],
  ids: [
    Uint8Array.from({ length: 16 }, (_value, index) => index),
    Uint8Array.from({ length: 16 }, (_value, index) => 255 - index),
  ],
  names: ["Ada", "", "Grace"],
  blobs: [Uint8Array.of(9, 8), new Uint8Array()],
  kids: [{ count: 7 }, { count: 11 }],
  maybeNums: [13, 17],
};

describe("[TDBIN-FUTURE-TS] runtime coverage", () => {
  it("round-trips every list and byte helper through a typed codec", () => {
    const encoded = expectOk(tdbin.encode(ListsCodec, listFixture));
    expect(expectOk(tdbin.decode(ListsCodec, encoded))).toEqual(listFixture);
  });

  it("round-trips null pointer defaults and accepts short structs", () => {
    const empty: Maybe = { text: undefined, blob: undefined, child: undefined, nums: undefined };
    const encoded = expectOk(tdbin.encode(MaybeCodec, empty));
    expect(expectOk(tdbin.decode(MaybeCodec, encoded))).toEqual(empty);
    const short = rootWithOneDataWord();
    expect(expectOk(tdbin.decode(MaybeCodec, short))).toEqual(empty);
  });

  it("packs and unpacks zero, sparse, and dense words", () => {
    const dense = Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8);
    const sparse = Uint8Array.of(0, 9, 0, 0, 0, 0, 0, 0);
    const body = new Uint8Array([...new Uint8Array(8), ...sparse, ...dense, ...dense]);
    const packed = expectOk(tdbin.pack.encodePacked(body));
    expect(expectOk(tdbin.pack.decodePacked(packed))).toEqual(body);
  });

  it("returns typed errors for malformed frames, packed bodies, words, and pointers", () => {
    expectErr(tdbin.decode(ChildCodec, new Uint8Array()), "BadLength");
    expectErr(tdbin.decode(ChildCodec, wordBytes(0n)), "NullRoot");
    expectErr(tdbin.decode(ChildCodec, wordBytes(2n)), "ReservedPointerKind");
    expectErr(tdbin.pack.encodePacked(Uint8Array.of(1)), "BadLength");
    expectErr(tdbin.pack.decodePacked(Uint8Array.of(0xff, 1)), "PackedTruncated");
    expectErr(tdbin.scalar.i64Bits(Number.MAX_SAFE_INTEGER + 1), "LimitExceeded");
    expectErr(tdbin.scalar.bytes16Words(new Uint8Array(15)), "BadLength");
    expectErr(tdbin.scalar.utf8Decode(Uint8Array.of(0xff)), "InvalidUtf8");
    expectErr(tdbin.fromHex("f"), "BadLength");
    expectErr(tdbin.fromHex("xz"), "BadLength");
    expectErr(tdbin.pointer.encodeStruct(1 << 30, 0, 0), "OffsetOutOfRange");
    expectErr(tdbin.pointer.encodeList(1 << 30, tdbin.pointer.ELEM_BYTE, 0), "OffsetOutOfRange");
    expectErr(tdbin.pointer.encodeStruct(0, 0x1_0000, 0), "LimitExceeded");
    expectErr(tdbin.pointer.encodeList(0, tdbin.pointer.ELEM_BYTE, 0x2000_0000), "LimitExceeded");
    expectErr(tdbin.pointer.targetWord(0, -2), "PointerOutOfBounds");
    expectErr(tdbin.pointer.relOffset(Number.POSITIVE_INFINITY, 0), "LimitExceeded");
    expectErr(
      tdbin.decode(ChildCodec, wordBytes(expectOk(tdbin.pointer.encodeStruct(-2, 1, 0)))),
      "PointerOutOfBounds"
    );
    expectErr(
      tdbin.decode(ChildCodec, wordBytes(expectOk(tdbin.pointer.encodeStruct(0, 100, 0)))),
      "PointerOutOfBounds"
    );
  });

  it("rejects pointer kinds that do not match the requested field type", () => {
    const structPointer = expectOk(tdbin.pointer.encodeStruct(-1, 1, 0));
    const byteListPointer = expectOk(tdbin.pointer.encodeList(0, tdbin.pointer.ELEM_BYTE, 0));
    expectErr(tdbin.decode(SlotBytesCodec, onePointerMessage(structPointer)), "PointerKindMismatch");
    expectErr(tdbin.decode(SlotChildCodec, onePointerMessage(byteListPointer)), "PointerKindMismatch");
    expectErr(tdbin.decode(SlotBoolListCodec, onePointerMessage(byteListPointer)), "PointerKindMismatch");
    expectErr(tdbin.decode(SlotChildListCodec, onePointerMessage(byteListPointer)), "PointerKindMismatch");
  });

  it("keeps defensive reader and writer branches typed", () => {
    const emptyReader = fakeReader(new Uint8Array(), 0, 0);
    expect(expectOk(tdbin.reader.scalar(emptyReader, 0, 0))).toBe(0n);
    expectErr(tdbin.reader.boolBit(emptyReader, 0, 0, 64), "LimitExceeded");
    expect(expectOk(tdbin.reader.string(emptyReader, 0, 0, 0))).toBeNull();
    expect(expectOk(tdbin.reader.child(emptyReader, 0, 0, 0, ChildCodec))).toBeNull();
    expect(expectOk(tdbin.reader.boolList(emptyReader, 0, 0, 0))).toBeNull();
    expect(expectOk(tdbin.reader.bytes16List(emptyReader, 0, 0, 0))).toBeNull();
    expect(expectOk(tdbin.reader.stringList(emptyReader, 0, 0, 0))).toBeNull();
    expect(expectOk(tdbin.reader.bytesList(emptyReader, 0, 0, 0))).toBeNull();

    const badPointerReader = fakeReader(new Uint8Array(8), 0, 1);
    expectErr(tdbin.reader.string(badPointerReader, 1, 0, 0), "PointerOutOfBounds");
    expectErr(tdbin.reader.child(badPointerReader, 1, 0, 0, ChildCodec), "PointerOutOfBounds");
    expectErr(tdbin.reader.boolList(badPointerReader, 1, 0, 0), "PointerOutOfBounds");

    const structPointer = expectOk(tdbin.pointer.encodeStruct(-1, 1, 0));
    const childReader = fakeReader(onePointerMessage(structPointer), 0, 1, 0, 1);
    expectErr(tdbin.reader.child(childReader, 1, 0, 0, ChildCodec), "DepthExceeded");
    const budgetReader = fakeReader(onePointerMessage(structPointer), 0, 1, 1, 0);
    expectErr(tdbin.reader.child(budgetReader, 1, 0, 0, ChildCodec), "AmplificationExceeded");
    const farStruct = onePointerReader(expectOk(tdbin.pointer.encodeStruct(-3, 1, 0)));
    expectErr(tdbin.reader.child(farStruct, 1, 0, 0, ChildCodec), "PointerOutOfBounds");
    const wideStruct = onePointerReader(expectOk(tdbin.pointer.encodeStruct(0, 100, 0)));
    expectErr(tdbin.reader.child(wideStruct, 1, 0, 0, ChildCodec), "PointerOutOfBounds");

    expectErr(tdbin.writer.scalar({ body: [] }, 0, 0, 1n), "LimitExceeded");
    expectErr(tdbin.writer.boolBit({ body: [] }, 0, 0, 1, true), "LimitExceeded");
    expectErr(tdbin.writer.boolBit({ body: [0n] }, 0, 0, 64, true), "LimitExceeded");
    expectOk(tdbin.writer.byteList({ body: [0n] }, 0, 0, 0, null));
    expectOk(tdbin.writer.boolList({ body: [0n] }, 0, 0, 0, null));
    expectOk(tdbin.writer.bytes16List({ body: [0n] }, 0, 0, 0, null));
    expectOk(tdbin.writer.stringList({ body: [0n] }, 0, 0, 0, null));
    expectOk(tdbin.writer.bytesList({ body: [0n] }, 0, 0, 0, null));
    expectOk(tdbin.writer.childList({ body: [0n] }, 0, 0, 0, ChildCodec, null));
    expectErr(
      tdbin.writer.child({ body: [0n] }, 0, 0, 0, { ...EmptyCodec, dataWords: 1 << 27 }, undefined),
      "LimitExceeded"
    );
    expectErr(tdbin.writer.child({ body: [0n] }, 0, 0, 0, failingCodec("write"), undefined), "LimitExceeded");
    expectErr(tdbin.writer.childList({ body: [0n] }, 0, 0, 0, EmptyCodec, [undefined]), "LimitExceeded");
    expectErr(tdbin.writer.childList({ body: [0n] }, 0, 0, 0, failingCodec("write"), [undefined]), "LimitExceeded");
    expectErr(tdbin.encode({ ...EmptyCodec, dataWords: 1 << 27 }, undefined), "LimitExceeded");
    expectErr(tdbin.encode({ ...EmptyCodec, dataWords: 0x1_0000 }, undefined), "LimitExceeded");
    expectErr(tdbin.encode(failingCodec("write"), undefined), "LimitExceeded");
    const encoded = expectOk(tdbin.encode(ChildCodec, { count: 1 }));
    expectErr(tdbin.decode(failingCodec("read"), encoded), "LimitExceeded");

    const nullPointerReader = onePointerReader(0n);
    expect(expectOk(tdbin.reader.bytes(nullPointerReader, 1, 0, 0))).toBeNull();
    expect(expectOk(tdbin.reader.boolList(nullPointerReader, 1, 0, 0))).toBeNull();
    expect(expectOk(tdbin.reader.wordList(nullPointerReader, 1, 0, 0))).toBeNull();

    const farByteList = onePointerReader(expectOk(tdbin.pointer.encodeList(10, tdbin.pointer.ELEM_BYTE, 1)));
    expectErr(tdbin.reader.bytes(farByteList, 1, 0, 0), "PointerOutOfBounds");
    const negativeByteList = onePointerReader(expectOk(tdbin.pointer.encodeList(-3, tdbin.pointer.ELEM_BYTE, 1)));
    expectErr(tdbin.reader.bytes(negativeByteList, 1, 0, 0), "PointerOutOfBounds");
    const farBoolList = onePointerReader(expectOk(tdbin.pointer.encodeList(10, tdbin.pointer.ELEM_BIT, 1)));
    expectErr(tdbin.reader.boolList(farBoolList, 1, 0, 0), "PointerOutOfBounds");
    const negativeBoolList = onePointerReader(expectOk(tdbin.pointer.encodeList(-3, tdbin.pointer.ELEM_BIT, 1)));
    expectErr(tdbin.reader.boolList(negativeBoolList, 1, 0, 0), "PointerOutOfBounds");
    const farWordList = onePointerReader(expectOk(tdbin.pointer.encodeList(10, tdbin.pointer.ELEM_EIGHT_BYTES, 1)));
    expectErr(tdbin.reader.wordList(farWordList, 1, 0, 0), "PointerOutOfBounds");
    const negativeWordList = onePointerReader(
      expectOk(tdbin.pointer.encodeList(-3, tdbin.pointer.ELEM_EIGHT_BYTES, 1))
    );
    expectErr(tdbin.reader.wordList(negativeWordList, 1, 0, 0), "PointerOutOfBounds");
    const farPointerList = onePointerReader(expectOk(tdbin.pointer.encodeList(10, tdbin.pointer.ELEM_POINTER, 1)));
    expectErr(tdbin.reader.stringList(farPointerList, 1, 0, 0), "PointerOutOfBounds");
    const negativePointerList = onePointerReader(expectOk(tdbin.pointer.encodeList(-3, tdbin.pointer.ELEM_POINTER, 1)));
    expectErr(tdbin.reader.stringList(negativePointerList, 1, 0, 0), "PointerOutOfBounds");
    const badStringElement = onePointerReader(expectOk(tdbin.pointer.encodeList(0, tdbin.pointer.ELEM_POINTER, 2)), 2);
    setWord(badStringElement.bytes, 2, expectOk(tdbin.pointer.encodeList(10, tdbin.pointer.ELEM_BYTE, 1)));
    expectErr(tdbin.reader.stringList(badStringElement, 1, 0, 0), "PointerOutOfBounds");
    const badBytesElement = onePointerReader(expectOk(tdbin.pointer.encodeList(0, tdbin.pointer.ELEM_POINTER, 2)), 2);
    setWord(badBytesElement.bytes, 2, expectOk(tdbin.pointer.encodeStruct(0, 1, 0)));
    expectErr(tdbin.reader.bytesList(badBytesElement, 1, 0, 0), "PointerKindMismatch");
    const negativeComposite = onePointerReader(expectOk(tdbin.pointer.encodeList(-3, tdbin.pointer.ELEM_COMPOSITE, 1)));
    expectErr(tdbin.reader.childList(negativeComposite, 1, 0, 0, ChildCodec), "PointerKindMismatch");

    const badComposite = onePointerReader(expectOk(tdbin.pointer.encodeList(0, tdbin.pointer.ELEM_COMPOSITE, 1)), 2);
    setWord(badComposite.bytes, 2, expectOk(tdbin.pointer.encodeStruct(1, 1, 0)));
    expectErr(tdbin.reader.bytes16List(badComposite, 1, 0, 0), "PointerKindMismatch");
    const missingCompositeTag = onePointerReader(
      expectOk(tdbin.pointer.encodeList(0, tdbin.pointer.ELEM_COMPOSITE, 1))
    );
    expectErr(tdbin.reader.childList(missingCompositeTag, 1, 0, 0, ChildCodec), "PointerKindMismatch");
    const mismatchedComposite = onePointerReader(
      expectOk(tdbin.pointer.encodeList(0, tdbin.pointer.ELEM_COMPOSITE, 2)),
      2
    );
    setWord(mismatchedComposite.bytes, 2, expectOk(tdbin.pointer.encodeStruct(1, 1, 0)));
    expectErr(tdbin.reader.childList(mismatchedComposite, 1, 0, 0, ChildCodec), "PointerKindMismatch");
    const failingComposite = onePointerReader(
      expectOk(tdbin.pointer.encodeList(0, tdbin.pointer.ELEM_COMPOSITE, 2)),
      3
    );
    setWord(failingComposite.bytes, 2, expectOk(tdbin.pointer.encodeStruct(2, 1, 0)));
    expectErr(tdbin.reader.childList(failingComposite, 1, 0, 0, failingCodec("read")), "LimitExceeded");
  });

  it("validates frame headers before exposing the body", () => {
    const body = expectOk(tdbin.encode(ChildCodec, { count: 5 }));
    const framed = expectOk(tdbin.frame.encodeFrame(body, { schemaHash: 0x1234n }));
    const noHash = expectOk(tdbin.frame.encodeFrame(body));
    expect(expectOk(tdbin.frame.decodeFrame(framed)).schemaHash).toBe(0x1234n);
    expect(expectOk(tdbin.frame.decodeFrame(noHash)).schemaHash).toBeNull();

    const badMagic = framed.slice();
    badMagic[0] = 0;
    expectErr(tdbin.frame.decodeFrame(badMagic), "BadMagic");

    const badVersion = framed.slice();
    badVersion[4] = 99;
    expectErr(tdbin.frame.decodeFrame(badVersion), "BadVersion");
    expectErr(tdbin.decodeAuto(ChildCodec, badVersion), "BadVersion");

    const badFlags = framed.slice();
    badFlags[5] = 0x80;
    expectErr(tdbin.frame.decodeFrame(badFlags), "ReservedBits");

    const badReserved = framed.slice();
    badReserved[6] = 1;
    expectErr(tdbin.frame.decodeFrame(badReserved), "ReservedBits");

    expectErr(tdbin.frame.decodeFrame(framed.slice(0, framed.length - 1)), "LengthMismatch");
    expect(tdbin.frame.looksFramed(body)).toBe(false);
    expect(expectOk(tdbin.decodeAuto(ChildCodec, body))).toEqual({ count: 5 });
    expectErr(tdbin.encodeFramed(failingCodec("write"), undefined), "LimitExceeded");
    expectErr(tdbin.encodePackedFramed(failingCodec("write"), undefined), "LimitExceeded");
    expect(expectOk(tdbin.frame.unpackFrameBody({ body, packed: false, schemaHash: null }))).toEqual(body);
    expectOk(tdbin.frame.encodeFrame(body, { packed: true, schemaHash: null }));
    expectErr(tdbin.frame.encodePackedFrame(Uint8Array.of(1)), "BadLength");
    expectErr(tdbin.frame.decodeFrame(new Uint8Array(4)), "LengthMismatch");
    expectErr(tdbin.pack.decodePacked(Uint8Array.of(0)), "PackedTruncated");
    expectErr(tdbin.pack.decodePacked(Uint8Array.of(1)), "PackedTruncated");
  });
});
