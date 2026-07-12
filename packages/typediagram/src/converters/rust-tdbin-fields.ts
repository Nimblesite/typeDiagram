// [CONV-RUST-TDBIN] Row-wise emission for the TDBIN Rust codec: per-field
// write/read statements plus the `impl tdbin::Struct` and `impl Default`
// assembly for records and unions ([TDBIN-REC-ALLOC], [TDBIN-UNION-DISC]).
// Null pointers in required slots decode to the schema default
// ([TDBIN-PTR-NULL], [TDBIN-REC-SHORT]); unknown discriminants verify the
// remaining slots before failing typed ([TDBIN-UNION-UNKNOWN]).
import type { Diagnostic } from "../parser/diagnostics.js";
import type { ResolvedRecord, ResolvedUnion } from "../model/types.js";
import { err, ok, type Result } from "../result.js";
import {
  type Bytes16Semantic,
  diag,
  type FieldPlan,
  type ListPlan,
  type RecordPlan,
  rsNumber,
  type UnionPlan,
} from "./rust-tdbin-plan.js";

export const bytes16Source = (semantic: Bytes16Semantic, value: string): string =>
  semantic === "Uuid" ? `${value}.as_bytes()` : `&${value}.serialize()`;

export const bytes16Value = (semantic: Bytes16Semantic, words: string): string =>
  semantic === "Uuid" ? `uuid::Uuid::from_bytes(${words})` : `rust_decimal::Decimal::deserialize(${words})`;

export const dateTimeResult = (word: string): string =>
  `chrono::DateTime::<chrono::Utc>::from_timestamp_micros(${word}).ok_or(tdbin::DecodeError::LimitExceeded)`;

const dateTimeFromBits = (word: string): string => dateTimeResult(`tdbin::scalar::i64_from(${word})`);

const listSource = (self: string, optional: boolean): string => (optional ? `${self}.as_deref()` : `Some(&${self})`);

const collectWordList = (source: string, map: string): string => `${source}.iter().map(${map}).collect::<Vec<_>>()`;

const writeDateTimeList = (name: string, self: string, slot: number, optional: boolean): string => {
  const words = `${name}_words`;
  const map = "|value| tdbin::scalar::i64_bits(value.timestamp_micros())";
  const init = optional
    ? `        let ${words} = ${self}.as_ref().map(|values| ${collectWordList("values", map)});`
    : `        let ${words} = ${collectWordList(self, map)};`;
  return [
    init,
    `        w.word_list(at, Self::DATA_WORDS, ${rsNumber(slot)}, ${optional ? `${words}.as_deref()` : `Some(&${words})`})?;`,
  ].join("\n");
};

const writeBytes16List = (
  name: string,
  self: string,
  p: Extract<ListPlan, { kind: "bytes16" }>,
  slot: number,
  optional: boolean
): string => {
  const words = `${name}_words`;
  const map = `|value| tdbin::scalar::bytes16_words(${bytes16Source(p.semantic, "value")})`;
  const init = optional
    ? `        let ${words} = ${self}.as_ref().map(|values| ${collectWordList("values", map)});`
    : `        let ${words} = ${collectWordList(self, map)};`;
  return [
    init,
    `        w.bytes16_list(at, Self::DATA_WORDS, ${rsNumber(slot)}, ${optional ? `${words}.as_deref()` : `Some(&${words})`})?;`,
  ].join("\n");
};

const enumOrdinalArm = (rustType: string, name: string, ordinal: number): string =>
  `                &${rustType}::${name} => ${rsNumber(ordinal)}u8,`;

const writeEnumList = (
  name: string,
  self: string,
  p: Extract<ListPlan, { kind: "enum" }>,
  slot: number,
  optional: boolean
): string => {
  const ordinals = `${name}_ordinals`;
  const arms = p.variants.map((variant, ordinal) => enumOrdinalArm(p.rustType, variant, ordinal)).join("\n");
  const collect = (source: string): string =>
    `${source}.iter().map(|value| match value {\n${arms}\n        }).collect::<Vec<_>>()`;
  const init = optional
    ? `        let ${ordinals} = ${self}.as_ref().map(|values| ${collect("values")});`
    : `        let ${ordinals} = ${collect(self)};`;
  return [
    init,
    `        w.byte_list(at, Self::DATA_WORDS, ${rsNumber(slot)}, ${optional ? `${ordinals}.as_deref()` : `Some(&${ordinals})`})?;`,
  ].join("\n");
};

const writeList = (name: string, p: Extract<FieldPlan, { kind: "list" }>): string => {
  const self = `self.${name}`;
  switch (p.list.kind) {
    case "bool":
      return `        w.bool_list(at, Self::DATA_WORDS, ${rsNumber(p.slot)}, ${listSource(self, p.optional)})?;`;
    case "flat":
      return `        w.${p.list.method}(at, Self::DATA_WORDS, ${rsNumber(p.slot)}, ${listSource(self, p.optional)})?;`;
    case "intBlock":
      return `        w.i64_block_list(at, Self::DATA_WORDS, ${rsNumber(p.slot)}, ${listSource(self, p.optional)})?;`;
    case "dateTime":
      return writeDateTimeList(name, self, p.slot, p.optional);
    case "bytes16":
      return writeBytes16List(name, self, p.list, p.slot, p.optional);
    case "string":
      return `        w.string_list(at, Self::DATA_WORDS, ${rsNumber(p.slot)}, ${listSource(self, p.optional)})?;`;
    case "bytes":
      return `        w.bytes_list(at, Self::DATA_WORDS, ${rsNumber(p.slot)}, ${listSource(self, p.optional)})?;`;
    case "child":
      return `        w.child_list(at, Self::DATA_WORDS, ${rsNumber(p.slot)}, ${listSource(self, p.optional)})?;`;
    case "enum":
      return writeEnumList(name, self, p.list, p.slot, p.optional);
  }
};

/** Presence is one bit in the shared bool bitset ([TDBIN-PRIM-OPTION]). */
const writePresenceBit = (p: { presenceSlot: number; presenceBit: number }, present: string): string =>
  `        w.bool_bit(at, ${rsNumber(p.presenceSlot)}, ${rsNumber(p.presenceBit)}, ${present})?;`;

const writeOptScalar = (name: string, p: Extract<FieldPlan, { kind: "optScalar" }>): string =>
  [
    writePresenceBit(p, `self.${name}.is_some()`),
    `        w.scalar(at, ${rsNumber(p.valueSlot)}, self.${name}.map_or(0, tdbin::scalar::${p.bits}))?;`,
  ].join("\n");

const writeOptBool = (name: string, p: Extract<FieldPlan, { kind: "optBool" }>): string =>
  [
    writePresenceBit(p, `self.${name}.is_some()`),
    `        w.bool_bit(at, ${rsNumber(p.valueSlot)}, ${rsNumber(p.valueBit)}, self.${name}.unwrap_or_default())?;`,
  ].join("\n");

const writeOptBytes16 = (name: string, p: Extract<FieldPlan, { kind: "optBytes16" }>): string =>
  [
    `        let ${name}_words = self.${name}.as_ref().map(|value| tdbin::scalar::bytes16_words(${bytes16Source(p.semantic, "value")}));`,
    writePresenceBit(p, `${name}_words.is_some()`),
    `        let (${name}_lo, ${name}_hi) = ${name}_words.unwrap_or((0, 0));`,
    `        w.scalar(at, ${rsNumber(p.valueSlot)}, ${name}_lo)?;`,
    `        w.scalar(at, ${rsNumber(p.valueSlot + 1)}, ${name}_hi)?;`,
  ].join("\n");

export const writeField = (name: string, p: FieldPlan): string => {
  const self = `self.${name}`;
  switch (p.kind) {
    case "scalar":
      return `        w.scalar(at, ${rsNumber(p.slot)}, tdbin::scalar::${p.bits}(${self}))?;`;
    case "boolBit":
      return `        w.bool_bit(at, ${rsNumber(p.slot)}, ${rsNumber(p.bit)}, ${self})?;`;
    case "dateTime":
      return `        w.scalar(at, ${rsNumber(p.slot)}, tdbin::scalar::i64_bits(${self}.timestamp_micros()))?;`;
    case "bytes16":
      return [
        `        let ${name}_words = tdbin::scalar::bytes16_words(${bytes16Source(p.semantic, self)});`,
        `        w.scalar(at, ${rsNumber(p.slot)}, ${name}_words.0)?;`,
        `        w.scalar(at, ${rsNumber(p.slot + 1)}, ${name}_words.1)?;`,
      ].join("\n");
    case "optScalar":
      return writeOptScalar(name, p);
    case "optBool":
      return writeOptBool(name, p);
    case "optDateTime":
      return [
        writePresenceBit(p, `${self}.is_some()`),
        `        w.scalar(at, ${rsNumber(p.valueSlot)}, ${self}.as_ref().map_or(0, |value| tdbin::scalar::i64_bits(value.timestamp_micros())))?;`,
      ].join("\n");
    case "optBytes16":
      return writeOptBytes16(name, p);
    case "string":
      return `        w.string(at, Self::DATA_WORDS, ${rsNumber(p.slot)}, ${p.optional ? `${self}.as_deref()` : `Some(&${self})`})?;`;
    case "bytes":
      return `        w.bytes(at, Self::DATA_WORDS, ${rsNumber(p.slot)}, ${p.optional ? `${self}.as_deref()` : `Some(&${self})`})?;`;
    case "child":
      return `        w.child(at, Self::DATA_WORDS, ${rsNumber(p.slot)}, ${p.optional ? `${self}.as_ref()` : `Some(&${self})`})?;`;
    case "list":
      return writeList(name, p);
    case "columnList":
      return `        w.${p.optional ? "opt_column_list" : "column_list"}(at, Self::DATA_WORDS, ${rsNumber(p.slot)}, ${listSource(self, p.optional)})?;`;
    case "varList":
      return `        w.${p.variant === "string" ? "string_var_list" : "bytes_var_list"}(at, Self::DATA_WORDS, ${rsNumber(p.lenSlot)}, ${rsNumber(p.paySlot)}, Some(&${self}))?;`;
  }
};

/** Tail after a `Result<Option<_>, _>` reader: keep the `Option` when the field
 *  is optional, else apply the schema default ([TDBIN-PTR-NULL]). */
const readTail = (optional: boolean): string => (optional ? "?" : "?.unwrap_or_default()");

const readDateTimeList = (name: string, slot: number, optional: boolean): string => {
  const call = `r.word_list(at, Self::DATA_WORDS, ${rsNumber(slot)})?`;
  const collect = (source: string): string =>
    `${source}.into_iter().map(|word| ${dateTimeFromBits("word")}).collect::<Result<Vec<_>, _>>()?`;
  return optional
    ? [
        `        let ${name} = match ${call} {`,
        `            Some(values) => Some(${collect("values")}),`,
        `            None => None,`,
        `        };`,
      ].join("\n")
    : `        let ${name} = ${collect(`${call}.unwrap_or_default()`)};`;
};

const bytes16ListMap = (semantic: Bytes16Semantic): string =>
  `values.into_iter().map(|(lo, hi)| ${bytes16Value(semantic, "tdbin::scalar::bytes16_from_words(lo, hi)")}).collect::<Vec<_>>()`;

const readBytes16List = (
  name: string,
  p: Extract<ListPlan, { kind: "bytes16" }>,
  slot: number,
  optional: boolean
): string => {
  const call = `r.bytes16_list(at, Self::DATA_WORDS, ${rsNumber(slot)})?`;
  const map = bytes16ListMap(p.semantic);
  return optional
    ? `        let ${name} = ${call}.map(|values| ${map});`
    : `        let ${name} = ${call}.unwrap_or_default().into_iter().map(|(lo, hi)| ${bytes16Value(
        p.semantic,
        "tdbin::scalar::bytes16_from_words(lo, hi)"
      )}).collect::<Vec<_>>();`;
};

const enumDecodeArm = (rustType: string, name: string, ordinal: number): string =>
  `            ${rsNumber(ordinal)} => Ok(${rustType}::${name}),`;

const enumDecoder = (p: Extract<ListPlan, { kind: "enum" }>, source: string): string => {
  const arms = p.variants.map((variant, ordinal) => enumDecodeArm(p.rustType, variant, ordinal)).join("\n");
  return `${source}.into_iter().map(|ordinal| match ordinal {\n${arms}\n            ordinal => Err(tdbin::DecodeError::UnknownVariant { ordinal: u64::from(ordinal) }),\n        }).collect::<Result<Vec<_>, _>>()?`;
};

const readEnumList = (
  name: string,
  p: Extract<ListPlan, { kind: "enum" }>,
  slot: number,
  optional: boolean
): string => {
  const call = `r.byte_list(at, Self::DATA_WORDS, ${rsNumber(slot)})?`;
  return optional
    ? [
        `        let ${name} = match ${call} {`,
        `            Some(values) => Some(${enumDecoder(p, "values")}),`,
        `            None => None,`,
        `        };`,
      ].join("\n")
    : `        let ${name} = ${enumDecoder(p, `${call}.unwrap_or_default()`)};`;
};

const readList = (name: string, p: Extract<FieldPlan, { kind: "list" }>): string => {
  switch (p.list.kind) {
    case "bool":
      return `        let ${name} = r.bool_list(at, Self::DATA_WORDS, ${rsNumber(p.slot)})${readTail(p.optional)};`;
    case "flat":
      return `        let ${name} = r.${p.list.method}(at, Self::DATA_WORDS, ${rsNumber(p.slot)})${readTail(p.optional)};`;
    case "intBlock":
      return `        let ${name} = r.i64_block_list(at, Self::DATA_WORDS, ${rsNumber(p.slot)})${readTail(p.optional)};`;
    case "dateTime":
      return readDateTimeList(name, p.slot, p.optional);
    case "bytes16":
      return readBytes16List(name, p.list, p.slot, p.optional);
    case "string":
      return `        let ${name} = r.string_list(at, Self::DATA_WORDS, ${rsNumber(p.slot)})${readTail(p.optional)};`;
    case "bytes":
      return `        let ${name} = r.bytes_list(at, Self::DATA_WORDS, ${rsNumber(p.slot)})${readTail(p.optional)};`;
    case "child":
      return `        let ${name} = r.child_list::<${p.list.rustType}>(at, Self::DATA_WORDS, ${rsNumber(p.slot)})${readTail(p.optional)};`;
    case "enum":
      return readEnumList(name, p.list, p.slot, p.optional);
  }
};

const readPresenceBit = (name: string, p: { presenceSlot: number; presenceBit: number }): string =>
  `        let ${name}_present = r.bool_bit(at, ${rsNumber(p.presenceSlot)}, ${rsNumber(p.presenceBit)})?;`;

const readOptScalar = (name: string, p: Extract<FieldPlan, { kind: "optScalar" }>): string =>
  [
    readPresenceBit(name, p),
    `        let ${name}_value = tdbin::scalar::${p.from}(r.scalar(at, ${rsNumber(p.valueSlot)})?);`,
    `        let ${name} = ${name}_present.then_some(${name}_value);`,
  ].join("\n");

const readOptBool = (name: string, p: Extract<FieldPlan, { kind: "optBool" }>): string =>
  [
    readPresenceBit(name, p),
    `        let ${name}_value = r.bool_bit(at, ${rsNumber(p.valueSlot)}, ${rsNumber(p.valueBit)})?;`,
    `        let ${name} = ${name}_present.then_some(${name}_value);`,
  ].join("\n");

const readOptBytes16 = (name: string, p: Extract<FieldPlan, { kind: "optBytes16" }>): string =>
  [
    readPresenceBit(name, p),
    `        let ${name} = if ${name}_present {`,
    `            Some(${bytes16Value(p.semantic, `tdbin::scalar::bytes16_from_words(r.scalar(at, ${rsNumber(p.valueSlot)})?, r.scalar(at, ${rsNumber(p.valueSlot + 1)})?)`)})`,
    `        } else {`,
    `            None`,
    `        };`,
  ].join("\n");

const readVarList = (name: string, p: Extract<FieldPlan, { kind: "varList" }>): string =>
  [
    `        let ${name} = match r.var_list(at, Self::DATA_WORDS, ${rsNumber(p.lenSlot)}, ${rsNumber(p.paySlot)})? {`,
    `            Some(column) => column.${p.variant === "string" ? "into_strings" : "into_byte_vecs"}()?,`,
    `            None => Vec::new(),`,
    `        };`,
  ].join("\n");

export const readField = (name: string, p: FieldPlan): string => {
  switch (p.kind) {
    case "scalar":
      return `        let ${name} = tdbin::scalar::${p.from}(r.scalar(at, ${rsNumber(p.slot)})?);`;
    case "boolBit":
      return `        let ${name} = r.bool_bit(at, ${rsNumber(p.slot)}, ${rsNumber(p.bit)})?;`;
    case "dateTime":
      return `        let ${name} = ${dateTimeFromBits(`r.scalar(at, ${rsNumber(p.slot)})?`)}?;`;
    case "bytes16":
      return `        let ${name} = ${bytes16Value(p.semantic, `tdbin::scalar::bytes16_from_words(r.scalar(at, ${rsNumber(p.slot)})?, r.scalar(at, ${rsNumber(p.slot + 1)})?)`)};`;
    case "optScalar":
      return readOptScalar(name, p);
    case "optBool":
      return readOptBool(name, p);
    case "optDateTime":
      return [
        readPresenceBit(name, p),
        `        let ${name} = if ${name}_present { Some(${dateTimeFromBits(`r.scalar(at, ${rsNumber(p.valueSlot)})?`)}?) } else { None };`,
      ].join("\n");
    case "optBytes16":
      return readOptBytes16(name, p);
    case "string":
      return `        let ${name} = r.string(at, Self::DATA_WORDS, ${rsNumber(p.slot)})${readTail(p.optional)};`;
    case "bytes":
      return `        let ${name} = r.bytes(at, Self::DATA_WORDS, ${rsNumber(p.slot)})${readTail(p.optional)};`;
    case "child":
      return `        let ${name} = r.child::<${p.rustType}>(at, Self::DATA_WORDS, ${rsNumber(p.slot)})${readTail(p.optional)};`;
    case "list":
      return readList(name, p);
    case "columnList":
      return `        let ${name} = r.column_list::<${p.rustType}>(at, Self::DATA_WORDS, ${rsNumber(p.slot)})${readTail(p.optional)};`;
    case "varList":
      return readVarList(name, p);
  }
};

export const emitRecordCodec = (rec: ResolvedRecord, plan: RecordPlan, layoutHash: string): string =>
  [
    `impl tdbin::Struct for ${rec.name} {`,
    `    const DATA_WORDS: u16 = ${rsNumber(plan.dataWords)};`,
    `    const PTR_WORDS: u16 = ${rsNumber(plan.ptrWords)};`,
    `    const LAYOUT_HASH: u64 = ${layoutHash};`,
    ``,
    `    fn write_struct(&self, w: &mut tdbin::Writer, at: usize) -> Result<(), tdbin::EncodeError> {`,
    ...plan.fields.map((f) => writeField(f.name, f.plan)),
    `        Ok(())`,
    `    }`,
    ``,
    `    fn read_struct(r: &tdbin::Reader<'_>, at: usize) -> Result<Self, tdbin::DecodeError> {`,
    ...plan.fields.map((f) => readField(f.name, f.plan)),
    `        Ok(Self { ${plan.fields.map((f) => f.name).join(", ")} })`,
    `    }`,
    `}`,
  ].join("\n");

// Variants are constructed inside `impl tdbin::Struct for <union>`, so they are
// spelled `Self::Variant` (clippy `use_self`, denied under pedantic).
const writeVariantArm = (v: UnionPlan["variants"][number]): string => {
  const head = `            Self::${v.name}`;
  if (v.payload === null) {
    return `${head} => {\n                w.scalar(at, 0, ${rsNumber(v.ordinal)})?;\n                Ok(())\n            }`;
  }
  const call =
    v.payload.kind === "child"
      ? `w.child(at, Self::DATA_WORDS, 0, Some(payload))`
      : `w.string(at, Self::DATA_WORDS, 0, Some(payload))`;
  return `${head}(payload) => {\n                w.scalar(at, 0, ${rsNumber(v.ordinal)})?;\n                ${call}\n            }`;
};

const readVariantArm = (v: UnionPlan["variants"][number]): string => {
  if (v.payload === null) {
    return `            ${rsNumber(v.ordinal)} => {
                r.require_null_pointer(at, 0)?;
                Ok(Self::${v.name})
            },`;
  }
  const read =
    v.payload.kind === "child"
      ? `r.child::<${v.payload.rustType}>(at, Self::DATA_WORDS, 0)?.unwrap_or_default()`
      : `r.string(at, Self::DATA_WORDS, 0)?.unwrap_or_default()`;
  return `            ${rsNumber(v.ordinal)} => Ok(Self::${v.name}(${read})),`;
};

/** The unknown-discriminant fallback: verify the remaining pointer slots so the
 *  message is still fully structure-checked, then fail typed
 *  ([TDBIN-UNION-UNKNOWN], [TDBIN-SAFE-ZEROSLOT]). */
const unknownVariantArm = (): string[] => [
  `            ordinal => {`,
  `                r.verify_struct_slots(at)?;`,
  `                Err(tdbin::DecodeError::UnknownVariant { ordinal })`,
  `            }`,
];

export const emitUnionCodec = (u: ResolvedUnion, plan: UnionPlan, layoutHash: string): string =>
  [
    `impl tdbin::Struct for ${u.name} {`,
    `    const DATA_WORDS: u16 = 1;`,
    `    const PTR_WORDS: u16 = ${rsNumber(plan.ptrWords)};`,
    `    const LAYOUT_HASH: u64 = ${layoutHash};`,
    ``,
    `    fn write_struct(&self, w: &mut tdbin::Writer, at: usize) -> Result<(), tdbin::EncodeError> {`,
    `        match self {`,
    ...plan.variants.map(writeVariantArm),
    `        }`,
    `    }`,
    ``,
    `    fn read_struct(r: &tdbin::Reader<'_>, at: usize) -> Result<Self, tdbin::DecodeError> {`,
    `        match r.scalar(at, 0)? {`,
    ...plan.variants.map(readVariantArm),
    ...unknownVariantArm(),
    `        }`,
    `    }`,
    `}`,
  ].join("\n");

const defaultVariant = (v: UnionPlan["variants"][number]): string =>
  v.payload === null
    ? `Self::${v.name}`
    : v.payload.kind === "child"
      ? `Self::${v.name}(${v.payload.rustType}::default())`
      : `Self::${v.name}(String::default())`;

/** Unions default to their FIRST variant so required union fields can decode a
 *  null pointer as the schema default ([TDBIN-PTR-NULL], [TDBIN-REC-SHORT]). */
export const emitUnionDefault = (u: ResolvedUnion, plan: UnionPlan): Result<string, Diagnostic[]> => {
  const first = plan.variants[0];
  if (first === undefined) {
    return err(diag(`tdbin: union '${u.name}' has no variants, so no schema default exists`));
  }
  return ok(
    [
      `impl Default for ${u.name} {`,
      `    fn default() -> Self {`,
      `        ${defaultVariant(first)}`,
      `    }`,
      `}`,
    ].join("\n")
  );
};
