// [CONV-TS-TDBIN] Pins the TypeScript TDBIN code generator: it emits typed
// StructCodec objects over the runtime in `src/tdbin`, with layout baked into
// the generated code ([TDBIN-FUTURE-TS], [TDBIN-REC-ALLOC]).
import { runInNewContext } from "node:vm";
import ts from "typescript";
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
    expect(moduleText).toContain("export interface Person");
    expect(moduleText).toContain('export type Contact =\n  | { kind: "Email"; _0: EmailContact }');
    expect(moduleText).toContain("const defaultContact = ");
    expect(moduleText).toContain("export const PersonCodec");
  });

  it("rejects unsupported shapes loudly", () => {
    const result = emitTypeScriptCodec(modelFor("type R {\n  items: List<Int>\n}"));
    expectErrorMessages(result, ["unsupported field type 'List<Int>'"]);
    const moduleResult = generateTypeScriptModule(modelFor("type R {\n  items: List<Int>\n}"));
    expectErrorMessages(moduleResult, ["unsupported field type 'List<Int>'"]);
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
    const multi = emitTypeScriptCodec(modelFor("union Bad {\n  Both(Int, String)\n}"));
    const payload = emitTypeScriptCodec(modelFor("union Bad {\n  Count(Int)\n}"));
    expect(generic.ok ? "" : generic.error[0]?.message).toContain("must be monomorphized");
    expect(multi.ok ? "" : multi.error[0]?.message).toContain("bare or a single tuple field");
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
});
