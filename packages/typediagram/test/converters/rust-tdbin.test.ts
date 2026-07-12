// [CONV-RUST-TDBIN] Tests for the TDBIN binary-codec generator: it turns a
// typeDiagram Model into `impl tdbin::Struct` blocks (the serialization half of
// "typeDiagram ADT <-> binary"). These pin the emitted layout/structure, prove
// every unsupported shape fails loudly, and drift-guard the committed crate
// fixture `crates/tdbin/tests/generated/mod.rs` against fresh codegen.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { emitRustCodec, generateRustModule } from "../../src/converters/rust-tdbin.js";
import { fnv1a64, layoutHashLiteral, layoutManifest } from "../../src/converters/rust-tdbin-hash.js";
import { buildModel } from "../../src/model/index.js";
import { parse } from "../../src/parser/index.js";
import type { Model } from "../../src/model/types.js";
import { expectErrorMessages, expectRustModuleReproduces, unwrap } from "./helpers.js";

const modelFor = (td: string): Model => unwrap(buildModel(unwrap(parse(td))));
const codecFor = (td: string): string => unwrap(emitRustCodec(modelFor(td)));

const fixtureTd = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`fixtures/${name}`, import.meta.url)), "utf8");

// The exact schema committed to crates/tdbin/tests/generated/mod.rs: the
// structural assertions, the drift guard, and scripts/tdbin-regen-fixtures.mjs
// all read this ONE fixture file.
const PERSON_TD = fixtureTd("person.td");

// The Option<scalar> fixture committed to crates/tdbin/tests/generated_opt/mod.rs.
const MEASUREMENT_TD = fixtureTd("measurement.td");

describe("[CONV-RUST-TDBIN] record + union codec structure", () => {
  it("bakes DATA_WORDS/PTR_WORDS and slot-addressed scalar/pointer field codecs", () => {
    const code = codecFor(PERSON_TD);
    // Address: one scalar (zip) + one pointer (street).
    expect(code).toMatch(
      /impl tdbin::Struct for Address \{\n[ ]{4}const DATA_WORDS: u16 = 1;\n[ ]{4}const PTR_WORDS: u16 = 1;/
    );
    // Person: three scalars (age/active/score), four pointers (name/address/nickname/contact).
    expect(code).toMatch(
      /impl tdbin::Struct for Person \{\n[ ]{4}const DATA_WORDS: u16 = 3;\n[ ]{4}const PTR_WORDS: u16 = 4;/
    );
    // Word scalars map to scalar codecs; Bool maps to a packed bit.
    expect(code).toContain("w.scalar(at, 0, tdbin::scalar::i64_bits(self.age))?;");
    expect(code).toContain("w.bool_bit(at, 1, 0, self.active)?;");
    expect(code).toContain("w.scalar(at, 2, tdbin::scalar::f64_bits(self.score))?;");
    expect(code).toContain("let age = tdbin::scalar::i64_from(r.scalar(at, 0)?);");
    expect(code).toContain("let active = r.bool_bit(at, 1, 0)?;");
  });

  it("distinguishes required vs optional pointer fields on read and write", () => {
    const code = codecFor(PERSON_TD);
    // Required String: write Some(&..), read decodes null as the schema
    // default ([TDBIN-PTR-NULL], [TDBIN-REC-SHORT]).
    expect(code).toContain("w.string(at, Self::DATA_WORDS, 0, Some(&self.name))?;");
    expect(code).toContain("let name = r.string(at, Self::DATA_WORDS, 0)?.unwrap_or_default();");
    expect(code).not.toContain("UnexpectedNull");
    // Optional String: write as_deref(), read keeps the Option.
    expect(code).toContain("w.string(at, Self::DATA_WORDS, 2, self.nickname.as_deref())?;");
    expect(code).toContain("let nickname = r.string(at, Self::DATA_WORDS, 2)?;");
    // Optional child record: write as_ref(), read keeps the Option.
    expect(code).toContain("w.child(at, Self::DATA_WORDS, 1, self.address.as_ref())?;");
    expect(code).toContain("let address = r.child::<Address>(at, Self::DATA_WORDS, 1)?;");
    // Required child union: write Some(&..), read defaults null.
    expect(code).toContain("w.child(at, Self::DATA_WORDS, 3, Some(&self.contact))?;");
    expect(code).toContain("let contact = r.child::<Contact>(at, Self::DATA_WORDS, 3)?.unwrap_or_default();");
  });

  it("emits union discriminant arms as Self:: with a slot-verified UnknownVariant fallback and a first-variant Default", () => {
    const code = codecFor(PERSON_TD);
    expect(code).toMatch(
      /impl tdbin::Struct for Contact \{\n[ ]{4}const DATA_WORDS: u16 = 1;\n[ ]{4}const PTR_WORDS: u16 = 1;/
    );
    expect(code).toContain("Self::Email(payload) => {");
    expect(code).toContain("w.scalar(at, 0, 0)?;");
    expect(code).toContain("w.scalar(at, 0, 1)?;");
    expect(code).toContain("0 => Ok(Self::Email(");
    expect(code).toContain("1 => Ok(Self::Phone(");
    // [TDBIN-UNION-UNKNOWN]: verify the remaining slots, then fail typed.
    expect(code).toContain(
      [
        "            ordinal => {",
        "                r.verify_struct_slots(at)?;",
        "                Err(tdbin::DecodeError::UnknownVariant { ordinal })",
        "            }",
      ].join("\n")
    );
    // [TDBIN-PTR-NULL]: unions default to their FIRST variant.
    expect(code).toContain(
      [
        "impl Default for Contact {",
        "    fn default() -> Self {",
        "        Self::Email(EmailContact::default())",
        "    }",
        "}",
      ].join("\n")
    );
  });

  it("routes Bytes and Option<Bytes> through the pointer section", () => {
    const code = codecFor(`type Blob {\n  avatar: Bytes\n  thumb: Option<Bytes>\n}`);
    expect(code).toContain("w.bytes(at, Self::DATA_WORDS, 0, Some(&self.avatar))?;");
    expect(code).toContain("let avatar = r.bytes(at, Self::DATA_WORDS, 0)?.unwrap_or_default();");
    expect(code).toContain("w.bytes(at, Self::DATA_WORDS, 1, self.thumb.as_deref())?;");
    expect(code).toContain("let thumb = r.bytes(at, Self::DATA_WORDS, 1)?;");
  });

  it("packs direct Bool fields into reusable bitset words", () => {
    const code = codecFor(`type Flags {\n  a: Bool\n  count: Int\n  b: Bool\n  c: Bool\n}`);
    expect(code).toMatch(
      /impl tdbin::Struct for Flags \{\n[ ]{4}const DATA_WORDS: u16 = 2;\n[ ]{4}const PTR_WORDS: u16 = 0;/
    );
    expect(code).toContain("w.bool_bit(at, 0, 0, self.a)?;");
    expect(code).toContain("w.scalar(at, 1, tdbin::scalar::i64_bits(self.count))?;");
    expect(code).toContain("w.bool_bit(at, 0, 1, self.b)?;");
    expect(code).toContain("w.bool_bit(at, 0, 2, self.c)?;");
    expect(code).toContain("let b = r.bool_bit(at, 0, 1)?;");
  });

  it("emits string-payload, bare, and all-bare union arms", () => {
    const code = codecFor(
      `type E {\n  addr: String\n}\nunion Msg {\n  Mail(E)\n  Sms(String)\n  Empty\n}\nunion Color {\n  Red\n  Green\n}\nunion Note {\n  Text(String)\n}`
    );
    // String-payload variant (ordinal 1) round-trips a raw string in slot 0,
    // decoding null as the empty-string default ([TDBIN-PTR-NULL]).
    expect(code).toContain("w.string(at, Self::DATA_WORDS, 0, Some(payload))");
    expect(code).toContain("1 => Ok(Self::Sms(r.string(at, Self::DATA_WORDS, 0)?.unwrap_or_default())),");
    // Bare variant inside a mixed union: discriminant only, no payload.
    expect(code).toContain("Self::Empty => {");
    expect(code).toContain("r.require_null_pointer(at, 0)?;");
    // An all-bare union needs no pointer section.
    expect(code).toMatch(
      /impl tdbin::Struct for Color \{\n[ ]{4}const DATA_WORDS: u16 = 1;\n[ ]{4}const PTR_WORDS: u16 = 0;/
    );
    expect(code).toContain("Ok(Self::Red)");
    // Every union defaults to its FIRST variant: record payloads construct the
    // payload default, bare firsts are the bare variant itself.
    expect(code).toContain(
      "impl Default for Msg {\n    fn default() -> Self {\n        Self::Mail(E::default())\n    }\n}"
    );
    expect(code).toContain("impl Default for Color {\n    fn default() -> Self {\n        Self::Red\n    }\n}");
    // A String-payload first variant defaults to the empty string.
    expect(code).toContain(
      "impl Default for Note {\n    fn default() -> Self {\n        Self::Text(String::default())\n    }\n}"
    );
  });
});

describe("[CONV-RUST-TDBIN] Option<scalar> presence + value slots", () => {
  it("allocates a 1-bit presence flag then a natural-width value slot per Option<scalar> ([TDBIN-PRIM-OPTION])", () => {
    const code = codecFor(MEASUREMENT_TD);
    // label (String) is the sole pointer. Bitset word 0 carries count-presence
    // (bit 0), flagged-presence (bit 1), flagged-VALUE (bit 2), and
    // ratio-presence (bit 3); count's value is word 1, ratio's word 2.
    expect(code).toMatch(
      /impl tdbin::Struct for Measurement \{\n[ ]{4}const DATA_WORDS: u16 = 3;\n[ ]{4}const PTR_WORDS: u16 = 1;/
    );
    // Write: presence = one bool bit, value = map_or zero lanes ([TDBIN-ENC-ZERO]).
    expect(code).toContain("w.bool_bit(at, 0, 0, self.count.is_some())?;");
    expect(code).toContain("w.scalar(at, 1, self.count.map_or(0, tdbin::scalar::i64_bits))?;");
    expect(code).toContain("w.bool_bit(at, 0, 1, self.flagged.is_some())?;");
    expect(code).toContain("w.bool_bit(at, 0, 2, self.flagged.unwrap_or_default())?;");
    expect(code).toContain("w.bool_bit(at, 0, 3, self.ratio.is_some())?;");
    expect(code).toContain("w.scalar(at, 2, self.ratio.map_or(0, tdbin::scalar::f64_bits))?;");
    // Read: the presence bit gates then_some over the decoded value.
    expect(code).toContain("let count_present = r.bool_bit(at, 0, 0)?;");
    expect(code).toContain("let count_value = tdbin::scalar::i64_from(r.scalar(at, 1)?);");
    expect(code).toContain("let count = count_present.then_some(count_value);");
    expect(code).toContain("let flagged_value = r.bool_bit(at, 0, 2)?;");
    expect(code).toContain("let flagged = flagged_present.then_some(flagged_value);");
    expect(code).toContain("let ratio_value = tdbin::scalar::f64_from(r.scalar(at, 2)?);");
    expect(code).toContain("let ratio = ratio_present.then_some(ratio_value);");
    expect(code).not.toContain("u64::from(self.count.is_some())");
  });
});

describe("[CONV-RUST-TDBIN] semantic scalar byte layouts", () => {
  it("emits DateTime as i64 micros and Uuid/Decimal as two 8-byte words, with 1-bit option presence", () => {
    const code = codecFor(
      `type Audit {\n  createdAt: DateTime\n  expiresAt: Option<DateTime>\n  id: Uuid\n  amount: Decimal\n  parent: Option<Uuid>\n}`
    );
    // createdAt w0; presence bitset w1 (expiresAt bit 0, parent bit 1);
    // expiresAt value w2; id w3-4; amount w5-6; parent value 128-bit-ALIGNED
    // at w8-9 (w7 is the alignment hole) -> 10 data words.
    expect(code).toMatch(
      /impl tdbin::Struct for Audit \{\n[ ]{4}const DATA_WORDS: u16 = 10;\n[ ]{4}const PTR_WORDS: u16 = 0;/
    );
    expect(code).toContain("tdbin::scalar::i64_bits(self.createdAt.timestamp_micros())");
    expect(code).toContain("w.bool_bit(at, 1, 0, self.expiresAt.is_some())?;");
    expect(code).toContain(
      "w.scalar(at, 2, self.expiresAt.as_ref().map_or(0, |value| tdbin::scalar::i64_bits(value.timestamp_micros())))?;"
    );
    expect(code).toContain("let expiresAt_present = r.bool_bit(at, 1, 0)?;");
    expect(code).toContain("let id_words = tdbin::scalar::bytes16_words(self.id.as_bytes());");
    expect(code).toContain("w.scalar(at, 3, id_words.0)?;");
    expect(code).toContain("let amount_words = tdbin::scalar::bytes16_words(&self.amount.serialize());");
    expect(code).toContain("w.scalar(at, 5, amount_words.0)?;");
    expect(code).toContain(
      "let parent_words = self.parent.as_ref().map(|value| tdbin::scalar::bytes16_words(value.as_bytes()));"
    );
    expect(code).toContain("w.bool_bit(at, 1, 1, parent_words.is_some())?;");
    expect(code).toContain("w.scalar(at, 8, parent_lo)?;");
    expect(code).toContain("w.scalar(at, 9, parent_hi)?;");
    expect(code).toContain("let parent_present = r.bool_bit(at, 1, 1)?;");
    expect(code).toContain("chrono::DateTime::<chrono::Utc>::from_timestamp_micros");
    expect(code).toContain("uuid::Uuid::from_bytes(tdbin::scalar::bytes16_from_words");
    expect(code).toContain("rust_decimal::Decimal::deserialize(tdbin::scalar::bytes16_from_words");
  });
});

describe("[CONV-RUST-TDBIN] list codecs", () => {
  it("emits raw, pointer, composite, semantic, optional, and enum list codecs", () => {
    const code = codecFor(
      `type Point {\n  x: Int\n  y: Int\n}\nunion Color {\n  Red\n  Green\n}\ntype Lists {\n  flags: List<Bool>\n  scores: List<Int>\n  tags: List<String>\n  blobs: List<Bytes>\n  points: List<Point>\n  ids: List<Uuid>\n  colors: List<Color>\n  maybeScores: Option<List<Int>>\n  ratios: List<Float>\n}`
    );
    expect(code).toMatch(
      /impl tdbin::Struct for Lists \{\n[ ]{4}const DATA_WORDS: u16 = 0;\n[ ]{4}const PTR_WORDS: u16 = 9;/
    );
    expect(code).toContain("w.bool_list(at, Self::DATA_WORDS, 0, Some(&self.flags))?;");
    // Typed flat lists write straight through i64_list/f64_list — no
    // intermediate Vec<u64> collection.
    expect(code).toContain("w.i64_list(at, Self::DATA_WORDS, 1, Some(&self.scores))?;");
    expect(code).not.toContain("scores_words");
    expect(code).toContain("w.f64_list(at, Self::DATA_WORDS, 8, Some(&self.ratios))?;");
    expect(code).toContain("w.string_list(at, Self::DATA_WORDS, 2, Some(&self.tags))?;");
    expect(code).toContain("w.bytes_list(at, Self::DATA_WORDS, 3, Some(&self.blobs))?;");
    expect(code).toContain("w.child_list(at, Self::DATA_WORDS, 4, Some(&self.points))?;");
    expect(code).toContain("w.bytes16_list(at, Self::DATA_WORDS, 5, Some(&ids_words))?;");
    expect(code).toContain("&Color::Red => 0u8,");
    expect(code).toContain("w.byte_list(at, Self::DATA_WORDS, 6, Some(&colors_ordinals))?;");
    expect(code).toContain("w.i64_list(at, Self::DATA_WORDS, 7, self.maybeScores.as_deref())?;");
    expect(code).not.toContain("maybeScores_words");
    expect(code).toContain("let flags = r.bool_list(at, Self::DATA_WORDS, 0)?.unwrap_or_default();");
    expect(code).toContain("let scores = r.i64_list(at, Self::DATA_WORDS, 1)?.unwrap_or_default();");
    expect(code).toContain("let ratios = r.f64_list(at, Self::DATA_WORDS, 8)?.unwrap_or_default();");
    expect(code).toContain("let tags = r.string_list(at, Self::DATA_WORDS, 2)?.unwrap_or_default();");
    expect(code).toContain("let blobs = r.bytes_list(at, Self::DATA_WORDS, 3)?.unwrap_or_default();");
    expect(code).toContain("let points = r.child_list::<Point>(at, Self::DATA_WORDS, 4)?.unwrap_or_default();");
    expect(code).toContain("let ids = r.bytes16_list(at, Self::DATA_WORDS, 5)?.unwrap_or_default()");
    expect(code).toContain("0 => Ok(Color::Red),");
    expect(code).toContain("ordinal => Err(tdbin::DecodeError::UnknownVariant { ordinal: u64::from(ordinal) })");
    expect(code).toContain("let maybeScores = r.i64_list(at, Self::DATA_WORDS, 7)?;");
  });

  it("emits optional DateTime, bytes16, and enum list branches", () => {
    const code = codecFor(
      `union Color {\n  Red\n  Green\n}\ntype MaybeLists {\n  history: Option<List<DateTime>>\n  ids: Option<List<Uuid>>\n  colors: Option<List<Color>>\n}`
    );
    expect(code).toContain(
      "let history_words = self.history.as_ref().map(|values| values.iter().map(|value| tdbin::scalar::i64_bits(value.timestamp_micros())).collect::<Vec<_>>());"
    );
    expect(code).toContain("w.word_list(at, Self::DATA_WORDS, 0, history_words.as_deref())?;");
    expect(code).toContain(
      "let ids_words = self.ids.as_ref().map(|values| values.iter().map(|value| tdbin::scalar::bytes16_words(value.as_bytes())).collect::<Vec<_>>());"
    );
    expect(code).toContain("w.bytes16_list(at, Self::DATA_WORDS, 1, ids_words.as_deref())?;");
    expect(code).toContain("let colors_ordinals = self.colors.as_ref().map(|values| values.iter().map");
    expect(code).toContain("w.byte_list(at, Self::DATA_WORDS, 2, colors_ordinals.as_deref())?;");
    expect(code).toContain("let history = match r.word_list(at, Self::DATA_WORDS, 0)? {");
    expect(code).toContain("Some(values) => Some(values.into_iter().map(|word| chrono::DateTime");
    expect(code).toContain("let ids = r.bytes16_list(at, Self::DATA_WORDS, 1)?.map");
    expect(code).toContain("let colors = match r.byte_list(at, Self::DATA_WORDS, 2)? {");
  });

  it("uses composite lists for mixed unions", () => {
    const code = codecFor(
      `type Payload {\n  label: String\n}\nunion Event {\n  Seen(Payload)\n  Empty\n}\ntype Stream {\n  events: List<Event>\n}`
    );
    expect(code).toContain("w.child_list(at, Self::DATA_WORDS, 0, Some(&self.events))?;");
    expect(code).toContain("let events = r.child_list::<Event>(at, Self::DATA_WORDS, 0)?.unwrap_or_default();");
  });

  it("rejects List<enum> when one-byte ordinals would overflow", () => {
    const variants = Array.from({ length: 257 }, (_, i) => `  V${String(i)}`).join("\n");
    const r = emitRustCodec(modelFor(`union Wide {\n${variants}\n}\ntype R {\n  values: List<Wide>\n}`));
    expectErrorMessages(r, ["List<enum> 'Wide' has ordinals >= 256"]);
  });
});

describe("[CONV-RUST-TDBIN] generateRustModule assembles a deny-all-clean module", () => {
  it("emits doc comments, derives, aliases, and the codec together", () => {
    const mod = unwrap(generateRustModule(modelFor(`alias Id = Int\ntype Tag {\n  label: String\n}`)));
    expect(mod).toContain("/// The `Tag` record.");
    // Records derive Default so required pointer fields can decode null as
    // the schema default ([TDBIN-PTR-NULL]).
    expect(mod).toContain("#[derive(Debug, Clone, PartialEq, Default)]");
    expect(mod).toContain("    /// The `label` field.");
    // An alias gets its doc but no derive line.
    expect(mod).toContain("/// The `Id` alias.\npub type Id = i64;");
    expect(mod).toContain("impl tdbin::Struct for Tag {");
  });
});

describe("[CONV-RUST-TDBIN] fails loudly on unsupported shapes (no placeholders)", () => {
  it("rejects an unsupported field type", () => {
    const r = emitRustCodec(modelFor(`type R {\n  items: List<Map<String, Int>>\n}`));
    expectErrorMessages(r, ["unsupported field type"]);
  });

  it("rejects an Option over an unsupported inner type", () => {
    const r = emitRustCodec(modelFor(`type R {\n  x: Option<Map<String, Int>>\n}`));
    expectErrorMessages(r, ["unsupported field type"]);
  });

  // review finding `map-any`: Map<K,V> and Any have no v0 wire encoding, so the
  // codec must reject them LOUDLY as a typed Diagnostic (never a placeholder),
  // naming the exact type. No wire form is promised for these in v0.
  it("rejects a Map field with a typed error naming the type", () => {
    const r = emitRustCodec(modelFor(`type R {\n  m: Map<String, Int>\n}`));
    expectErrorMessages(r, ["unsupported field type 'Map<String, Int>'"]);
  });

  it("rejects an Any field with a typed error naming the type", () => {
    const r = emitRustCodec(modelFor(`type R {\n  a: Any\n}`));
    expectErrorMessages(r, ["unsupported field type 'Any'"]);
  });

  it("emits Option<empty-record> with null reserved for None", () => {
    const code = unwrap(emitRustCodec(modelFor(`type Empty {\n}\ntype Holder {\n  maybe: Option<Empty>\n}`)));
    expect(code).toContain("w.child(at, Self::DATA_WORDS, 0, self.maybe.as_ref())?;");
    expect(code).toContain("let maybe = r.child::<Empty>(at, Self::DATA_WORDS, 0)?;");
  });

  it("emits required empty-record child pointers with the non-null marker", () => {
    const code = unwrap(emitRustCodec(modelFor(`type Empty {\n}\ntype Holder {\n  value: Empty\n}`)));
    expect(code).toContain("w.child(at, Self::DATA_WORDS, 0, Some(&self.value))?;");
    expect(code).toContain("let value = r.child::<Empty>(at, Self::DATA_WORDS, 0)?.unwrap_or_default();");
  });

  it("rejects List<empty-record> before composite count would lose element identity", () => {
    const r = emitRustCodec(modelFor(`type Empty {\n}\ntype Holder {\n  values: List<Empty>\n}`));
    expectErrorMessages(r, ["List<empty-record> 'Empty' has a zero-word composite stride", "Holder.values"]);
  });

  // [TDBIN-SCHEMA-MONO] [TDBIN-SCHEMA-ALIAS] [TDBIN-UNION-OVERLAP] traced here.
  it("rejects a generic decl that was not monomorphized", () => {
    const r = emitRustCodec(modelFor(`type Box<T> {\n  value: T\n}`));
    expectErrorMessages(r, ["must be monomorphized"]);
  });

  it("rejects a variant that is neither bare nor a single tuple field", () => {
    const r = emitRustCodec(modelFor(`union U {\n  Multi(Int, String)\n}`));
    expectErrorMessages(r, ["bare or a single tuple field"]);
  });

  it("rejects a variant payload that has no v0 wire encoding", () => {
    const r = emitRustCodec(modelFor(`union U {\n  Weird(Int)\n}`));
    expectErrorMessages(r, ["unsupported in v0"]);
  });

  it("propagates codec errors through generateRustModule", () => {
    const r = generateRustModule(modelFor(`type R {\n  items: List<Map<String, Int>>\n}`));
    expect(r.ok).toBe(false);
  });
});

// The corpus-shaped columnar schema: a record exercising every column form
// (var, bit, word, validity, dense child group, dense union group, nested
// list), a union with two record payloads plus a bare variant, wrapped in a
// Batch whose list fields cover columnar, var-list, scalar, and optional forms.
const BATCH_TD = `type Detail {
  note: String
  weight: Float
}
type Extra {
  flag: Bool
}
union Kind {
  Basic(Detail)
  Extended(Extra)
  Bare
}
type Row {
  title: String
  active: Bool
  age: Int
  score: Float
  nickname: Option<String>
  detail: Option<Detail>
  kind: Kind
  tags: List<String>
}
type Batch {
  rows: List<Row>
  labels: List<String>
  nums: List<Int>
  extra: Option<List<Row>>
}`;

describe("[CONV-RUST-TDBIN] layout major 2 columnar lists ([TDBIN-COL-POLICY])", () => {
  it("emits column-group struct codecs, ColumnGroup impls, slot plans, and the dense union tag column", () => {
    const code = unwrap(emitRustCodec(modelFor(BATCH_TD), { layout: 2 }));
    // Batch: rows -> 1 column-list slot, labels -> 2 var-list slots, nums
    // keeps the layout-1 flat form, extra -> 1 optional column-list slot.
    expect(code).toMatch(
      /impl tdbin::Struct for Batch \{\n[ ]{4}const DATA_WORDS: u16 = 0;\n[ ]{4}const PTR_WORDS: u16 = 5;/
    );
    expect(code).toContain("w.column_list(at, Self::DATA_WORDS, 0, Some(&self.rows))?;");
    expect(code).toContain("let rows = r.column_list::<Row>(at, Self::DATA_WORDS, 0)?.unwrap_or_default();");
    expect(code).toContain("w.string_var_list(at, Self::DATA_WORDS, 1, 2, Some(&self.labels))?;");
    expect(code).toContain(
      [
        "        let labels = match r.var_list(at, Self::DATA_WORDS, 1, 2)? {",
        "            Some(column) => column.into_strings()?,",
        "            None => Vec::new(),",
        "        };",
      ].join("\n")
    );
    // List<Int> fields become frame-of-reference delta blocks at layout 2
    // ([TDBIN-COL-INTBLOCK]); empty round-trips as null like var lists.
    expect(code).toContain("w.i64_block_list(at, Self::DATA_WORDS, 3, Some(&self.nums))?;");
    expect(code).toContain("let nums = r.i64_block_list(at, Self::DATA_WORDS, 3)?.unwrap_or_default();");
    expect(code).toContain("w.opt_column_list(at, Self::DATA_WORDS, 4, self.extra.as_deref())?;");
    expect(code).toContain("let extra = r.column_list::<Row>(at, Self::DATA_WORDS, 4)?;");
    // Row group plan ([TDBIN-COL-PLAN]): title 0-1, active 2, age 3, score 4,
    // nickname 5-7, detail 8-9, kind 10, tags 11-13 -> 14 columns.
    expect(code).toContain("impl tdbin::ColumnGroup for Row {\n    const COLUMNS: u16 = 14;");
    expect(code).toContain("w.var_column(at, 1, 0, 1, count, items.clone().map(|row| row.title.as_bytes()))?;");
    expect(code).toContain("w.bit_column(at, 1, 2, count, items.clone().map(|row| row.active))?;");
    expect(code).toContain("w.i64_block_column(at, 1, 3, count, items.clone().map(|row| row.age))?;");
    expect(code).toContain("w.f64_column(at, 1, 4, count, items.clone().map(|row| row.score))?;");
    // Option<String>: validity bits then a var column with zero-length lanes.
    expect(code).toContain("w.bit_column(at, 1, 5, count, items.clone().map(|row| row.nickname.is_some()))?;");
    expect(code).toContain(
      "w.var_column(at, 1, 6, 7, count, items.clone().map(|row| row.nickname.as_deref().unwrap_or_default().as_bytes()))?;"
    );
    // Option<record>: validity bits then a DENSE child group, partitioned
    // ONCE into a ref vector whose len replaces a second counting pass.
    expect(code).toContain("w.bit_column(at, 1, 8, count, items.clone().map(|row| row.detail.is_some()))?;");
    expect(code).toContain("let detail: Vec<&Detail> = items.clone().filter_map(|row| row.detail.as_ref()).collect();");
    expect(code).toContain("w.dense_group(at, 1, 9, detail.len(), detail.iter().copied())?;");
    expect(code).not.toContain("let detail_count = items.clone().filter(|row| row.detail.is_some()).count();");
    // Union field: one dense union group aligned to every row.
    expect(code).toContain("w.dense_group(at, 1, 10, count, items.clone().map(|row| &row.kind))?;");
    // Nested List<String>: u32 row counts then one var column over the total.
    expect(code).toContain(
      "let tags_counts = items.clone().map(|row| u32::try_from(row.tags.len())).collect::<Result<Vec<_>, _>>().map_err(|_| tdbin::EncodeError::LimitExceeded)?;"
    );
    expect(code).toContain("w.len_column(at, 1, 11, &tags_counts)?;");
    expect(code).toContain(
      "let tags_total = items.clone().map(|row| row.tags.len()).try_fold(0_usize, usize::checked_add).ok_or(tdbin::EncodeError::LimitExceeded)?;"
    );
    expect(code).toContain(
      "w.var_column(at, 1, 12, 13, tags_total, items.clone().flat_map(|row| row.tags.iter()).map(String::as_bytes))?;"
    );
    // Row reads: aligned columns index by row, dense/var columns consume
    // exactly-counted iterators, nested lists take per-row slices.
    expect(code).toContain("let mut title = r.var_column(at, 0, 1, count)?.into_strings()?.into_iter();");
    expect(code).toContain("let active = r.bit_column(at, 2, count)?;");
    expect(code).toContain("active: active.get(i).copied().unwrap_or_default(),");
    expect(code).toContain("let age = r.i64_block_column(at, 3, count)?;");
    expect(code).toContain("let score = r.f64_column(at, 4, count)?;");
    expect(code).toContain("let nickname_valid = r.bit_column(at, 5, count)?;");
    expect(code).toContain("let nickname_values = r.var_column(at, 6, 7, count)?.into_strings()?;");
    expect(code).toContain(
      "let mut nickname = nickname_valid.into_iter().zip(nickname_values).map(|(valid, value)| valid.then_some(value));"
    );
    expect(code).toContain("let detail_count = detail_valid.iter().filter(|present| **present).count();");
    expect(code).toContain("let mut detail = r.dense_group::<Detail>(at, 9, detail_count)?.into_iter();");
    expect(code).toContain(
      "detail: detail_valid.get(i).copied().unwrap_or_default().then(|| detail.next().ok_or(tdbin::DecodeError::MalformedColumn)).transpose()?,"
    );
    expect(code).toContain("let mut kind = r.dense_group::<Kind>(at, 10, count)?.into_iter();");
    expect(code).toContain("let tags_counts = r.len_column(at, 11, count)?;");
    expect(code).toContain("let tags_total = tdbin::column_total(&tags_counts)?;");
    expect(code).toContain("let mut tags = r.var_column(at, 12, 13, tags_total)?.into_strings()?.into_iter();");
    expect(code).toContain(
      "let tags_take = usize::try_from(tags_counts.get(i).copied().unwrap_or(0)).map_err(|_| tdbin::DecodeError::LimitExceeded)?;"
    );
    expect(code).toContain(
      "tags: (0..tags_take).map(|_| tags.next().ok_or(tdbin::DecodeError::MalformedColumn)).collect::<Result<Vec<_>, _>>()?,"
    );
    // Transitively reached groups: Detail via Option<record> + union payload,
    // Extra via the second union payload ([TDBIN-COL-PLAN] closure).
    expect(code).toContain("impl tdbin::ColumnGroup for Detail {\n    const COLUMNS: u16 = 3;");
    expect(code).toContain("impl tdbin::ColumnGroup for Extra {\n    const COLUMNS: u16 = 1;");
    // Union group ([TDBIN-COL-UNION]): tag byte column at slot 0, dense
    // payload groups at slots 1 and 2, bare variants contribute nothing.
    expect(code).toContain("impl tdbin::ColumnGroup for Kind {\n    const COLUMNS: u16 = 3;");
    expect(code).toContain(
      [
        "        w.byte_column(at, 1, 0, count, items.clone().map(|row| match row {",
        "            Self::Basic(_) => 0_u8,",
        "            Self::Extended(_) => 1_u8,",
        "            Self::Bare => 2_u8,",
        "        }))?;",
      ].join("\n")
    );
    // Dense union payloads partition ONCE into ref vectors (no per-column
    // re-scan of the full item list, no separate matches! counting pass).
    expect(code).toContain(
      [
        "        let basic: Vec<&Detail> = items.clone().filter_map(|row| match row {",
        "            Self::Basic(payload) => Some(payload),",
        "            Self::Extended(_) | Self::Bare => None,",
        "        }).collect();",
        "        w.dense_group(at, 1, 1, basic.len(), basic.iter().copied())?;",
      ].join("\n")
    );
    expect(code).not.toContain("matches!(row, Self::Basic(_))");
    expect(code).toContain("let tags = r.byte_column(at, 0, count)?;");
    // Tag histograms sum bit-matches instead of the naive bytecount pattern.
    expect(code).toContain("let basic_count = tags.iter().map(|tag| usize::from(*tag == 0)).sum::<usize>();");
    expect(code).toContain("let extended_count = tags.iter().map(|tag| usize::from(*tag == 1)).sum::<usize>();");
    expect(code).not.toContain(".filter(|tag| **tag == 0).count()");
    expect(code).toContain("let mut basic = r.dense_group::<Detail>(at, 1, basic_count)?.into_iter();");
    expect(code).toContain("let mut extended = r.dense_group::<Extra>(at, 2, extended_count)?.into_iter();");
    expect(code).toContain("0 => Self::Basic(basic.next().ok_or(tdbin::DecodeError::MalformedColumn)?),");
    expect(code).toContain("2 => Self::Bare,");
    // Columnar unknown tags fail typed WITHOUT re-verifying slots (every
    // column was already visited by the reads above the tag loop).
    expect(code).toContain(
      [
        "                ordinal => {",
        "                    return Err(tdbin::DecodeError::UnknownVariant { ordinal: u64::from(ordinal) });",
        "                }",
      ].join("\n")
    );
    // The row-wise Struct impls still carry the slot-verifying fallback.
    expect(code).toContain("r.verify_struct_slots(at)?;");
  });

  it("emits semantic, optional-scalar, nested-scalar, nested-group, and string-payload union columns", () => {
    const code = unwrap(
      emitRustCodec(
        modelFor(
          `type Item {\n  sku: String\n}\nunion Note {\n  Text(String)\n  Zero\n}\ntype Sensor {\n  raw: Bytes\n  seen: DateTime\n  id: Uuid\n  amount: Decimal\n  on: Option<Bool>\n  hits: Option<Int>\n  ratio: Option<Float>\n  expires: Option<DateTime>\n  thumb: Option<Bytes>\n  item: Item\n  note: Note\n  bits: List<Bool>\n  nums: List<Int>\n  vals: List<Float>\n  stamps: List<DateTime>\n  ids: List<Uuid>\n  amounts: List<Decimal>\n  blobs: List<Bytes>\n  parts: List<Item>\n}\ntype Net {\n  sensors: List<Sensor>\n}`
        ),
        { layout: 2 }
      )
    );
    expect(code).toContain("impl tdbin::ColumnGroup for Sensor {\n    const COLUMNS: u16 = 35;");
    // Bytes var column and Option<Bytes> with zero-length absent lanes.
    expect(code).toContain("w.var_column(at, 1, 0, 1, count, items.clone().map(|row| row.raw.as_slice()))?;");
    expect(code).toContain("let mut raw = r.var_column(at, 0, 1, count)?.into_byte_vecs()?.into_iter();");
    expect(code).toContain(
      "w.var_column(at, 1, 14, 15, count, items.clone().map(|row| row.thumb.as_deref().unwrap_or_default()))?;"
    );
    expect(code).toContain("let thumb_values = r.var_column(at, 14, 15, count)?.into_byte_vecs()?;");
    // DateTime: i64 micros column, per-row checked conversion.
    expect(code).toContain("w.i64_column(at, 1, 2, count, items.clone().map(|row| row.seen.timestamp_micros()))?;");
    expect(code).toContain(
      "seen: chrono::DateTime::<chrono::Utc>::from_timestamp_micros(seen.get(i).copied().unwrap_or_default()).ok_or(tdbin::DecodeError::LimitExceeded)?,"
    );
    // Uuid/Decimal: 16-byte columns converted per row.
    expect(code).toContain(
      "w.bytes16_column(at, 1, 3, count, items.clone().map(|row| tdbin::scalar::bytes16_words(row.id.as_bytes())))?;"
    );
    expect(code).toContain(
      "let id = r.bytes16_column(at, 3, count)?.into_iter().map(|(lo, hi)| uuid::Uuid::from_bytes(tdbin::scalar::bytes16_from_words(lo, hi))).collect::<Vec<_>>();"
    );
    expect(code).toContain(
      "w.bytes16_column(at, 1, 4, count, items.clone().map(|row| tdbin::scalar::bytes16_words(&row.amount.serialize())))?;"
    );
    expect(code).toContain("rust_decimal::Decimal::deserialize(tdbin::scalar::bytes16_from_words(lo, hi))");
    // Option<scalar>: validity bits plus zero-laned value columns.
    expect(code).toContain("w.bit_column(at, 1, 6, count, items.clone().map(|row| row.on.unwrap_or_default()))?;");
    expect(code).toContain("w.i64_column(at, 1, 8, count, items.clone().map(|row| row.hits.unwrap_or_default()))?;");
    expect(code).toContain("w.f64_column(at, 1, 10, count, items.clone().map(|row| row.ratio.unwrap_or_default()))?;");
    expect(code).toContain(
      "let mut hits = hits_valid.into_iter().zip(hits_values).map(|(valid, value)| valid.then_some(value));"
    );
    // Option<DateTime>: absent lanes write zero micros, present lanes convert.
    expect(code).toContain(
      "w.i64_column(at, 1, 12, count, items.clone().map(|row| row.expires.map_or(0, |value| value.timestamp_micros())))?;"
    );
    expect(code).toContain(
      "let expires_rows = expires_valid.into_iter().zip(expires_values).map(|(valid, value)| valid.then(|| chrono::DateTime::<chrono::Utc>::from_timestamp_micros(value).ok_or(tdbin::DecodeError::LimitExceeded)).transpose()).collect::<Result<Vec<_>, _>>()?;"
    );
    // Required record and union fields: full-count dense groups.
    expect(code).toContain("w.dense_group(at, 1, 16, count, items.clone().map(|row| &row.item))?;");
    expect(code).toContain("w.dense_group(at, 1, 17, count, items.clone().map(|row| &row.note))?;");
    // Nested scalar lists: u32 counts then one flat value column each.
    expect(code).toContain(
      "w.bit_column(at, 1, 19, bits_total, items.clone().flat_map(|row| row.bits.iter()).copied())?;"
    );
    expect(code).toContain("let mut bits = r.bit_column(at, 19, bits_total)?.into_iter();");
    expect(code).toContain(
      "w.i64_block_column(at, 1, 21, nums_total, items.clone().flat_map(|row| row.nums.iter()).copied())?;"
    );
    expect(code).toContain(
      "w.f64_column(at, 1, 23, vals_total, items.clone().flat_map(|row| row.vals.iter()).copied())?;"
    );
    expect(code).toContain(
      "w.i64_column(at, 1, 25, stamps_total, items.clone().flat_map(|row| row.stamps.iter()).map(chrono::DateTime::timestamp_micros))?;"
    );
    expect(code).toContain(
      "let stamps_flat = r.i64_column(at, 25, stamps_total)?.into_iter().map(|value| chrono::DateTime::<chrono::Utc>::from_timestamp_micros(value).ok_or(tdbin::DecodeError::LimitExceeded)).collect::<Result<Vec<_>, _>>()?;"
    );
    expect(code).toContain(
      "w.bytes16_column(at, 1, 27, ids_total, items.clone().flat_map(|row| row.ids.iter()).map(|value| tdbin::scalar::bytes16_words(value.as_bytes())))?;"
    );
    expect(code).toContain(
      "let ids_flat = r.bytes16_column(at, 27, ids_total)?.into_iter().map(|(lo, hi)| uuid::Uuid::from_bytes(tdbin::scalar::bytes16_from_words(lo, hi))).collect::<Vec<_>>();"
    );
    expect(code).toContain(
      "w.bytes16_column(at, 1, 29, amounts_total, items.clone().flat_map(|row| row.amounts.iter()).map(|value| tdbin::scalar::bytes16_words(&value.serialize())))?;"
    );
    // Nested Bytes list: var column over the flattened total.
    expect(code).toContain(
      "w.var_column(at, 1, 31, 32, blobs_total, items.clone().flat_map(|row| row.blobs.iter()).map(Vec::as_slice))?;"
    );
    expect(code).toContain("let mut blobs = r.var_column(at, 31, 32, blobs_total)?.into_byte_vecs()?.into_iter();");
    // Nested record list: dense group over the flattened total.
    expect(code).toContain("w.dense_group(at, 1, 34, parts_total, items.clone().flat_map(|row| row.parts.iter()))?;");
    expect(code).toContain("let mut parts = r.dense_group::<Item>(at, 34, parts_total)?.into_iter();");
    // String-payload union variant: a dense var column pair ([TDBIN-COL-UNION]).
    expect(code).toContain("impl tdbin::ColumnGroup for Note {\n    const COLUMNS: u16 = 3;");
    expect(code).toContain(
      [
        "        let text: Vec<&String> = items.clone().filter_map(|row| match row {",
        "            Self::Text(payload) => Some(payload),",
        "            Self::Zero => None,",
        "        }).collect();",
        "        w.var_column(at, 1, 1, 2, text.len(), text.iter().copied().map(String::as_bytes))?;",
      ].join("\n")
    );
    expect(code).toContain("let text_count = tags.iter().map(|tag| usize::from(*tag == 0)).sum::<usize>();");
    expect(code).toContain("let mut text = r.var_column(at, 1, 2, text_count)?.into_strings()?.into_iter();");
    expect(code).toContain("0 => Self::Text(text.next().ok_or(tdbin::DecodeError::MalformedColumn)?),");
    expect(code).toContain("1 => Self::Zero,");
    // A group whose rows never index by position loops without a row index.
    expect(code).toContain("impl tdbin::ColumnGroup for Item {\n    const COLUMNS: u16 = 2;");
    expect(code).toContain("for _ in 0..count {");
  });

  it("rejects an empty record reached as a column group element", () => {
    const r = emitRustCodec(modelFor(`type Empty {\n}\ntype Row {\n  e: Empty\n}\ntype B {\n  rows: List<Row>\n}`), {
      layout: 2,
    });
    expectErrorMessages(r, ["empty record 'Empty' cannot form a column group"]);
  });

  it("defaults to layout 1 and keeps row-wise forms when no options are passed", () => {
    const code = unwrap(emitRustCodec(modelFor(BATCH_TD)));
    expect(code).toContain("w.child_list(at, Self::DATA_WORDS, 0, Some(&self.rows))?;");
    expect(code).toContain("w.string_list(at, Self::DATA_WORDS, 1, Some(&self.labels))?;");
    expect(code).not.toContain("column_list");
    expect(code).not.toContain("ColumnGroup");
    expect(code).not.toContain("var_column");
  });

  it("keeps enum-union lists on the layout-1 byte-list form at layout 2", () => {
    const code = unwrap(
      emitRustCodec(modelFor(`union Color {\n  Red\n  Green\n}\ntype Palette {\n  colors: List<Color>\n}`), {
        layout: 2,
      })
    );
    expect(code).toContain("w.byte_list(at, Self::DATA_WORDS, 0, Some(&colors_ordinals))?;");
    expect(code).not.toContain("ColumnGroup");
  });

  it("rejects Option<List<String>> and Option<List<Bytes>> fields at layout 2 with loud diagnostics", () => {
    const strings = emitRustCodec(modelFor(`type R {\n  x: Option<List<String>>\n}`), { layout: 2 });
    expectErrorMessages(strings, ["Option<List<String>> has no columnar encoding under layout 2", "R.x"]);
    const bytes = emitRustCodec(modelFor(`type R {\n  x: Option<List<Bytes>>\n}`), { layout: 2 });
    expectErrorMessages(bytes, ["Option<List<Bytes>> has no columnar encoding under layout 2"]);
  });

  it("rejects unsupported shapes inside a column group with loud diagnostics naming the type", () => {
    const optList = emitRustCodec(modelFor(`type Row {\n  x: Option<List<Int>>\n}\ntype B {\n  rows: List<Row>\n}`), {
      layout: 2,
    });
    expectErrorMessages(optList, ["'Option<List<Int>>' has no columnar encoding under layout 2 in Row.x"]);
  });

  it("rejects a union with more than 256 variants reached by a columnar list", () => {
    const variants = ["  V0(P)", ...Array.from({ length: 256 }, (_, i) => `  V${String(i + 1)}`)].join("\n");
    const r = emitRustCodec(
      modelFor(`type P {\n  v: Int\n}\nunion Wide {\n${variants}\n}\ntype H {\n  items: List<Wide>\n}`),
      { layout: 2 }
    );
    expectErrorMessages(r, ["union 'Wide' exceeds 256 variants, so layout 2 cannot encode its tag column"]);
  });
});

describe("[CONV-RUST-TDBIN] layout manifests and LAYOUT_HASH ([TDBIN-SCHEMA-HASH], [TDBIN-SCHEMA-CANON])", () => {
  const declOf = (model: Model, name: string) => {
    const decl = model.decls.find((candidate) => candidate.name === name);
    if (decl === undefined) {
      throw new Error(`missing decl '${name}' in test model`);
    }
    return decl;
  };

  // PINNED manifest + hash #1: layout 1, 1-bit option presence. Any change to
  // this string or hash is a WIRE-COMPATIBILITY break ([TDBIN-EVOLVE-BREAKING]).
  const MEASUREMENT_MANIFEST =
    "tdbin-layout v1 major=1\n" +
    "0:record d=3 p=1 [str@p0;opt(bit@w0.0,i64@w1);opt(bit@w0.1,bit@w0.2);opt(bit@w0.3,f64@w2)]";
  const MEASUREMENT_HASH = "0x838e_d60c_b04f_c0b0";

  // PINNED manifest + hash #2: layout 2 with column plans and DFS-numbered refs.
  const PERSON_BATCH_MANIFEST =
    "tdbin-layout v1 major=2\n" +
    "0:record d=0 p=1 [col(ref1)@p0]\n" +
    "1:record d=3 p=4 [str@p0;i64@w0;bit@w1.0;f64@w2;ref2?@p1;str?@p2;ref3@p3]" +
    " cols[var@c0;i64b@c2;bit@c3;f64@c4;optgrp(ref2)@c5;optvar@c7;grp(ref3)@c10]\n" +
    "2:record d=1 p=1 [str@p0;i64@w0] cols[var@c0;i64b@c2]\n" +
    "3:union d=1 p=1 [ref4@p0;ref5@p0] cols[tag@c0;grp(ref4)@c1;grp(ref5)@c2]\n" +
    "4:record d=0 p=1 [str@p0] cols[var@c0]\n" +
    "5:record d=2 p=0 [i64@w0;i64@w1] cols[i64b@c0;i64b@c1]";
  const PERSON_BATCH_HASH = "0x364e_f899_d44b_54ec";

  it("renders canonical wire-facts manifests and pins their FNV-1a 64 hashes", () => {
    const measurementModel = modelFor(MEASUREMENT_TD);
    const manifest = unwrap(layoutManifest(measurementModel.decls, declOf(measurementModel, "Measurement"), 1));
    expect(manifest).toBe(MEASUREMENT_MANIFEST);
    expect(layoutHashLiteral(fnv1a64(manifest))).toBe(MEASUREMENT_HASH);
    const batchesModel = modelFor(fixtureTd("batches.td"));
    const batchManifest = unwrap(layoutManifest(batchesModel.decls, declOf(batchesModel, "PersonBatch"), 2));
    expect(batchManifest).toBe(PERSON_BATCH_MANIFEST);
    expect(layoutHashLiteral(fnv1a64(batchManifest))).toBe(PERSON_BATCH_HASH);
    // The FNV-1a 64 parameters themselves (offset 0xcbf29ce484222325, prime
    // 0x100000001b3) are pinned by the empty- and one-byte-string vectors.
    expect(fnv1a64("")).toBe(0xcbf29ce484222325n);
    expect(fnv1a64("a")).toBe(0xaf63dc4c8601ec8cn);
  });

  it("bakes each type's manifest hash into its generated impl as LAYOUT_HASH", () => {
    const code = codecFor(MEASUREMENT_TD);
    expect(code).toContain(`    const LAYOUT_HASH: u64 = ${MEASUREMENT_HASH};`);
    const personModel = modelFor(PERSON_TD);
    const personHash = layoutHashLiteral(
      fnv1a64(unwrap(layoutManifest(personModel.decls, declOf(personModel, "Person"), 1)))
    );
    const contactHash = layoutHashLiteral(
      fnv1a64(unwrap(layoutManifest(personModel.decls, declOf(personModel, "Contact"), 1)))
    );
    const personCode = codecFor(PERSON_TD);
    expect(personCode).toContain(`const LAYOUT_HASH: u64 = ${personHash};`);
    expect(personCode).toContain(`const LAYOUT_HASH: u64 = ${contactHash};`);
    // Every generated impl pins a hash; the reserved unpinned value 0 and the
    // hand-written-tooling default never appear.
    expect(personCode).not.toContain("LAYOUT_HASH: u64 = 0;");
    const impls = personCode.match(/impl tdbin::Struct for /g) ?? [];
    const hashes = personCode.match(/const LAYOUT_HASH: u64 = 0x[0-9a-f_]{19};/g) ?? [];
    expect(hashes.length).toBe(impls.length);
  });

  it("hashes the frozen manifest instead when republishing append-compatibly", () => {
    const frozen = "tdbin-layout v1 major=1\n0:record d=3 p=1 [str@p0;opt(bit@w0.0,i64@w1)]";
    const frozenHash = layoutHashLiteral(fnv1a64(frozen));
    const code = unwrap(emitRustCodec(modelFor(PERSON_TD), { frozenManifest: frozen }));
    const hashes = code.match(/const LAYOUT_HASH: u64 = (0x[0-9a-f_]{19});/g) ?? [];
    expect(hashes.length).toBeGreaterThan(0);
    for (const line of hashes) {
      expect(line).toBe(`const LAYOUT_HASH: u64 = ${frozenHash};`);
    }
    // Freezing must change nothing else about the emission.
    const fresh = unwrap(emitRustCodec(modelFor(PERSON_TD)));
    expect(code.replace(/const LAYOUT_HASH: u64 = 0x[0-9a-f_]{19};/g, "HASH")).toBe(
      fresh.replace(/const LAYOUT_HASH: u64 = 0x[0-9a-f_]{19};/g, "HASH")
    );
  });
});

describe("[CONV-RUST-TDBIN] drift guard vs the committed crate fixtures", () => {
  it("reproduces generated/mod.rs (Person fixture)", () => {
    expectRustModuleReproduces(PERSON_TD, "../../../../crates/tdbin/tests/generated/mod.rs");
  });

  it("reproduces generated_opt/mod.rs (Option<scalar> Measurement fixture)", () => {
    expectRustModuleReproduces(MEASUREMENT_TD, "../../../../crates/tdbin/tests/generated_opt/mod.rs");
  });
});
