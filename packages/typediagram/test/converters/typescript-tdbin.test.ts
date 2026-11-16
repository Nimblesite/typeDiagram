// [CONV-TS-TDBIN] Pins the TypeScript TDBIN code generator: it emits typed
// StructCodec objects over the runtime in `src/tdbin`, with layout baked into
// the generated code ([TDBIN-FUTURE-TS], [TDBIN-REC-ALLOC]).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import * as ts from "typescript-compiler";
import { describe, expect, it } from "vitest";
import { emitRustCodec } from "../../src/converters/rust-tdbin.js";
import { emitTypeScriptCodec, generateTypeScriptModule } from "../../src/converters/typescript-tdbin.js";
import { buildModel } from "../../src/model/index.js";
import { parse } from "../../src/parser/index.js";
import type { Model } from "../../src/model/types.js";
import { ok } from "../../src/result.js";
import * as tdbin from "../../src/tdbin/index.js";
import { expectErrorMessages, unwrap } from "./helpers.js";

const PERSON_TD = `type Address {
  street: String
  zip: Int
}
type EmailContact {
  addr: String
}
type PhoneContact {
  number: Int
  country: Int
}
union Contact {
  Email(EmailContact)
  Phone(PhoneContact)
}
type Person {
  name: String
  age: Int
  active: Bool
  score: Float
  address: Option<Address>
  nickname: Option<String>
  contact: Contact
}`;

const modelFor = (td: string): Model => unwrap(buildModel(unwrap(parse(td))));

// Executes generated codec source for behavior tests: the emitted TypeScript is
// transpiled with the real compiler (never regex on code) and evaluated against
// the real runtime, exactly as a consumer module would run it. The host-realm
// Uint8Array is injected so generated defaults share the test realm.
const instantiateCodecs = (source: string): Record<string, unknown> => {
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const moduleExports: Record<string, unknown> = {};
  runInNewContext(js, { exports: moduleExports, tdbin, ok, Uint8Array });
  return moduleExports;
};

const codecFor = <T>(source: string, name: string): tdbin.StructCodec<T> => {
  const generated = instantiateCodecs(source)[name];
  expect(generated).toBeDefined();
  // Safe: the generator declares every exported `${Type}Codec` as
  // tdbin.StructCodec<Type>, pinned by the text assertions in this file.
  return generated as tdbin.StructCodec<T>;
};

interface Sensor {
  readonly id: number;
}

interface Measurement {
  readonly label: string;
  readonly count: number;
  readonly ratio: number;
  readonly enabled: boolean;
  readonly unit: string | undefined;
  readonly sensor: Sensor;
}

const MEASUREMENT_TD = `type Sensor {
  id: Int
}
type Measurement {
  label: String
  count: Int
  ratio: Float
  enabled: Bool
  unit: Option<String>
  sensor: Sensor
}`;

type WriterSignal = { readonly kind: "Idle" } | { readonly kind: "Note"; readonly _0: string };

interface WriterPacket {
  readonly name: string | undefined;
  readonly data: Uint8Array | undefined;
  readonly contact: WriterSignal | undefined;
}

interface IdleInfo {
  readonly reason: string;
}

type ReaderSignal = { readonly kind: "Idle"; readonly _0: IdleInfo } | { readonly kind: "Note"; readonly _0: string };

interface ReaderPacket {
  readonly name: string;
  readonly data: Uint8Array;
  readonly contact: ReaderSignal;
}

// Same wire layout as NULL_READER_TD (ptr slots 0..2, union disc + 1 ptr slot),
// but every pointer field is optional so nulls can actually be written.
const NULL_WRITER_TD = `type Packet {
  name: Option<String>
  data: Option<Bytes>
  contact: Option<Signal>
}
union Signal {
  Idle
  Note(String)
}`;

const NULL_READER_TD = `type Packet {
  name: String
  data: Bytes
  contact: Signal
}
union Signal {
  Idle(IdleInfo)
  Note(String)
}
type IdleInfo {
  reason: String
}`;

describe("[CONV-TS-TDBIN] TypeScript codec generator", () => {
  it("preserves exact integers in generated records, optional fields and child defaults", () => {
    const model = modelFor("type Counter { count: Int maybe: Option<Int> ratio: Float }\ntype Root { child: Counter }");
    const code = unwrap(emitTypeScriptCodec(model, { integerType: "bigint" }));
    const codec = codecFor<{ count: bigint; maybe: bigint | undefined; ratio: number }>(code, "CounterCodec");
    for (const count of [-(1n << 63n), 9007199254740992n, 9007199254740993n, (1n << 63n) - 1n]) {
      for (const maybe of [undefined, 0n, count]) {
        const value = { count, maybe, ratio: 1.25 };
        expect(tdbin.decode(codec, unwrap(tdbin.encode(codec, value)))).toEqual(ok(value));
        expect(tdbin.decodeAuto(codec, unwrap(tdbin.encodePackedFramed(codec, value, 7n)), 7n)).toEqual(ok(value));
      }
    }
    expect(tdbin.encode(codec, { count: 1n << 63n, maybe: undefined, ratio: 0 })).toMatchObject({
      ok: false,
      error: { code: "LimitExceeded" },
    });
    const root = codecFor<{ child: { count: bigint; maybe: bigint | undefined; ratio: number } }>(code, "RootCodec");
    const nullChild = tdbin.scalar.wordsToBytes([1n << 48n, 0n]);
    expect(tdbin.decode(root, nullChild)).toEqual(ok({ child: { count: 0n, maybe: undefined, ratio: 0 } }));
    const moduleText = unwrap(generateTypeScriptModule(model, { integerType: "bigint" }));
    expect(moduleText).toContain("count: bigint;");
    expect(moduleText).toContain("BigInt.asIntN(64, countWord.value)");
    expect(moduleText).toContain("count: 0n");
    const ordinary = codecFor<{ count: number; maybe: number | undefined; ratio: number }>(
      unwrap(emitTypeScriptCodec(model)),
      "CounterCodec"
    );
    const value = { count: 42, maybe: 0, ratio: 1.25 };
    expect(unwrap(tdbin.encode(ordinary, value))).toEqual(
      unwrap(tdbin.encode(codec, { ...value, count: 42n, maybe: 0n }))
    );
  });

  it("emits slot-addressed record codecs over the TypeScript runtime", () => {
    const code = unwrap(emitTypeScriptCodec(modelFor(PERSON_TD)));
    expect(code).toContain("export const PersonCodec: tdbin.StructCodec<Person>");
    expect(code).toContain("dataWords: 3");
    expect(code).toContain("ptrWords: 4");
    expect(code).toContain("tdbin.writer.string(writer, at, PersonCodec.dataWords, 0, value.name)");
    expect(code).toContain("const ageBits = tdbin.scalar.i64Bits(value.age);");
    expect(code).toContain("if (!age.ok) return age;");
    expect(code).toContain("tdbin.writer.boolBit(writer, at, 1, 0, value.active)");
    expect(code).toContain(
      "tdbin.writer.child(writer, at, PersonCodec.dataWords, 1, AddressCodec, value.address ?? null)"
    );
    expect(code).toContain("const scoreWord = tdbin.reader.scalar(reader, at, 2);");
    expect(code).toContain("age: tdbin.scalar.i64From(ageWord.value)");
    expect(code).toContain("address: address.value ?? undefined");
    expect(code).toContain('name: name.value ?? ""');
    expect(code).toContain("contact: contact.value ?? defaultContact()");
    expect(code).not.toContain('tdbin.readerError("UnexpectedNull")');
  });

  it("emits union discriminant arms and null-payload defaults", () => {
    const code = unwrap(emitTypeScriptCodec(modelFor(PERSON_TD)));
    expect(code).toContain("export const ContactCodec: tdbin.StructCodec<Contact>");
    expect(code).toContain('case "Email": {');
    expect(code).toContain("const disc = tdbin.writer.scalar(writer, at, 0, 0n);");
    expect(code).toContain("tdbin.writer.child(writer, at, ContactCodec.dataWords, 0, EmailContactCodec, value._0)");
    expect(code).toContain("case 1n: {");
    expect(code).toContain('return ok({ kind: "Phone", _0: payload.value ?? defaultPhoneContact() });');
    expect(code).toContain('return tdbin.readerError("UnknownVariant", { ordinal: ordinal.value });');
  });

  it("generates a self-contained module with type declarations and runtime imports", () => {
    const moduleText = unwrap(generateTypeScriptModule(modelFor(PERSON_TD)));
    expect(moduleText).toContain('import * as tdbin from "typediagram-core/tdbin";');
    expect(moduleText).toContain('import { ok } from "typediagram-core/tdbin";');
    expect(moduleText).not.toContain('from "typediagram-core";');
    expect(moduleText).toContain("export interface Person");
    expect(moduleText).toContain('export type Contact =\n  | { kind: "Email"; _0: EmailContact }');
    expect(moduleText).toContain("const defaultContact = ");
    expect(moduleText).toContain("export const PersonCodec");
  });

  it("rejects unsupported shapes loudly", () => {
    const result = emitTypeScriptCodec(modelFor("type R {\n  items: Map<String, Int>\n}"));
    expectErrorMessages(result, ["unsupported field type 'Map<String, Int>'"]);
    const moduleResult = generateTypeScriptModule(modelFor("type R {\n  items: List<List<Int>>\n}"));
    expectErrorMessages(moduleResult, ["unsupported field type 'List<List<Int>>'"]);
    const semantic = emitTypeScriptCodec(modelFor("type R {\n  at: List<DateTime>\n}"));
    expectErrorMessages(semantic, ["unsupported field type 'List<DateTime>'"]);
  });

  it("emits bytes, optional bytes, bare variants, and string-payload variants", () => {
    const code = unwrap(
      emitTypeScriptCodec(
        modelFor(`type Blob {
  raw: Bytes
  maybe: Option<Bytes>
}
union Notice {
  Empty
  Text(String)
}`)
      )
    );
    expect(code).toContain("tdbin.writer.bytes(writer, at, BlobCodec.dataWords, 0, value.raw)");
    expect(code).toContain("tdbin.writer.bytes(writer, at, BlobCodec.dataWords, 1, value.maybe ?? null)");
    expect(code).toContain("raw: raw.value ?? new Uint8Array(0)");
    expect(code).toContain("maybe: maybe.value ?? undefined");
    expect(code).toContain("const inactive = tdbin.reader.requireNullPointer(reader, at, 0);");
    expect(code).toContain('return inactive.ok ? ok({ kind: "Empty" }) : inactive;');
    expect(code).toContain("tdbin.writer.string(writer, at, NoticeCodec.dataWords, 0, value._0)");
    expect(code).toContain("tdbin.reader.string(reader, at, NoticeCodec.dataWords, 0)");
    expect(code).toContain('return ok({ kind: "Text", _0: payload.value ?? "" });');
  });

  it("rejects unsupported generic and variant shapes", () => {
    const generic = emitTypeScriptCodec(modelFor("type Box<T> {\n  value: T\n}"));
    const multi = emitTypeScriptCodec(
      modelFor("union Bad {\n  Both(Int, String)\n  Map {\n    m: Map<String, Int>\n  }\n}")
    );
    const payload = emitTypeScriptCodec(modelFor("union Bad {\n  Count(Int)\n}"));
    expect(generic.ok ? "" : generic.error[0]?.message).toContain("must be monomorphized");
    expect(multi.ok ? "" : multi.error[0]?.message).toContain(
      "unsupported field type 'Map<String, Int>' in BadMapTdbinPayload.m"
    );
    expect(payload.ok ? "" : payload.error[0]?.message).toContain("payload 'Int' unsupported");
  });

  it("emits empty records using the runtime's non-null zero-size marker", () => {
    const code = unwrap(emitTypeScriptCodec(modelFor("alias Id = String\ntype Empty {}")));
    expect(code).toContain("export const EmptyCodec");
    expect(code).toContain("dataWords: 0");
    expect(code).toContain("ptrWords: 0");
    expect(code).not.toContain("IdCodec");
  });

  it("decodes required null pointers to per-type schema defaults [TDBIN-PTR-NULL]", () => {
    const person = unwrap(emitTypeScriptCodec(modelFor(PERSON_TD)));
    expect(person).toContain('const defaultEmailContact = (): EmailContact => ({ addr: "" });');
    expect(person).toContain("const defaultPhoneContact = (): PhoneContact => ({ number: 0, country: 0 });");
    expect(person).toContain('const defaultContact = (): Contact => ({ kind: "Email", _0: defaultEmailContact() });');
    expect(person).not.toContain("const defaultAddress");
    expect(person).not.toContain("const defaultPerson");
    expect(person.indexOf("const defaultEmailContact")).toBeLessThan(person.indexOf("export const AddressCodec"));
    const chain = unwrap(
      emitTypeScriptCodec(
        modelFor("type Leaf {\n  tag: String\n}\ntype Mid {\n  leaf: Leaf\n}\ntype Root {\n  mid: Mid\n}")
      )
    );
    expect(chain).toContain('const defaultLeaf = (): Leaf => ({ tag: "" });');
    expect(chain).toContain("const defaultMid = (): Mid => ({ leaf: defaultLeaf() });");
    expect(chain).toContain("mid: mid.value ?? defaultMid()");
    const blob = unwrap(
      emitTypeScriptCodec(
        modelFor(
          "type Blob {\n  raw: Bytes\n  flag: Bool\n  ratio: Float\n  maybe: Option<Bytes>\n}\ntype Wrap {\n  blob: Blob\n}"
        )
      )
    );
    expect(blob).toContain(
      "const defaultBlob = (): Blob => ({ raw: new Uint8Array(0), flag: false, ratio: 0, maybe: undefined });"
    );
    expect(blob).toContain("blob: blob.value ?? defaultBlob()");
    const emptyRec = unwrap(emitTypeScriptCodec(modelFor("type Empty {}\ntype Holder {\n  e: Empty\n}")));
    expect(emptyRec).toContain("const defaultEmpty = (): Empty => ({});");
    expect(emptyRec).toContain("e: e.value ?? defaultEmpty()");
    const bareFirst = unwrap(
      emitTypeScriptCodec(modelFor("union Notice {\n  Empty\n  Text(String)\n}\ntype Holder {\n  notice: Notice\n}"))
    );
    expect(bareFirst).toContain('const defaultNotice = (): Notice => ({ kind: "Empty" });');
    expect(bareFirst).toContain("notice: notice.value ?? defaultNotice()");
    const stringFirst = unwrap(
      emitTypeScriptCodec(modelFor("union Label {\n  Text(String)\n}\ntype Tag {\n  label: Label\n}"))
    );
    expect(stringFirst).toContain('const defaultLabel = (): Label => ({ kind: "Text", _0: "" });');
  });

  it("rejects defaults that cannot terminate: recursive and empty-union required fields", () => {
    const selfRecursive = emitTypeScriptCodec(modelFor("type Node {\n  next: Node\n}"));
    expect(selfRecursive.ok).toBe(false);
    expect(selfRecursive.ok ? "" : selfRecursive.error[0]?.message).toContain(
      "cannot derive [TDBIN-PTR-NULL] default for recursive type 'Node' (Node -> Node)"
    );
    const mutual = emitTypeScriptCodec(modelFor("union Tree {\n  Node(Branch)\n}\ntype Branch {\n  left: Tree\n}"));
    expect(mutual.ok).toBe(false);
    expect(mutual.ok ? "" : mutual.error[0]?.message).toContain("recursive type 'Tree' (Tree -> Branch -> Tree)");
    const optionBreaksCycle = unwrap(
      emitTypeScriptCodec(
        modelFor("type Node {\n  next: Option<Node>\n  label: Node2\n}\ntype Node2 {\n  tag: String\n}")
      )
    );
    expect(optionBreaksCycle).toContain('const defaultNode2 = (): Node2 => ({ tag: "" });');
    expect(optionBreaksCycle).not.toContain("const defaultNode = ");
    const emptyUnion = emitTypeScriptCodec(modelFor("union Never {}\ntype Holder {\n  n: Never\n}"));
    expect(emptyUnion.ok).toBe(false);
    expect(emptyUnion.ok ? "" : emptyUnion.error[0]?.message).toContain(
      "union 'Never' has no variants; cannot derive its [TDBIN-PTR-NULL] default"
    );
  });

  it("emits 1-bit presence flags plus natural-width value slots for Option<scalar> [TDBIN-PRIM-OPTION]", () => {
    const code = unwrap(
      emitTypeScriptCodec(
        modelFor(
          "type Reading {\n  label: String\n  count: Option<Int>\n  flagged: Option<Bool>\n  ratio: Option<Float>\n}"
        )
      )
    );
    // Bitset word 0: count-presence bit 0, flagged-presence bit 1,
    // flagged-VALUE bit 2, ratio-presence bit 3; count value w1, ratio w2.
    expect(code).toContain("dataWords: 3");
    expect(code).toContain("tdbin.writer.boolBit(writer, at, 0, 0, value.count !== undefined)");
    expect(code).toContain("const countBits = tdbin.scalar.i64Bits(value.count ?? 0);");
    expect(code).toContain("const count = tdbin.writer.scalar(writer, at, 1, countBits.value);");
    expect(code).toContain("tdbin.writer.boolBit(writer, at, 0, 1, value.flagged !== undefined)");
    expect(code).toContain("const flagged = tdbin.writer.boolBit(writer, at, 0, 2, value.flagged ?? false);");
    expect(code).toContain("tdbin.writer.boolBit(writer, at, 0, 3, value.ratio !== undefined)");
    expect(code).toContain("const ratio = tdbin.writer.scalar(writer, at, 2, tdbin.scalar.f64Bits(value.ratio ?? 0));");
    expect(code).toContain("const countPresent = tdbin.reader.boolBit(reader, at, 0, 0);");
    expect(code).toContain("const countWord = tdbin.reader.scalar(reader, at, 1);");
    expect(code).toContain("count: countPresent.value ? tdbin.scalar.i64From(countWord.value) : undefined");
    expect(code).toContain("const flaggedValue = tdbin.reader.boolBit(reader, at, 0, 2);");
    expect(code).toContain("flagged: flaggedPresent.value ? flaggedValue.value : undefined");
    expect(code).toContain("ratio: ratioPresent.value ? tdbin.scalar.f64From(ratioWord.value) : undefined");
    expect(code).toContain("if (!countPresent.ok) return countPresent;");
  });

  it("bakes the SAME slot/bit numbers as the Rust emitter (cross-language layout parity)", () => {
    // Mixed Bool and Option<scalar> fields exercise the shared first-fit bit
    // allocator: a w0.0, b presence w0.1 + value w1, c presence w0.2 + value
    // w0.3, d w0.4, e presence w0.5 + value w2, f w3 -> 4 data words.
    const PARITY_TD =
      "type Mixed {\n  a: Bool\n  b: Option<Int>\n  c: Option<Bool>\n  d: Bool\n  e: Option<Float>\n  f: Int\n}";
    const rust = unwrap(emitRustCodec(modelFor(PARITY_TD)));
    const tsCode = unwrap(emitTypeScriptCodec(modelFor(PARITY_TD)));
    expect(rust).toContain("const DATA_WORDS: u16 = 4;");
    expect(tsCode).toContain("dataWords: 4");
    expect(rust).toContain("w.bool_bit(at, 0, 0, self.a)?;");
    expect(tsCode).toContain("tdbin.writer.boolBit(writer, at, 0, 0, value.a)");
    expect(rust).toContain("w.bool_bit(at, 0, 1, self.b.is_some())?;");
    expect(tsCode).toContain("tdbin.writer.boolBit(writer, at, 0, 1, value.b !== undefined)");
    expect(rust).toContain("w.scalar(at, 1, self.b.map_or(0, tdbin::scalar::i64_bits))?;");
    expect(tsCode).toContain("tdbin.writer.scalar(writer, at, 1, bBits.value)");
    expect(rust).toContain("w.bool_bit(at, 0, 2, self.c.is_some())?;");
    expect(rust).toContain("w.bool_bit(at, 0, 3, self.c.unwrap_or_default())?;");
    expect(tsCode).toContain("tdbin.writer.boolBit(writer, at, 0, 2, value.c !== undefined)");
    expect(tsCode).toContain("tdbin.writer.boolBit(writer, at, 0, 3, value.c ?? false)");
    expect(rust).toContain("w.bool_bit(at, 0, 4, self.d)?;");
    expect(tsCode).toContain("tdbin.writer.boolBit(writer, at, 0, 4, value.d)");
    expect(rust).toContain("w.bool_bit(at, 0, 5, self.e.is_some())?;");
    expect(rust).toContain("w.scalar(at, 2, self.e.map_or(0, tdbin::scalar::f64_bits))?;");
    expect(tsCode).toContain("tdbin.writer.boolBit(writer, at, 0, 5, value.e !== undefined)");
    expect(tsCode).toContain("tdbin.writer.scalar(writer, at, 2, tdbin.scalar.f64Bits(value.e ?? 0))");
    expect(rust).toContain("w.scalar(at, 3, tdbin::scalar::i64_bits(self.f))?;");
    expect(tsCode).toContain("const f = tdbin.writer.scalar(writer, at, 3, fBits.value);");
  });

  it("executes generated Option<scalar> codecs: present and absent round-trips [TDBIN-PRIM-OPTION]", () => {
    interface Reading {
      readonly label: string;
      readonly count: number | undefined;
      readonly flagged: boolean | undefined;
      readonly ratio: number | undefined;
    }
    const readingCodec = codecFor<Reading>(
      unwrap(
        emitTypeScriptCodec(
          modelFor(
            "type Reading {\n  label: String\n  count: Option<Int>\n  flagged: Option<Bool>\n  ratio: Option<Float>\n}"
          )
        )
      ),
      "ReadingCodec"
    );
    const full: Reading = { label: "t", count: -5, flagged: true, ratio: 0.25 };
    expect(unwrap(tdbin.decode(readingCodec, unwrap(tdbin.encode(readingCodec, full))))).toEqual(full);
    // A present-but-default value must stay Some (presence bit, not sentinel).
    const zeroes: Reading = { label: "", count: 0, flagged: false, ratio: 0 };
    expect(unwrap(tdbin.decode(readingCodec, unwrap(tdbin.encode(readingCodec, zeroes))))).toEqual(zeroes);
    const absent: Reading = { label: "n", count: undefined, flagged: undefined, ratio: undefined };
    expect(unwrap(tdbin.decode(readingCodec, unwrap(tdbin.encode(readingCodec, absent))))).toEqual(absent);
    const encodedFull = unwrap(tdbin.encode(readingCodec, full));
    const encodedAbsent = unwrap(tdbin.encode(readingCodec, absent));
    expect(Buffer.from(encodedFull).equals(Buffer.from(encodedAbsent))).toBe(false);
  });

  it("executes generated codecs: scalar writes, round-trips, and null-to-default decodes [TDBIN-PTR-NULL]", () => {
    const measurementCodec = codecFor<Measurement>(
      unwrap(emitTypeScriptCodec(modelFor(MEASUREMENT_TD))),
      "MeasurementCodec"
    );
    const full: Measurement = { label: "temp", count: -42, ratio: 2.5, enabled: true, unit: "C", sensor: { id: 7 } };
    expect(unwrap(tdbin.decode(measurementCodec, unwrap(tdbin.encode(measurementCodec, full))))).toEqual(full);
    const sparse: Measurement = {
      label: "",
      count: Number.MAX_SAFE_INTEGER,
      ratio: -0.125,
      enabled: false,
      unit: undefined,
      sensor: { id: 0 },
    };
    expect(unwrap(tdbin.decode(measurementCodec, unwrap(tdbin.encode(measurementCodec, sparse))))).toEqual(sparse);
    const writerCodec = codecFor<WriterPacket>(unwrap(emitTypeScriptCodec(modelFor(NULL_WRITER_TD))), "PacketCodec");
    const readerCodec = codecFor<ReaderPacket>(unwrap(emitTypeScriptCodec(modelFor(NULL_READER_TD))), "PacketCodec");
    const nulls = unwrap(tdbin.encode(writerCodec, { name: undefined, data: undefined, contact: undefined }));
    expect(unwrap(tdbin.decode(readerCodec, nulls))).toEqual({
      name: "",
      data: new Uint8Array(0),
      contact: { kind: "Idle", _0: { reason: "" } },
    });
    const bareArm = unwrap(
      tdbin.encode(writerCodec, { name: "ping", data: new Uint8Array([9, 8]), contact: { kind: "Idle" } })
    );
    expect(unwrap(tdbin.decode(readerCodec, bareArm))).toEqual({
      name: "ping",
      data: new Uint8Array([9, 8]),
      contact: { kind: "Idle", _0: { reason: "" } },
    });
    const present = unwrap(
      tdbin.encode(writerCodec, { name: "n", data: new Uint8Array([1]), contact: { kind: "Note", _0: "hi" } })
    );
    expect(unwrap(tdbin.decode(readerCodec, present))).toEqual({
      name: "n",
      data: new Uint8Array([1]),
      contact: { kind: "Note", _0: "hi" },
    });
  });

  it("pins Rust-identical layout hashes and guards framed + base64 decodes [TDBIN-SCHEMA-HASH] [TDBIN-FRAME-BASE64]", () => {
    interface Person {
      readonly name: string;
      readonly age: number;
      readonly active: boolean;
      readonly score: number;
      readonly address: { readonly street: string; readonly zip: number } | undefined;
      readonly nickname: string | undefined;
      readonly contact: { readonly kind: "Email"; readonly _0: { readonly addr: string } };
    }
    const tsSource = unwrap(emitTypeScriptCodec(modelFor(PERSON_TD)));
    const rust = unwrap(emitRustCodec(modelFor(PERSON_TD)));
    const codecs = instantiateCodecs(tsSource);
    const rustHashes = rust
      .split("\n")
      .filter((line) => line.includes("const LAYOUT_HASH: u64 = "))
      .map((line) => BigInt(line.slice(line.indexOf("0x"), line.lastIndexOf(";")).replaceAll("_", "")));
    const tsHashes = ["Address", "EmailContact", "PhoneContact", "Contact", "Person"].map(
      (name) => codecFor<unknown>(tsSource, `${name}Codec`).layoutHash
    );
    expect(rustHashes).toHaveLength(5);
    expect(tsHashes).toEqual(rustHashes);
    expect(new Set(tsHashes).size).toBe(5);
    expect(tsHashes.every((hash) => hash !== undefined && hash !== 0n)).toBe(true);
    expect(Object.keys(codecs)).toContain("PersonCodec");
    const personCodec = codecFor<Person>(tsSource, "PersonCodec");
    const pinned = personCodec.layoutHash ?? 0n;
    const person: Person = {
      name: "Ada",
      age: -9_007_199_254_740_991,
      active: true,
      score: 1.5,
      address: { street: "1 Loop", zip: 3000 },
      nickname: undefined,
      contact: { kind: "Email", _0: { addr: "a@b.c" } },
    };
    const framed = unwrap(tdbin.encodeFramed(personCodec, person));
    expect(unwrap(tdbin.frame.decodeFrame(framed)).schemaHash).toBe(pinned);
    expect(unwrap(tdbin.decodeFramed(personCodec, framed))).toEqual(person);
    expect(unwrap(tdbin.decodeAuto(personCodec, framed))).toEqual(person);
    const packed = unwrap(tdbin.encodePackedFramed(personCodec, person));
    expect(unwrap(tdbin.frame.decodeFrame(packed)).packed).toBe(true);
    expect(unwrap(tdbin.decodeFramed(personCodec, packed))).toEqual(person);
    const wrongHash = unwrap(tdbin.encodeFramed(personCodec, person, pinned ^ 1n));
    const mismatch = tdbin.decodeFramed(personCodec, wrongHash);
    expect(mismatch.ok ? null : mismatch.error).toMatchObject({
      code: "HashMismatch",
      expectedHash: pinned,
      gotHash: pinned ^ 1n,
    });
    expect(tdbin.decodeAuto(personCodec, wrongHash).ok).toBe(false);
    const hashless = unwrap(tdbin.encodeFramed(personCodec, person, null));
    const missing = tdbin.decodeFramed(personCodec, hashless);
    expect(missing.ok ? null : missing.error).toMatchObject({ code: "HashMismatch", gotHash: null });
    expect(unwrap(tdbin.decodeAuto(personCodec, hashless))).toEqual(person);
    expect(unwrap(tdbin.decodeFramed(personCodec, hashless, null))).toEqual(person);
    expect(unwrap(tdbin.decodeAuto(personCodec, unwrap(tdbin.encode(personCodec, person))))).toEqual(person);
    const text = unwrap(tdbin.encodeFramedBase64(personCodec, person));
    expect(text).toBe(tdbin.toBase64(packed));
    expect(Buffer.from(text, "base64").equals(Buffer.from(packed))).toBe(true);
    expect(unwrap(tdbin.decodeFramedBase64(personCodec, text))).toEqual(person);
    const errorCode = (result: { ok: boolean; error?: { code: string } }) => result.error?.code;
    expect(errorCode(tdbin.decodeFramedBase64(personCodec, "not base64!"))).toBe("BadBase64");
    expect(errorCode(tdbin.decodeFramedBase64(personCodec, Buffer.from("XXXX0000000000").toString("base64")))).toBe(
      "BadMagic"
    );
    expect(errorCode(tdbin.decodeFramedBase64(personCodec, tdbin.toBase64(wrongHash)))).toBe("HashMismatch");
    expect(errorCode(tdbin.decodeFramedBase64(personCodec, ""))).toBe("LengthMismatch");
    const big = new Uint8Array(70_000).map((_, index) => index % 251);
    expect(Buffer.from(unwrap(tdbin.fromBase64(tdbin.toBase64(big)))).equals(Buffer.from(big))).toBe(true);
    expect(tdbin.toBase64(big)).toBe(Buffer.from(big).toString("base64"));
  });

  it("round-trips struct-form and multi-field tuple union variants with Rust-identical hashes [TDBIN-UNION-STRUCT] #61", () => {
    type Point = { readonly x: number; readonly y: number };
    type Shape =
      | { readonly kind: "Circle"; readonly radius: number; readonly label: string }
      | { readonly kind: "Rect"; readonly w: number; readonly h: number; readonly corner: Point }
      | { readonly kind: "Pair"; readonly _0: number; readonly _1: string }
      | { readonly kind: "Tagged"; readonly _0: Point }
      | { readonly kind: "Empty" };
    interface Canvas {
      readonly name: string;
      readonly shape: Shape;
      readonly backup: Shape | undefined;
    }
    const td = readFileSync(fileURLToPath(new URL("./fixtures/shapes.td", import.meta.url)), "utf8");
    const tsSource = unwrap(emitTypeScriptCodec(modelFor(td)));
    const rust = unwrap(emitRustCodec(modelFor(td)));
    const canvasCodec = codecFor<Canvas>(tsSource, "CanvasCodec");
    const shapeCodec = codecFor<Shape>(tsSource, "ShapeCodec");
    expect(shapeCodec.ptrWords).toBe(1);
    const rustHash = (type: string) => {
      const block = rust.slice(rust.indexOf(`impl tdbin::Struct for ${type} {`));
      const line = block.slice(
        block.indexOf("LAYOUT_HASH: u64 = ") + 19,
        block.indexOf(";", block.indexOf("LAYOUT_HASH"))
      );
      return BigInt(line.replaceAll("_", ""));
    };
    expect(canvasCodec.layoutHash).toBe(rustHash("Canvas"));
    expect(shapeCodec.layoutHash).toBe(rustHash("Shape"));
    expect(rust).toContain("Self::Rect { w: f0, h: f1, corner: f2 } => {");
    expect(rust).toContain("Self::Pair(f0, f1) => {");
    const shapes: Shape[] = [
      { kind: "Circle", radius: 2.5, label: "sun" },
      { kind: "Rect", w: -1, h: 1e9, corner: { x: 0.5, y: -0.5 } },
      { kind: "Pair", _0: -9_007_199_254_740_991, _1: "pair" },
      { kind: "Tagged", _0: { x: 3, y: 4 } },
      { kind: "Empty" },
    ];
    for (const shape of shapes) {
      for (const backup of [undefined, ...shapes]) {
        const canvas: Canvas = { name: shape.kind, shape, backup };
        expect(unwrap(tdbin.decode(canvasCodec, unwrap(tdbin.encode(canvasCodec, canvas))))).toEqual(canvas);
        expect(
          unwrap(tdbin.decodeFramedBase64(canvasCodec, unwrap(tdbin.encodeFramedBase64(canvasCodec, canvas))))
        ).toEqual(canvas);
      }
      expect(unwrap(tdbin.decode(shapeCodec, unwrap(tdbin.encode(shapeCodec, shape))))).toEqual(shape);
    }
    const zeroCircle = unwrap(tdbin.encode(shapeCodec, { kind: "Circle", radius: 0, label: "" }));
    const zeroRect = unwrap(tdbin.encode(shapeCodec, { kind: "Rect", w: 0, h: 0, corner: { x: 0, y: 0 } }));
    expect(Buffer.from(zeroCircle).equals(Buffer.from(zeroRect))).toBe(false);
    const NULL_SHAPE_TD =
      "type Canvas {\n  name: String\n  shape: Option<Point>\n  backup: Option<Point>\n}\ntype Point {\n  x: Float\n  y: Float\n}";
    const nullWriter = codecFor<{ name: string; shape: undefined; backup: undefined }>(
      unwrap(emitTypeScriptCodec(modelFor(NULL_SHAPE_TD))),
      "CanvasCodec"
    );
    const nulls = unwrap(tdbin.encode(nullWriter, { name: "n", shape: undefined, backup: undefined }));
    expect(unwrap(tdbin.decode(canvasCodec, nulls))).toEqual({
      name: "n",
      shape: { kind: "Circle", radius: 0, label: "" },
      backup: undefined,
    });
  });

  it("round-trips every List<T> form and Option<List<T>> with Rust-identical hashes [TDBIN-TS-LIST] #62", () => {
    const td = `union Level {
  Low
  High
}
type Tag {
  key: String
  weight: Float
}
type Report {
  flags: List<Bool>
  counts: List<Int>
  ratios: List<Float>
  names: List<String>
  blobs: List<Bytes>
  tags: List<Tag>
  levels: List<Level>
  maybeCounts: Option<List<Int>>
  maybeTags: Option<List<Tag>>
  maybeLevels: Option<List<Level>>
  title: String
}`;
    type Level = { readonly kind: "Low" } | { readonly kind: "High" };
    interface Report {
      readonly flags: boolean[];
      readonly counts: number[];
      readonly ratios: number[];
      readonly names: string[];
      readonly blobs: Uint8Array[];
      readonly tags: { readonly key: string; readonly weight: number }[];
      readonly levels: Level[];
      readonly maybeCounts: number[] | undefined;
      readonly maybeTags: { readonly key: string; readonly weight: number }[] | undefined;
      readonly maybeLevels: Level[] | undefined;
      readonly title: string;
    }
    const tsSource = unwrap(emitTypeScriptCodec(modelFor(td)));
    const rust = unwrap(emitRustCodec(modelFor(td)));
    const reportCodec = codecFor<Report>(tsSource, "ReportCodec");
    const rustBlock = rust.slice(rust.indexOf("impl tdbin::Struct for Report {"));
    const rustHash = BigInt(
      rustBlock
        .slice(rustBlock.indexOf("LAYOUT_HASH: u64 = ") + 19, rustBlock.indexOf(";", rustBlock.indexOf("LAYOUT_HASH")))
        .replaceAll("_", "")
    );
    expect(reportCodec.layoutHash).toBe(rustHash);
    expect(reportCodec.ptrWords).toBe(11);
    expect(reportCodec.dataWords).toBe(0);
    const full: Report = {
      flags: [true, false, true, true, false, false, false, false, true],
      counts: [0, -1, Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER],
      ratios: [0.5, -0, Number.POSITIVE_INFINITY, 1e-300],
      names: ["", "α", "two words"],
      blobs: [new Uint8Array([]), new Uint8Array([0, 255, 7])],
      tags: [
        { key: "a", weight: 1.5 },
        { key: "", weight: -2 },
      ],
      levels: [{ kind: "High" }, { kind: "Low" }, { kind: "High" }],
      maybeCounts: [42],
      maybeTags: [],
      maybeLevels: [{ kind: "Low" }],
      title: "full",
    };
    expect(unwrap(tdbin.decode(reportCodec, unwrap(tdbin.encode(reportCodec, full))))).toEqual(full);
    const empty: Report = {
      flags: [],
      counts: [],
      ratios: [],
      names: [],
      blobs: [],
      tags: [],
      levels: [],
      maybeCounts: undefined,
      maybeTags: undefined,
      maybeLevels: undefined,
      title: "",
    };
    expect(unwrap(tdbin.decode(reportCodec, unwrap(tdbin.encode(reportCodec, empty))))).toEqual(empty);
    expect(unwrap(tdbin.decodeFramedBase64(reportCodec, unwrap(tdbin.encodeFramedBase64(reportCodec, full))))).toEqual(
      full
    );
    const tooBig = tdbin.encode(reportCodec, { ...full, counts: [2 ** 60] });
    expect(tooBig.ok ? "" : tooBig.error.code).toBe("LimitExceeded");
    const shortWriter = codecFor<Record<string, never>>(
      unwrap(emitTypeScriptCodec(modelFor("type Report {\n}"))),
      "ReportCodec"
    );
    expect(unwrap(tdbin.decode(reportCodec, unwrap(tdbin.encode(shortWriter, {}))))).toEqual({
      ...empty,
      title: "",
    });
    const bigSource = unwrap(emitTypeScriptCodec(modelFor(td), { integerType: "bigint" }));
    const bigCodec = codecFor<{ counts: bigint[] }>(bigSource, "ReportCodec");
    const huge = { ...full, counts: [-(2n ** 63n), 2n ** 63n - 1n], maybeCounts: [0n] };
    expect(unwrap(tdbin.decode(bigCodec, unwrap(tdbin.encode(bigCodec, huge))))).toEqual(huge);
    const rawLevels = td.replace("levels: List<Level>", "levels: Bytes");
    const rawCodec = codecFor<Report & { levels: Uint8Array }>(
      unwrap(emitTypeScriptCodec(modelFor(rawLevels))),
      "ReportCodec"
    );
    const unknown = tdbin.decode(
      reportCodec,
      unwrap(tdbin.encode(rawCodec, { ...full, levels: new Uint8Array([1, 9]) }))
    );
    expect(unknown.ok ? null : unknown.error).toMatchObject({ code: "UnknownVariant", ordinal: 9n });
    const known = tdbin.decode(
      reportCodec,
      unwrap(tdbin.encode(rawCodec, { ...full, levels: new Uint8Array([1, 0]) }))
    );
    expect(unwrap(known).levels).toEqual([{ kind: "High" }, { kind: "Low" }]);
  });

  it("reproduces the Rust golden bytes for every List<T> form byte for byte [TDBIN-TS-LIST] [TDBIN-TEST-GOLDEN] #85", () => {
    const fixture = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
    const golden = fixture("../../../../crates/tdbin/tests/golden/report_lists.hex").trim();
    const codec = codecFor<Record<string, unknown>>(
      unwrap(emitTypeScriptCodec(modelFor(fixture("./fixtures/reports.td")), { integerType: "bigint" })),
      "ReportCodec"
    );
    const value = {
      flags: [true, false, true, true, false, false, false, false, true],
      counts: [0n, -1n, 2n ** 63n - 1n, -(2n ** 63n)],
      ratios: [0.5, -0, Number.POSITIVE_INFINITY, 1e-300],
      names: ["", "α", "two words"],
      blobs: [new Uint8Array([]), new Uint8Array([0, 255, 7])],
      tags: [
        { key: "a", weight: 1.5 },
        { key: "", weight: -2 },
      ],
      levels: [{ kind: "High" }, { kind: "Low" }, { kind: "High" }],
      maybeCounts: [42n],
      maybeTags: [],
      maybeLevels: undefined,
      title: "golden",
    };
    const bytes = unwrap(tdbin.encodePackedFramed(codec, value));
    expect(tdbin.toHex(bytes)).toBe(golden);
    expect(unwrap(tdbin.decodeFramed(codec, unwrap(tdbin.fromHex(golden))))).toEqual(value);
    expect(unwrap(tdbin.frame.decodeFrame(bytes)).schemaHash).toBe(codec.layoutHash);
  });

  it("encodes width-refined integers and Path with range checks and Rust-identical bytes [TDBIN-WIDTH-RANGE] #85", () => {
    const fixture = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
    const td = fixture("./fixtures/widths.td");
    const tsSource = unwrap(emitTypeScriptCodec(modelFor(td)));
    const rust = unwrap(emitRustCodec(modelFor(td)));
    const statsCodec = codecFor<Record<string, unknown>>(tsSource, "StatsCodec");
    const rawCodec = codecFor<Record<string, unknown>>(tsSource, "StatsRawCodec");
    const rustHash = (type: string) => {
      const block = rust.slice(rust.indexOf(`impl tdbin::Struct for ${type} {`));
      const start = block.indexOf("LAYOUT_HASH: u64 = ") + 19;
      return BigInt(block.slice(start, block.indexOf(";", start)).replaceAll("_", ""));
    };
    expect(statsCodec.layoutHash).toBe(rustHash("Stats"));
    expect(rawCodec.layoutHash).toBe(rustHash("StatsRaw"));
    const golden = fixture("../../../../crates/tdbin/tests/golden/widths.hex").trim();
    const value = {
      delta: -(2 ** 31),
      flags: 255,
      port: 65535,
      hits: 2 ** 32 - 1,
      hash: 2n ** 64n - 1n,
      count: Number.MAX_SAFE_INTEGER,
      file: "/tmp/α/report.json",
      maybeHash: 0n,
      maybePort: undefined,
      maybeFile: "rel/path",
      deltas: [-(2 ** 31), -1, 0, 2 ** 31 - 1],
      bytes: [0, 1, 255],
      ports: [0, 1, 65535],
      hitsList: [2 ** 32 - 1, 7],
      hashes: [2n ** 64n - 1n, 0n],
      sizes: [Number.MAX_SAFE_INTEGER, 3],
      files: ["a", "b/c"],
      maybeSizes: [],
      maybeFiles: undefined,
    };
    const bytes = unwrap(tdbin.encodePackedFramed(statsCodec, value));
    expect(tdbin.toHex(bytes)).toBe(golden);
    expect(unwrap(tdbin.decodeFramed(statsCodec, bytes))).toEqual(value);
    const code = (r: { ok: boolean; error?: { code: string } }) => r.error?.code;
    for (const bad of [
      { delta: 2 ** 31 },
      { delta: -(2 ** 31) - 1 },
      { flags: 256 },
      { flags: -1 },
      { port: 65536 },
      { hits: 2 ** 32 },
      { hits: 1.5 },
      { hash: -1n },
      { hash: 2n ** 64n },
      { count: -1 },
      { count: 2 ** 53 },
      { ports: [65536] },
      { deltas: [2 ** 31] },
      { bytes: [256] },
      { hashes: [-1n] },
      { sizes: [-1] },
      { maybePort: 70000 },
    ]) {
      expect(
        code(tdbin.encode(statsCodec, { ...value, ...bad })),
        JSON.stringify(bad, (_k, v: unknown) => (typeof v === "bigint" ? String(v) : v))
      ).toBe("ValueOutOfRange");
    }
    const raw = { delta: 0n, flags: 0n, port: 0n, hits: 0n, hash: 0n, count: 0n };
    for (const over of [
      { delta: 2n ** 31n },
      { flags: 256n },
      { port: 65536n },
      { hits: 2n ** 32n },
      { count: 2n ** 53n },
    ]) {
      expect(code(tdbin.decode(statsCodec, unwrap(tdbin.encode(rawCodec, { ...raw, ...over }))))).toBe(
        "ValueOutOfRange"
      );
    }
    const inRange = unwrap(
      tdbin.decode(statsCodec, unwrap(tdbin.encode(rawCodec, { ...raw, delta: -5n, port: 65535n })))
    );
    expect([inRange.delta, inRange.port, inRange.file, inRange.files]).toEqual([-5, 65535, "", []]);
  });
});
