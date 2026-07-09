// [CONV-RUST-TDBIN] Generate the TDBIN binary codec (`impl tdbin::Struct`) for
// typeDiagram records and unions. This is the serialization half of the
// "typeDiagram ADT <-> binary" code generator: rust.ts emits the ADT types,
// this emits their codec. The reflective schema model is NOT involved — the
// layout is baked into the generated impl at generation time ([TDBIN-REC-ALLOC],
// [TDBIN-UNION-DISC]).
import type { Diagnostic } from "../parser/diagnostics.js";
import {
  isTupleVariantFields,
  type Model,
  type ResolvedDecl,
  type ResolvedRecord,
  type ResolvedTypeRef,
  type ResolvedUnion,
  type ResolvedVariant,
  visibleDeclsForTarget,
} from "../model/types.js";
import { printTypeRef } from "./parse-typeref.js";
import { emitRustDecl, mapTdToRs } from "./rust.js";
import { err, ok, type Result } from "../result.js";

/** Scalars stored as one word in the data section, with their codec fns. */
const SCALARS: Record<string, { bits: string; from: string }> = {
  Bool: { bits: "bool_bits", from: "bool_from" },
  Int: { bits: "i64_bits", from: "i64_from" },
  Float: { bits: "f64_bits", from: "f64_from" },
};

/** How a record field is laid out on the wire. */
type FieldPlan =
  | { kind: "scalar"; slot: number; bits: string; from: string }
  | { kind: "boolBit"; slot: number; bit: number }
  | { kind: "dateTime"; slot: number }
  | { kind: "bytes16"; slot: number; semantic: Bytes16Semantic }
  | { kind: "optScalar"; presenceSlot: number; valueSlot: number; bits: string; from: string }
  | { kind: "optDateTime"; presenceSlot: number; valueSlot: number }
  | { kind: "optBytes16"; presenceSlot: number; valueSlot: number; semantic: Bytes16Semantic }
  | { kind: "string"; slot: number; optional: boolean }
  | { kind: "bytes"; slot: number; optional: boolean }
  | { kind: "child"; slot: number; optional: boolean; rustType: string }
  | { kind: "list"; slot: number; optional: boolean; list: ListPlan };

type ListPlan =
  | { kind: "bool" }
  | { kind: "word"; bits: string; from: string }
  | { kind: "dateTime" }
  | { kind: "bytes16"; semantic: Bytes16Semantic }
  | { kind: "string" }
  | { kind: "bytes" }
  | { kind: "child"; rustType: string }
  | { kind: "enum"; rustType: string; variants: string[] };

type FieldError = { error: string };
type SemanticScalar = "DateTime" | "Uuid" | "Decimal";
type Bytes16Semantic = "Uuid" | "Decimal";

/** A fully-classified record: section sizes plus per-field placement. */
interface RecordPlan {
  dataWords: number;
  ptrWords: number;
  fields: Array<{ name: string; plan: FieldPlan }>;
}

/** A union variant's payload placement (all share pointer slot 0). */
type VariantPlan = null | { kind: "child"; rustType: string } | { kind: "string" };

/** A fully-classified union. */
interface UnionPlan {
  ptrWords: number;
  variants: Array<{ name: string; ordinal: number; payload: VariantPlan }>;
}

interface LayoutCursor {
  dataSlot: number;
  ptrSlot: number;
  boolSlot: number | null;
  nextBoolBit: number;
}

const BOOL_BITS_PER_WORD = 64;

const diag = (message: string): Diagnostic[] => [{ severity: "error", message, line: 0, col: 0, length: 0 }];

const rsNumber = (value: number): string => String(value);

const isPrim = (t: ResolvedTypeRef, name: string): boolean =>
  t.name === name && t.resolution.kind === "primitive" && t.args.length === 0;

const isDeclared = (t: ResolvedTypeRef): boolean => t.resolution.kind === "declared";

const declaredRecord = (decls: readonly ResolvedDecl[], t: ResolvedTypeRef): ResolvedRecord | undefined => {
  if (t.resolution.kind !== "declared") {
    return undefined;
  }
  const { declName } = t.resolution;
  return decls.find((d): d is ResolvedRecord => d.kind === "record" && d.name === declName);
};

const declaredUnion = (decls: readonly ResolvedDecl[], t: ResolvedTypeRef): ResolvedUnion | undefined => {
  if (t.resolution.kind !== "declared") {
    return undefined;
  }
  const { declName } = t.resolution;
  return decls.find((d): d is ResolvedUnion => d.kind === "union" && d.name === declName);
};

const isFieldError = (placed: unknown): placed is FieldError =>
  typeof placed === "object" && placed !== null && "error" in placed;

const emptyRecordError = (t: ResolvedTypeRef): FieldError => ({
  error: `tdbin: empty-record pointer '${printTypeRef(t)}' has no non-null v0 marker`,
});

const listInnerOf = (t: ResolvedTypeRef): ResolvedTypeRef | undefined =>
  t.name === "List" && t.args.length === 1 ? t.args[0] : undefined;

/** Classify a pointer-typed inner (String/Bytes/declared) for `Option<T>`. */
const pointerInner = (
  decls: readonly ResolvedDecl[],
  t: ResolvedTypeRef,
  slot: number,
  optional: boolean
): FieldPlan | FieldError | null =>
  isPrim(t, "String")
    ? { kind: "string", slot, optional }
    : isPrim(t, "Bytes")
      ? { kind: "bytes", slot, optional }
      : isDeclared(t)
        ? (declaredRecord(decls, t)?.fields.length ?? 1) === 0
          ? emptyRecordError(t)
          : { kind: "child", slot, optional, rustType: mapTdToRs(t) }
        : null;

/** The one-word scalar codec for a bare primitive (Bool/Int/Float), else undefined. */
const scalarOf = (t: ResolvedTypeRef): { bits: string; from: string } | undefined =>
  t.args.length === 0 && t.resolution.kind === "primitive" ? SCALARS[t.name] : undefined;

const isSemanticName = (name: string): name is SemanticScalar =>
  name === "DateTime" || name === "Uuid" || name === "Decimal";

/** The semantic scalar codec for a bare primitive, else undefined. */
const semanticOf = (t: ResolvedTypeRef): SemanticScalar | undefined =>
  t.args.length === 0 && t.resolution.kind === "primitive" && isSemanticName(t.name) ? t.name : undefined;

/** Allocate a direct Bool into a reusable bitset word ([TDBIN-WIRE-WORD]). */
const allocateBool = (cursor: LayoutCursor): FieldPlan => {
  let slot = cursor.boolSlot;
  if (slot === null || cursor.nextBoolBit >= BOOL_BITS_PER_WORD) {
    slot = cursor.dataSlot;
    cursor.boolSlot = slot;
    cursor.dataSlot = cursor.dataSlot + 1;
    cursor.nextBoolBit = 0;
  }
  const bit = cursor.nextBoolBit;
  cursor.nextBoolBit = bit + 1;
  return { kind: "boolBit", slot, bit };
};

const allocateSemantic = (semantic: SemanticScalar, cursor: LayoutCursor): FieldPlan => {
  const slot = cursor.dataSlot;
  cursor.dataSlot = cursor.dataSlot + (semantic === "DateTime" ? 1 : 2);
  return semantic === "DateTime" ? { kind: "dateTime", slot } : { kind: "bytes16", slot, semantic };
};

const allocateOptSemantic = (semantic: SemanticScalar, cursor: LayoutCursor): FieldPlan => {
  const presenceSlot = cursor.dataSlot;
  const valueSlot = presenceSlot + 1;
  cursor.dataSlot = cursor.dataSlot + (semantic === "DateTime" ? 2 : 3);
  return semantic === "DateTime"
    ? { kind: "optDateTime", presenceSlot, valueSlot }
    : { kind: "optBytes16", presenceSlot, valueSlot, semantic };
};

/** Classify an `Option<T>` field: a scalar inner takes a presence slot + a value
 *  slot ([TDBIN-PRIM-OPTION], word-granular in v0 until bit-packing collapses the
 *  flag to 1 bit); a pointer inner takes one pointer slot with null = `None`. */
const optionEmptyRecordError = (outer: ResolvedTypeRef): FieldError => ({
  error: `tdbin: Option<empty-record> '${printTypeRef(outer)}' would alias the null pointer in v0`,
});

const BYTE_LIST_VARIANT_LIMIT = 256;

const enumListPlan = (u: ResolvedUnion, t: ResolvedTypeRef): ListPlan | FieldError | null => {
  if (!u.variants.every((v) => v.fields.length === 0)) {
    return null;
  }
  if (u.variants.length > BYTE_LIST_VARIANT_LIMIT) {
    return { error: `tdbin: List<enum> '${printTypeRef(t)}' has ordinals >= 256` };
  }
  return { kind: "enum", rustType: mapTdToRs(t), variants: u.variants.map((v) => v.name) };
};

const childListPlan = (decls: readonly ResolvedDecl[], t: ResolvedTypeRef): ListPlan | FieldError | null => {
  const rec = declaredRecord(decls, t);
  if (rec?.fields.length === 0) {
    return emptyRecordError(t);
  }
  if (rec !== undefined || declaredUnion(decls, t) !== undefined) {
    return { kind: "child", rustType: mapTdToRs(t) };
  }
  return null;
};

const listPlanFor = (decls: readonly ResolvedDecl[], inner: ResolvedTypeRef): ListPlan | FieldError | null => {
  const scalar = scalarOf(inner);
  const semantic = semanticOf(inner);
  const union = declaredUnion(decls, inner);
  const enumPlan = union === undefined ? null : enumListPlan(union, inner);
  if (isPrim(inner, "Bool")) {
    return { kind: "bool" };
  }
  if (scalar !== undefined) {
    return { kind: "word", bits: scalar.bits, from: scalar.from };
  }
  if (semantic === "DateTime") {
    return { kind: "dateTime" };
  }
  if (semantic === "Uuid" || semantic === "Decimal") {
    return { kind: "bytes16", semantic };
  }
  if (isPrim(inner, "String")) {
    return { kind: "string" };
  }
  if (isPrim(inner, "Bytes")) {
    return { kind: "bytes" };
  }
  if (isFieldError(enumPlan) || enumPlan !== null) {
    return enumPlan;
  }
  return childListPlan(decls, inner);
};

const classifyList = (
  decls: readonly ResolvedDecl[],
  outer: ResolvedTypeRef,
  inner: ResolvedTypeRef,
  slot: number,
  optional: boolean
): FieldPlan | FieldError | null => {
  const plan = listPlanFor(decls, inner);
  return plan === null || isFieldError(plan) ? plan : { kind: "list", slot, optional, list: plan };
};

const classifyOption = (
  decls: readonly ResolvedDecl[],
  outer: ResolvedTypeRef,
  inner: ResolvedTypeRef,
  cursor: LayoutCursor
): FieldPlan | FieldError | null => {
  const listInner = listInnerOf(inner);
  if (listInner !== undefined) {
    const plan = classifyList(decls, inner, listInner, cursor.ptrSlot, true);
    if (isFieldError(plan)) {
      return plan;
    }
    if (plan !== null) {
      cursor.ptrSlot = cursor.ptrSlot + 1;
    }
    return plan;
  }
  const innerSemantic = semanticOf(inner);
  if (innerSemantic !== undefined) {
    return allocateOptSemantic(innerSemantic, cursor);
  }
  const innerScalar = scalarOf(inner);
  if (innerScalar !== undefined) {
    const plan: FieldPlan = {
      kind: "optScalar",
      presenceSlot: cursor.dataSlot,
      valueSlot: cursor.dataSlot + 1,
      bits: innerScalar.bits,
      from: innerScalar.from,
    };
    cursor.dataSlot = cursor.dataSlot + 2;
    return plan;
  }
  if ((declaredRecord(decls, inner)?.fields.length ?? 1) === 0) {
    return optionEmptyRecordError(outer);
  }
  const plan = pointerInner(decls, inner, cursor.ptrSlot, true);
  if (isFieldError(plan)) {
    return plan;
  }
  if (plan !== null) {
    cursor.ptrSlot = cursor.ptrSlot + 1;
  }
  return plan;
};

/** Classify one record field into a scalar, `Option<scalar>`, or pointer plan. */
const classifyField = (
  decls: readonly ResolvedDecl[],
  t: ResolvedTypeRef,
  cursor: LayoutCursor
): FieldPlan | FieldError | null => {
  if (isPrim(t, "Bool")) {
    return allocateBool(cursor);
  }
  const semantic = semanticOf(t);
  if (semantic !== undefined) {
    return allocateSemantic(semantic, cursor);
  }
  const scalar = scalarOf(t);
  if (scalar !== undefined) {
    const slot = cursor.dataSlot;
    cursor.dataSlot = cursor.dataSlot + 1;
    return { kind: "scalar", slot, bits: scalar.bits, from: scalar.from };
  }
  const optionInner = t.name === "Option" && t.args.length === 1 ? t.args[0] : undefined;
  if (optionInner !== undefined) {
    return classifyOption(decls, t, optionInner, cursor);
  }
  const listInner = listInnerOf(t);
  if (listInner !== undefined) {
    const list = classifyList(decls, t, listInner, cursor.ptrSlot, false);
    if (isFieldError(list)) {
      return list;
    }
    if (list !== null) {
      cursor.ptrSlot = cursor.ptrSlot + 1;
    }
    return list;
  }
  const plan = pointerInner(decls, t, cursor.ptrSlot, false);
  if (isFieldError(plan)) {
    return plan;
  }
  if (plan !== null) {
    cursor.ptrSlot = cursor.ptrSlot + 1;
  }
  return plan;
};

const classifyRecord = (decls: readonly ResolvedDecl[], rec: ResolvedRecord): Result<RecordPlan, Diagnostic[]> => {
  const cursor: LayoutCursor = { dataSlot: 0, ptrSlot: 0, boolSlot: null, nextBoolBit: 0 };
  const fields: Array<{ name: string; plan: FieldPlan }> = [];
  for (const f of rec.fields) {
    const c = classifyField(decls, f.type, cursor);
    if (c === null) {
      return err(diag(`tdbin: unsupported field type '${printTypeRef(f.type)}' in ${rec.name}.${f.name}`));
    }
    if (isFieldError(c)) {
      return err(diag(`${c.error} in ${rec.name}.${f.name}`));
    }
    fields.push({ name: f.name, plan: c });
  }
  return ok({ dataWords: cursor.dataSlot, ptrWords: cursor.ptrSlot, fields });
};

const classifyVariant = (v: ResolvedVariant): Result<VariantPlan, Diagnostic[]> => {
  if (v.fields.length === 0) {
    return ok(null);
  }
  const single = v.fields.length === 1 && isTupleVariantFields(v.fields) ? v.fields[0]?.type : undefined;
  if (single === undefined) {
    return err(diag(`tdbin: variant '${v.name}' must be bare or a single tuple field in v0`));
  }
  return isDeclared(single)
    ? ok({ kind: "child", rustType: mapTdToRs(single) })
    : isPrim(single, "String")
      ? ok({ kind: "string" })
      : err(diag(`tdbin: variant '${v.name}' payload '${printTypeRef(single)}' unsupported in v0`));
};

const classifyUnion = (u: ResolvedUnion): Result<UnionPlan, Diagnostic[]> => {
  const variants: UnionPlan["variants"] = [];
  for (const [ordinal, v] of u.variants.entries()) {
    const payload = classifyVariant(v);
    if (!payload.ok) {
      return payload;
    }
    variants.push({ name: v.name, ordinal, payload: payload.value });
  }
  const ptrWords = variants.some((v) => v.payload !== null) ? 1 : 0;
  return ok({ ptrWords, variants });
};

// ── Emission ──

const bytes16Source = (semantic: Bytes16Semantic, value: string): string =>
  semantic === "Uuid" ? `${value}.as_bytes()` : `&${value}.serialize()`;

const bytes16Value = (semantic: Bytes16Semantic, words: string): string =>
  semantic === "Uuid" ? `uuid::Uuid::from_bytes(${words})` : `rust_decimal::Decimal::deserialize(${words})`;

const dateTimeResult = (word: string): string =>
  `chrono::DateTime::<chrono::Utc>::from_timestamp_micros(tdbin::scalar::i64_from(${word})).ok_or(tdbin::DecodeError::LimitExceeded)`;

const dateTimeValue = (word: string): string => `${dateTimeResult(word)}?`;

const listSource = (self: string, optional: boolean): string => (optional ? `${self}.as_deref()` : `Some(&${self})`);

const collectWordList = (source: string, map: string): string => `${source}.iter().map(${map}).collect::<Vec<_>>()`;

const writeWordList = (
  name: string,
  self: string,
  p: Extract<ListPlan, { kind: "word" }>,
  slot: number,
  optional: boolean
): string => {
  const words = `${name}_words`;
  const map = `|value| tdbin::scalar::${p.bits}(*value)`;
  const init = optional
    ? `        let ${words} = ${self}.as_ref().map(|values| ${collectWordList("values", map)});`
    : `        let ${words} = ${collectWordList(self, map)};`;
  return [
    init,
    `        w.word_list(at, Self::DATA_WORDS, ${rsNumber(slot)}, ${optional ? `${words}.as_deref()` : `Some(&${words})`})?;`,
  ].join("\n");
};

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
    case "word":
      return writeWordList(name, self, p.list, p.slot, p.optional);
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

const writeField = (name: string, p: FieldPlan): string => {
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
      return [
        `        w.scalar(at, ${rsNumber(p.presenceSlot)}, u64::from(${self}.is_some()))?;`,
        `        w.scalar(at, ${rsNumber(p.valueSlot)}, ${self}.map_or(0, tdbin::scalar::${p.bits}))?;`,
      ].join("\n");
    case "optDateTime":
      return [
        `        w.scalar(at, ${rsNumber(p.presenceSlot)}, u64::from(${self}.is_some()))?;`,
        `        w.scalar(at, ${rsNumber(p.valueSlot)}, ${self}.as_ref().map_or(0, |value| tdbin::scalar::i64_bits(value.timestamp_micros())))?;`,
      ].join("\n");
    case "optBytes16":
      return [
        `        let ${name}_words = ${self}.as_ref().map(|value| tdbin::scalar::bytes16_words(${bytes16Source(p.semantic, "value")}));`,
        `        w.scalar(at, ${rsNumber(p.presenceSlot)}, u64::from(${name}_words.is_some()))?;`,
        `        let (${name}_lo, ${name}_hi) = ${name}_words.unwrap_or((0, 0));`,
        `        w.scalar(at, ${rsNumber(p.valueSlot)}, ${name}_lo)?;`,
        `        w.scalar(at, ${rsNumber(p.valueSlot + 1)}, ${name}_hi)?;`,
      ].join("\n");
    case "string":
      return `        w.string(at, Self::DATA_WORDS, ${rsNumber(p.slot)}, ${p.optional ? `${self}.as_deref()` : `Some(&${self})`})?;`;
    case "bytes":
      return `        w.bytes(at, Self::DATA_WORDS, ${rsNumber(p.slot)}, ${p.optional ? `${self}.as_deref()` : `Some(&${self})`})?;`;
    case "child":
      return `        w.child(at, Self::DATA_WORDS, ${rsNumber(p.slot)}, ${p.optional ? `${self}.as_ref()` : `Some(&${self})`})?;`;
    case "list":
      return writeList(name, p);
  }
};

/** Tail after a `Result<Option<_>, _>` reader: keep the `Option` when the field
 *  is optional, else unwrap it or fail with `UnexpectedNull`. */
const optTail = (optional: boolean): string => (optional ? "?" : "?.ok_or(tdbin::DecodeError::UnexpectedNull)?");

const listTail = (optional: boolean): string => (optional ? "?" : "?.unwrap_or_default()");

const readWordList = (
  name: string,
  p: Extract<ListPlan, { kind: "word" }>,
  slot: number,
  optional: boolean
): string => {
  const call = `r.word_list(at, Self::DATA_WORDS, ${rsNumber(slot)})?`;
  const map = `values.into_iter().map(tdbin::scalar::${p.from}).collect::<Vec<_>>()`;
  return optional
    ? `        let ${name} = ${call}.map(|values| ${map});`
    : `        let ${name} = ${call}.unwrap_or_default().into_iter().map(tdbin::scalar::${p.from}).collect::<Vec<_>>();`;
};

const readDateTimeList = (name: string, slot: number, optional: boolean): string => {
  const call = `r.word_list(at, Self::DATA_WORDS, ${rsNumber(slot)})?`;
  const collect = (source: string): string =>
    `${source}.into_iter().map(|word| ${dateTimeResult("word")}).collect::<Result<Vec<_>, _>>()?`;
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
      return `        let ${name} = r.bool_list(at, Self::DATA_WORDS, ${rsNumber(p.slot)})${listTail(p.optional)};`;
    case "word":
      return readWordList(name, p.list, p.slot, p.optional);
    case "dateTime":
      return readDateTimeList(name, p.slot, p.optional);
    case "bytes16":
      return readBytes16List(name, p.list, p.slot, p.optional);
    case "string":
      return `        let ${name} = r.string_list(at, Self::DATA_WORDS, ${rsNumber(p.slot)})${listTail(p.optional)};`;
    case "bytes":
      return `        let ${name} = r.bytes_list(at, Self::DATA_WORDS, ${rsNumber(p.slot)})${listTail(p.optional)};`;
    case "child":
      return `        let ${name} = r.child_list::<${p.list.rustType}>(at, Self::DATA_WORDS, ${rsNumber(p.slot)})${listTail(p.optional)};`;
    case "enum":
      return readEnumList(name, p.list, p.slot, p.optional);
  }
};

const readField = (name: string, p: FieldPlan): string => {
  switch (p.kind) {
    case "scalar":
      return `        let ${name} = tdbin::scalar::${p.from}(r.scalar(at, ${rsNumber(p.slot)})?);`;
    case "boolBit":
      return `        let ${name} = r.bool_bit(at, ${rsNumber(p.slot)}, ${rsNumber(p.bit)})?;`;
    case "dateTime":
      return `        let ${name} = ${dateTimeValue(`r.scalar(at, ${rsNumber(p.slot)})?`)};`;
    case "bytes16":
      return `        let ${name} = ${bytes16Value(p.semantic, `tdbin::scalar::bytes16_from_words(r.scalar(at, ${rsNumber(p.slot)})?, r.scalar(at, ${rsNumber(p.slot + 1)})?)`)};`;
    case "optScalar":
      return [
        `        let ${name}_present = r.scalar(at, ${rsNumber(p.presenceSlot)})? != 0;`,
        `        let ${name}_value = tdbin::scalar::${p.from}(r.scalar(at, ${rsNumber(p.valueSlot)})?);`,
        `        let ${name} = ${name}_present.then_some(${name}_value);`,
      ].join("\n");
    case "optDateTime":
      return [
        `        let ${name}_present = r.scalar(at, ${rsNumber(p.presenceSlot)})? != 0;`,
        `        let ${name} = if ${name}_present { Some(${dateTimeValue(`r.scalar(at, ${rsNumber(p.valueSlot)})?`)}) } else { None };`,
      ].join("\n");
    case "optBytes16":
      return [
        `        let ${name}_present = r.scalar(at, ${rsNumber(p.presenceSlot)})? != 0;`,
        `        let ${name} = if ${name}_present {`,
        `            Some(${bytes16Value(p.semantic, `tdbin::scalar::bytes16_from_words(r.scalar(at, ${rsNumber(p.valueSlot)})?, r.scalar(at, ${rsNumber(p.valueSlot + 1)})?)`)})`,
        `        } else {`,
        `            None`,
        `        };`,
      ].join("\n");
    case "string":
      return `        let ${name} = r.string(at, Self::DATA_WORDS, ${rsNumber(p.slot)})${optTail(p.optional)};`;
    case "bytes":
      return `        let ${name} = r.bytes(at, Self::DATA_WORDS, ${rsNumber(p.slot)})${optTail(p.optional)};`;
    case "child":
      return `        let ${name} = r.child::<${p.rustType}>(at, Self::DATA_WORDS, ${rsNumber(p.slot)})${optTail(p.optional)};`;
    case "list":
      return readList(name, p);
  }
};

const emitRecordCodec = (rec: ResolvedRecord, plan: RecordPlan): string =>
  [
    `impl tdbin::Struct for ${rec.name} {`,
    `    const DATA_WORDS: u16 = ${rsNumber(plan.dataWords)};`,
    `    const PTR_WORDS: u16 = ${rsNumber(plan.ptrWords)};`,
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
  const nn = "?.ok_or(tdbin::DecodeError::UnexpectedNull)?";
  if (v.payload === null) {
    return `            ${rsNumber(v.ordinal)} => Ok(Self::${v.name}),`;
  }
  const read =
    v.payload.kind === "child"
      ? `r.child::<${v.payload.rustType}>(at, Self::DATA_WORDS, 0)${nn}`
      : `r.string(at, Self::DATA_WORDS, 0)${nn}`;
  return `            ${rsNumber(v.ordinal)} => Ok(Self::${v.name}(${read})),`;
};

const emitUnionCodec = (u: ResolvedUnion, plan: UnionPlan): string =>
  [
    `impl tdbin::Struct for ${u.name} {`,
    `    const DATA_WORDS: u16 = 1;`,
    `    const PTR_WORDS: u16 = ${rsNumber(plan.ptrWords)};`,
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
    `            ordinal => Err(tdbin::DecodeError::UnknownVariant { ordinal }),`,
    `        }`,
    `    }`,
    `}`,
  ].join("\n");

/** Emit the TDBIN codec (`impl tdbin::Struct`) for every record and union in
 *  the model. Aliases need no codec; generics must be monomorphized first. */
export const emitRustCodec = (model: Model): Result<string, Diagnostic[]> => {
  const blocks: string[] = [];
  for (const d of visibleDeclsForTarget(model.decls, "rust")) {
    if (d.generics.length > 0) {
      return err(diag(`tdbin: generic decl '${d.name}' must be monomorphized before codec generation`));
    }
    if (d.kind === "record") {
      const plan = classifyRecord(model.decls, d);
      if (!plan.ok) {
        return plan;
      }
      blocks.push(emitRecordCodec(d, plan.value));
    } else if (d.kind === "union") {
      const plan = classifyUnion(d);
      if (!plan.ok) {
        return plan;
      }
      blocks.push(emitUnionCodec(d, plan.value));
    }
  }
  return ok(blocks.join("\n\n"));
};

const deriveFor = (d: ResolvedDecl): string => (d.kind === "alias" ? "" : "#[derive(Debug, Clone, PartialEq)]\n");

/** Emit one ADT type with its doc comment first, then the derive, then the body
 *  (from the shared Rust converter) — the order rustc/clippy expect. */
const emitTypeWithDocs = (d: ResolvedDecl): string => {
  const [doc, ...rest] = emitRustDecl(d, true);
  return `${doc ?? ""}\n${deriveFor(d)}${rest.join("\n")}`;
};

/** Emit a self-contained Rust module: derived ADT types (from the existing
 *  Rust converter) plus their TDBIN codec — deny-all-clean (doc comments,
 *  derives). Everything the crate needs to round-trip a typeDiagram model,
 *  generated end to end. */
export const generateRustModule = (model: Model): Result<string, Diagnostic[]> => {
  const codec = emitRustCodec(model);
  if (!codec.ok) {
    return codec;
  }
  const types = visibleDeclsForTarget(model.decls, "rust").map(emitTypeWithDocs).join("\n");
  return ok(`${types}\n${codec.value}\n`);
};
