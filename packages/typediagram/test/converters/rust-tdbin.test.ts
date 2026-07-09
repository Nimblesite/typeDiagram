// [CONV-RUST-TDBIN] Tests for the TDBIN binary-codec generator: it turns a
// typeDiagram Model into `impl tdbin::Struct` blocks (the serialization half of
// "typeDiagram ADT <-> binary"). These pin the emitted layout/structure, prove
// every unsupported shape fails loudly, and drift-guard the committed crate
// fixture `crates/tdbin/tests/generated/mod.rs` against fresh codegen.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { emitRustCodec, generateRustModule } from "../../src/converters/rust-tdbin.js";
import { buildModel } from "../../src/model/index.js";
import { parse } from "../../src/parser/index.js";
import type { Model } from "../../src/model/types.js";
import { unwrap } from "./helpers.js";

const modelFor = (td: string): Model => unwrap(buildModel(unwrap(parse(td))));
const codecFor = (td: string): string => unwrap(emitRustCodec(modelFor(td)));

// The exact schema committed to crates/tdbin/tests/generated/mod.rs. Kept here
// so the structural assertions and the drift guard share one source of truth.
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

// The Option<scalar> fixture committed to crates/tdbin/tests/generated_opt/mod.rs.
const MEASUREMENT_TD = `type Measurement {
  label: String
  count: Option<Int>
  flagged: Option<Bool>
  ratio: Option<Float>
}`;

describe("[CONV-RUST-TDBIN] record + union codec structure", () => {
  it("bakes DATA_WORDS/PTR_WORDS and slot-addressed scalar/pointer field codecs", () => {
    const code = codecFor(PERSON_TD);
    // Address: one scalar (zip) + one pointer (street).
    expect(code).toMatch(/impl tdbin::Struct for Address \{\n    const DATA_WORDS: u16 = 1;\n    const PTR_WORDS: u16 = 1;/);
    // Person: three scalars (age/active/score), four pointers (name/address/nickname/contact).
    expect(code).toMatch(/impl tdbin::Struct for Person \{\n    const DATA_WORDS: u16 = 3;\n    const PTR_WORDS: u16 = 4;/);
    // Each scalar kind maps to its bit codec at a data slot.
    expect(code).toContain("w.scalar(at, 0, tdbin::scalar::i64_bits(self.age))?;");
    expect(code).toContain("w.scalar(at, 1, tdbin::scalar::bool_bits(self.active))?;");
    expect(code).toContain("w.scalar(at, 2, tdbin::scalar::f64_bits(self.score))?;");
    expect(code).toContain("let age = tdbin::scalar::i64_from(r.scalar(at, 0)?);");
  });

  it("distinguishes required vs optional pointer fields on read and write", () => {
    const code = codecFor(PERSON_TD);
    // Required String: write Some(&..), read unwraps null into an error.
    expect(code).toContain("w.string(at, Self::DATA_WORDS, 0, Some(&self.name))?;");
    expect(code).toContain("let name = r.string(at, Self::DATA_WORDS, 0)?.ok_or(tdbin::DecodeError::UnexpectedNull)?;");
    // Optional String: write as_deref(), read keeps the Option.
    expect(code).toContain("w.string(at, Self::DATA_WORDS, 2, self.nickname.as_deref())?;");
    expect(code).toContain("let nickname = r.string(at, Self::DATA_WORDS, 2)?;");
    // Optional child record: write as_ref(), read keeps the Option.
    expect(code).toContain("w.child(at, Self::DATA_WORDS, 1, self.address.as_ref())?;");
    expect(code).toContain("let address = r.child::<Address>(at, Self::DATA_WORDS, 1)?;");
    // Required child union: write Some(&..), read unwraps null.
    expect(code).toContain("w.child(at, Self::DATA_WORDS, 3, Some(&self.contact))?;");
    expect(code).toContain("let contact = r.child::<Contact>(at, Self::DATA_WORDS, 3)?.ok_or(tdbin::DecodeError::UnexpectedNull)?;");
  });

  it("emits union discriminant arms as Self:: with an UnknownVariant fallback", () => {
    const code = codecFor(PERSON_TD);
    expect(code).toMatch(/impl tdbin::Struct for Contact \{\n    const DATA_WORDS: u16 = 1;\n    const PTR_WORDS: u16 = 1;/);
    expect(code).toContain("Self::Email(payload) => {");
    expect(code).toContain("w.scalar(at, 0, 0)?;");
    expect(code).toContain("w.scalar(at, 0, 1)?;");
    expect(code).toContain("0 => Ok(Self::Email(");
    expect(code).toContain("1 => Ok(Self::Phone(");
    expect(code).toContain("ordinal => Err(tdbin::DecodeError::UnknownVariant { ordinal }),");
  });

  it("routes Bytes and Option<Bytes> through the pointer section", () => {
    const code = codecFor(`type Blob {\n  avatar: Bytes\n  thumb: Option<Bytes>\n}`);
    expect(code).toContain("w.bytes(at, Self::DATA_WORDS, 0, Some(&self.avatar))?;");
    expect(code).toContain("let avatar = r.bytes(at, Self::DATA_WORDS, 0)?.ok_or(tdbin::DecodeError::UnexpectedNull)?;");
    expect(code).toContain("w.bytes(at, Self::DATA_WORDS, 1, self.thumb.as_deref())?;");
    expect(code).toContain("let thumb = r.bytes(at, Self::DATA_WORDS, 1)?;");
  });

  it("emits string-payload, bare, and all-bare union arms", () => {
    const code = codecFor(`type E {\n  addr: String\n}\nunion Msg {\n  Mail(E)\n  Sms(String)\n  Empty\n}\nunion Color {\n  Red\n  Green\n}`);
    // String-payload variant (ordinal 1) round-trips a raw string in slot 0.
    expect(code).toContain("w.string(at, Self::DATA_WORDS, 0, Some(payload))");
    expect(code).toContain("1 => Ok(Self::Sms(r.string(at, Self::DATA_WORDS, 0)?.ok_or(tdbin::DecodeError::UnexpectedNull)?)),");
    // Bare variant inside a mixed union: discriminant only, no payload.
    expect(code).toContain("Self::Empty => {");
    expect(code).toContain("2 => Ok(Self::Empty),");
    // An all-bare union needs no pointer section.
    expect(code).toMatch(/impl tdbin::Struct for Color \{\n    const DATA_WORDS: u16 = 1;\n    const PTR_WORDS: u16 = 0;/);
    expect(code).toContain("0 => Ok(Self::Red),");
  });
});

describe("[CONV-RUST-TDBIN] Option<scalar> presence + value slots", () => {
  it("allocates a presence slot then a value slot per Option<scalar> ([TDBIN-PRIM-OPTION])", () => {
    const code = codecFor(MEASUREMENT_TD);
    // label (String) is the sole pointer; three Option<scalar> fill 6 data words.
    expect(code).toMatch(/impl tdbin::Struct for Measurement \{\n    const DATA_WORDS: u16 = 6;\n    const PTR_WORDS: u16 = 1;/);
    // Write: presence = is_some(), value = map_or(0, codec) so None writes zeros.
    expect(code).toContain("w.scalar(at, 0, u64::from(self.count.is_some()))?;");
    expect(code).toContain("w.scalar(at, 1, self.count.map_or(0, tdbin::scalar::i64_bits))?;");
    expect(code).toContain("w.scalar(at, 2, u64::from(self.flagged.is_some()))?;");
    expect(code).toContain("w.scalar(at, 3, self.flagged.map_or(0, tdbin::scalar::bool_bits))?;");
    expect(code).toContain("w.scalar(at, 5, self.ratio.map_or(0, tdbin::scalar::f64_bits))?;");
    // Read: the presence flag gates then_some over the decoded value.
    expect(code).toContain("let count_present = r.scalar(at, 0)? != 0;");
    expect(code).toContain("let count_value = tdbin::scalar::i64_from(r.scalar(at, 1)?);");
    expect(code).toContain("let count = count_present.then_some(count_value);");
    expect(code).toContain("let ratio = ratio_present.then_some(ratio_value);");
  });
});

describe("[CONV-RUST-TDBIN] generateRustModule assembles a deny-all-clean module", () => {
  it("emits doc comments, derives, aliases, and the codec together", () => {
    const mod = unwrap(generateRustModule(modelFor(`alias Id = Int\ntype Tag {\n  label: String\n}`)));
    expect(mod).toContain("/// The `Tag` record.");
    expect(mod).toContain("#[derive(Debug, Clone, PartialEq)]");
    expect(mod).toContain("    /// The `label` field.");
    // An alias gets its doc but no derive line.
    expect(mod).toContain("/// The `Id` alias.\npub type Id = i64;");
    expect(mod).toContain("impl tdbin::Struct for Tag {");
  });
});

describe("[CONV-RUST-TDBIN] fails loudly on unsupported shapes (no placeholders)", () => {
  it("rejects an unsupported field type", () => {
    const r = emitRustCodec(modelFor(`type R {\n  items: List<Int>\n}`));
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.error[0]?.message).toContain("unsupported field type");
  });

  it("rejects an Option over an unsupported inner type", () => {
    const r = emitRustCodec(modelFor(`type R {\n  x: Option<List<Int>>\n}`));
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.error[0]?.message).toContain("unsupported field type");
  });

  it("rejects a generic decl that was not monomorphized", () => {
    const r = emitRustCodec(modelFor(`type Box<T> {\n  value: T\n}`));
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.error[0]?.message).toContain("must be monomorphized");
  });

  it("rejects a variant that is neither bare nor a single tuple field", () => {
    const r = emitRustCodec(modelFor(`union U {\n  Multi(Int, String)\n}`));
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.error[0]?.message).toContain("bare or a single tuple field");
  });

  it("rejects a variant payload that has no v0 wire encoding", () => {
    const r = emitRustCodec(modelFor(`union U {\n  Weird(Int)\n}`));
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.error[0]?.message).toContain("unsupported in v0");
  });

  it("propagates codec errors through generateRustModule", () => {
    const r = generateRustModule(modelFor(`type R {\n  items: List<Int>\n}`));
    expect(r.ok).toBe(false);
  });
});

describe("[CONV-RUST-TDBIN] drift guard vs the committed crate fixtures", () => {
  // rustfmt only rewraps and adds trailing commas; compare token streams with
  // whitespace and trailing commas normalized away.
  const norm = (s: string): string => s.replace(/\s+/g, "").replace(/,(?=[)}\]])/g, "");
  const expectReproduces = (td: string, relPath: string): void => {
    const generated = unwrap(generateRustModule(modelFor(td)));
    const committed = readFileSync(fileURLToPath(new URL(relPath, import.meta.url)), "utf8");
    const marker = committed.indexOf("// <<<GENERATED");
    expect(marker).toBeGreaterThan(-1);
    const body = committed.slice(committed.indexOf("\n", marker) + 1);
    expect(norm(body)).toBe(norm(generated));
  };

  it("reproduces generated/mod.rs (Person fixture)", () => {
    expectReproduces(PERSON_TD, "../../../../crates/tdbin/tests/generated/mod.rs");
  });

  it("reproduces generated_opt/mod.rs (Option<scalar> Measurement fixture)", () => {
    expectReproduces(MEASUREMENT_TD, "../../../../crates/tdbin/tests/generated_opt/mod.rs");
  });
});
