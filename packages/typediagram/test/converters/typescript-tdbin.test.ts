// [CONV-TS-TDBIN] Pins the TypeScript TDBIN code generator: it emits typed
// StructCodec objects over the runtime in `src/tdbin`, with layout baked into
// the generated code ([TDBIN-FUTURE-TS], [TDBIN-REC-ALLOC]).
import { describe, expect, it } from "vitest";
import { emitTypeScriptCodec, generateTypeScriptModule } from "../../src/converters/typescript-tdbin.js";
import { buildModel } from "../../src/model/index.js";
import { parse } from "../../src/parser/index.js";
import type { Model } from "../../src/model/types.js";
import { unwrap } from "./helpers.js";

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

describe("[CONV-TS-TDBIN] TypeScript codec generator", () => {
  it("emits slot-addressed record codecs over the TypeScript runtime", () => {
    const code = unwrap(emitTypeScriptCodec(modelFor(PERSON_TD)));
    expect(code).toContain("export const PersonCodec: tdbin.StructCodec<Person>");
    expect(code).toContain("dataWords: 3");
    expect(code).toContain("ptrWords: 4");
    expect(code).toContain("tdbin.writer.string(writer, at, PersonCodec.dataWords, 0, value.name)");
    expect(code).toContain("const ageBits = tdbin.scalar.i64Bits(value.age);");
    expect(code).toContain("tdbin.writer.boolBit(writer, at, 1, 0, value.active)");
    expect(code).toContain(
      "tdbin.writer.child(writer, at, PersonCodec.dataWords, 1, AddressCodec, value.address ?? null)"
    );
    expect(code).toContain("const scoreWord = tdbin.reader.scalar(reader, at, 2);");
    expect(code).toContain("age: tdbin.scalar.i64From(ageWord.value)");
    expect(code).toContain("address: address.value ?? undefined");
  });

  it("emits union discriminant arms and required payload checks", () => {
    const code = unwrap(emitTypeScriptCodec(modelFor(PERSON_TD)));
    expect(code).toContain("export const ContactCodec: tdbin.StructCodec<Contact>");
    expect(code).toContain('case "Email": {');
    expect(code).toContain("const disc = tdbin.writer.scalar(writer, at, 0, 0n);");
    expect(code).toContain("tdbin.writer.child(writer, at, ContactCodec.dataWords, 0, EmailContactCodec, value._0)");
    expect(code).toContain("case 1n: {");
    expect(code).toContain('return ok({ kind: "Phone", _0: payload.value });');
    expect(code).toContain('return tdbin.readerError("UnknownVariant", { ordinal: ordinal.value });');
  });

  it("generates a self-contained module with type declarations and runtime imports", () => {
    const moduleText = unwrap(generateTypeScriptModule(modelFor(PERSON_TD)));
    expect(moduleText).toContain('import * as tdbin from "typediagram-core/tdbin";');
    expect(moduleText).toContain("export interface Person");
    expect(moduleText).toContain('export type Contact =\n  | { kind: "Email"; _0: EmailContact }');
    expect(moduleText).toContain("export const PersonCodec");
  });

  it("rejects unsupported shapes loudly", () => {
    const result = emitTypeScriptCodec(modelFor("type R {\n  items: List<Int>\n}"));
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error[0]?.message).toContain("unsupported field type 'List<Int>'");
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
    expect(code).toContain('return ok({ kind: "Empty" });');
    expect(code).toContain("tdbin.writer.string(writer, at, NoticeCodec.dataWords, 0, value._0)");
    expect(code).toContain("tdbin.reader.string(reader, at, NoticeCodec.dataWords, 0)");
  });

  it("rejects unsupported generic and variant shapes", () => {
    const generic = emitTypeScriptCodec(modelFor("type Box<T> {\n  value: T\n}"));
    const multi = emitTypeScriptCodec(modelFor("union Bad {\n  Both(Int, String)\n}"));
    const payload = emitTypeScriptCodec(modelFor("union Bad {\n  Count(Int)\n}"));
    expect(generic.ok ? "" : generic.error[0]?.message).toContain("must be monomorphized");
    expect(multi.ok ? "" : multi.error[0]?.message).toContain("bare or a single tuple field");
    expect(payload.ok ? "" : payload.error[0]?.message).toContain("payload 'Int' unsupported");
  });
});
