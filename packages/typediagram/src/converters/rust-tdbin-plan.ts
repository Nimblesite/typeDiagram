// [CONV-RUST-TDBIN] Wire-layout classification for the TDBIN Rust codec
// generator: turns resolved records and unions into slot-addressed field plans
// ([TDBIN-REC-ALLOC], [TDBIN-UNION-DISC]). Layout major 2 swaps list fields to
// their columnar forms ([TDBIN-COL-POLICY]); everything else is layout-shared.
import type { Diagnostic } from "../parser/diagnostics.js";
import {
  isTupleVariantFields,
  type ResolvedDecl,
  type ResolvedRecord,
  type ResolvedTypeRef,
  type ResolvedUnion,
  type ResolvedVariant,
} from "../model/types.js";
import { printTypeRef } from "./parse-typeref.js";
import { mapTdToRs } from "./rust.js";
import { err, ok, type Result } from "../result.js";
import {
  allocateAlignedPair,
  allocateBit,
  allocatePair,
  allocatePtr,
  allocateWord,
  type LayoutCursor,
  newLayoutCursor,
} from "./tdbin-alloc.js";

/** Layout major: 1 = row-wise lists, 2 = columnar lists ([TDBIN-COL-POLICY]). */
export type Layout = 1 | 2;

/** Word scalars stored raw in the data section, with their codec fns. Bool is
 *  NOT here: direct and optional Bools are bit-allocated ([TDBIN-WIRE-WORD]). */
const SCALARS: Record<string, { bits: string; from: string }> = {
  Int: { bits: "i64_bits", from: "i64_from" },
  Float: { bits: "f64_bits", from: "f64_from" },
};

/** How a record field is laid out on the wire. */
export type FieldPlan =
  | { kind: "scalar"; slot: number; bits: string; from: string }
  | { kind: "boolBit"; slot: number; bit: number }
  | { kind: "dateTime"; slot: number }
  | { kind: "bytes16"; slot: number; semantic: Bytes16Semantic }
  | { kind: "optScalar"; presenceSlot: number; presenceBit: number; valueSlot: number; bits: string; from: string }
  | { kind: "optBool"; presenceSlot: number; presenceBit: number; valueSlot: number; valueBit: number }
  | { kind: "optDateTime"; presenceSlot: number; presenceBit: number; valueSlot: number }
  | { kind: "optBytes16"; presenceSlot: number; presenceBit: number; valueSlot: number; semantic: Bytes16Semantic }
  | { kind: "string"; slot: number; optional: boolean }
  | { kind: "bytes"; slot: number; optional: boolean }
  | { kind: "child"; slot: number; optional: boolean; rustType: string }
  | { kind: "list"; slot: number; optional: boolean; list: ListPlan }
  | { kind: "columnList"; slot: number; optional: boolean; rustType: string }
  | { kind: "varList"; lenSlot: number; paySlot: number; variant: "string" | "bytes" };

export type ListPlan =
  | { kind: "bool" }
  | { kind: "flat"; method: "i64_list" | "f64_list" }
  | { kind: "intBlock" }
  | { kind: "dateTime" }
  | { kind: "bytes16"; semantic: Bytes16Semantic }
  | { kind: "string" }
  | { kind: "bytes" }
  | { kind: "child"; rustType: string }
  | { kind: "enum"; rustType: string; variants: string[] };

export type FieldError = { error: string };
export type SemanticScalar = "DateTime" | "Uuid" | "Decimal";
export type Bytes16Semantic = "Uuid" | "Decimal";

/** A fully-classified record: section sizes plus per-field placement. */
export interface RecordPlan {
  dataWords: number;
  ptrWords: number;
  fields: Array<{ name: string; plan: FieldPlan }>;
}

/** A union variant's payload placement (all share pointer slot 0). */
export type VariantPlan = null | { kind: "child"; rustType: string } | { kind: "string" };

/** A fully-classified union. */
export interface UnionPlan {
  ptrWords: number;
  variants: Array<{ name: string; ordinal: number; payload: VariantPlan }>;
}

export const diag = (message: string): Diagnostic[] => [{ severity: "error", message, line: 0, col: 0, length: 0 }];

export const rsNumber = (value: number): string => String(value);

export const isPrim = (t: ResolvedTypeRef, name: string): boolean =>
  t.name === name && t.resolution.kind === "primitive" && t.args.length === 0;

export const isDeclared = (t: ResolvedTypeRef): boolean => t.resolution.kind === "declared";

export const declaredRecord = (decls: readonly ResolvedDecl[], t: ResolvedTypeRef): ResolvedRecord | undefined => {
  if (t.resolution.kind !== "declared") {
    return undefined;
  }
  const { declName } = t.resolution;
  return decls.find((d): d is ResolvedRecord => d.kind === "record" && d.name === declName);
};

export const declaredUnion = (decls: readonly ResolvedDecl[], t: ResolvedTypeRef): ResolvedUnion | undefined => {
  if (t.resolution.kind !== "declared") {
    return undefined;
  }
  const { declName } = t.resolution;
  return decls.find((d): d is ResolvedUnion => d.kind === "union" && d.name === declName);
};

/** An all-bare union inlines as a discriminant scalar ([TDBIN-UNION-ENUM]). */
export const isEnumUnion = (u: ResolvedUnion): boolean => u.variants.every((v) => v.fields.length === 0);

export const isFieldError = (placed: unknown): placed is FieldError =>
  typeof placed === "object" && placed !== null && "error" in placed;

const emptyRecordListError = (t: ResolvedTypeRef): FieldError => ({
  error: `tdbin: List<empty-record> '${printTypeRef(t)}' has a zero-word composite stride`,
});

export const listInnerOf = (t: ResolvedTypeRef): ResolvedTypeRef | undefined =>
  t.name === "List" && t.args.length === 1 ? t.args[0] : undefined;

export const optionInnerOf = (t: ResolvedTypeRef): ResolvedTypeRef | undefined =>
  t.name === "Option" && t.args.length === 1 ? t.args[0] : undefined;

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
        ? { kind: "child", slot, optional, rustType: mapTdToRs(t) }
        : null;

/** The one-word scalar codec for a bare primitive (Bool/Int/Float), else undefined. */
export const scalarOf = (t: ResolvedTypeRef): { bits: string; from: string } | undefined =>
  t.args.length === 0 && t.resolution.kind === "primitive" ? SCALARS[t.name] : undefined;

const isSemanticName = (name: string): name is SemanticScalar =>
  name === "DateTime" || name === "Uuid" || name === "Decimal";

/** The semantic scalar codec for a bare primitive, else undefined. */
export const semanticOf = (t: ResolvedTypeRef): SemanticScalar | undefined =>
  t.args.length === 0 && t.resolution.kind === "primitive" && isSemanticName(t.name) ? t.name : undefined;

/** Allocate a direct Bool into a reusable bitset word ([TDBIN-WIRE-WORD]). */
const allocateBool = (cursor: LayoutCursor): FieldPlan => {
  const { slot, bit } = allocateBit(cursor);
  return { kind: "boolBit", slot, bit };
};

const allocateSemantic = (semantic: SemanticScalar, cursor: LayoutCursor): FieldPlan =>
  semantic === "DateTime"
    ? { kind: "dateTime", slot: allocateWord(cursor) }
    : { kind: "bytes16", slot: allocatePair(cursor), semantic };

/** `Option<DateTime|Uuid|Decimal>`: a 1-bit presence flag in the shared bool
 *  bitset, then the value at its natural width/alignment ([TDBIN-PRIM-OPTION]). */
const allocateOptSemantic = (semantic: SemanticScalar, cursor: LayoutCursor): FieldPlan => {
  const presence = allocateBit(cursor);
  return semantic === "DateTime"
    ? { kind: "optDateTime", presenceSlot: presence.slot, presenceBit: presence.bit, valueSlot: allocateWord(cursor) }
    : {
        kind: "optBytes16",
        presenceSlot: presence.slot,
        presenceBit: presence.bit,
        valueSlot: allocateAlignedPair(cursor),
        semantic,
      };
};

/** `Option<Bool>`: presence bit + value bit, both in the shared bitset. */
const allocateOptBool = (cursor: LayoutCursor): FieldPlan => {
  const presence = allocateBit(cursor);
  const value = allocateBit(cursor);
  return {
    kind: "optBool",
    presenceSlot: presence.slot,
    presenceBit: presence.bit,
    valueSlot: value.slot,
    valueBit: value.bit,
  };
};

const BYTE_LIST_VARIANT_LIMIT = 256;

const enumListPlan = (u: ResolvedUnion, t: ResolvedTypeRef): ListPlan | FieldError | null => {
  if (!isEnumUnion(u)) {
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
    return emptyRecordListError(t);
  }
  if (rec !== undefined || declaredUnion(decls, t) !== undefined) {
    return { kind: "child", rustType: mapTdToRs(t) };
  }
  return null;
};

const flatListMethod = (t: ResolvedTypeRef): "i64_list" | "f64_list" | undefined =>
  isPrim(t, "Int") ? "i64_list" : isPrim(t, "Float") ? "f64_list" : undefined;

const listPlanFor = (decls: readonly ResolvedDecl[], inner: ResolvedTypeRef): ListPlan | FieldError | null => {
  const flat = flatListMethod(inner);
  const semantic = semanticOf(inner);
  const union = declaredUnion(decls, inner);
  const enumPlan = union === undefined ? null : enumListPlan(union, inner);
  if (isPrim(inner, "Bool")) {
    return { kind: "bool" };
  }
  if (flat !== undefined) {
    return { kind: "flat", method: flat };
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

/** Required `List<String>`/`List<Bytes>` at layout 2: a var column pair
 *  ([TDBIN-COL-VAR]). The optional form has no columnar encoding yet. */
const varListPlan = (
  outer: ResolvedTypeRef,
  inner: ResolvedTypeRef,
  cursor: LayoutCursor,
  optional: boolean
): FieldPlan | FieldError => {
  if (optional) {
    return { error: `tdbin: Option<${printTypeRef(outer)}> has no columnar encoding under layout 2` };
  }
  const lenSlot = allocatePtr(cursor);
  return {
    kind: "varList",
    lenSlot,
    paySlot: allocatePtr(cursor),
    variant: isPrim(inner, "String") ? "string" : "bytes",
  };
};

/** Layout-2 list forms ([TDBIN-COL-POLICY]): record/union elements become one
 *  column-group pointer; String/Bytes become a var column pair; Int becomes a
 *  frame-of-reference delta block ([TDBIN-COL-INTBLOCK]). Other scalar and
 *  enum-union lists fall through (null) to their layout-1 forms. */
const columnarListPlan = (
  decls: readonly ResolvedDecl[],
  outer: ResolvedTypeRef,
  inner: ResolvedTypeRef,
  cursor: LayoutCursor,
  optional: boolean
): FieldPlan | FieldError | null => {
  if (isPrim(inner, "Int")) {
    return { kind: "list", slot: allocatePtr(cursor), optional, list: { kind: "intBlock" } };
  }
  if (isPrim(inner, "String") || isPrim(inner, "Bytes")) {
    return varListPlan(outer, inner, cursor, optional);
  }
  const rec = declaredRecord(decls, inner);
  if (rec?.fields.length === 0) {
    return emptyRecordListError(inner);
  }
  const union = declaredUnion(decls, inner);
  const grouped = rec !== undefined || (union !== undefined && !isEnumUnion(union));
  if (!grouped) {
    return null;
  }
  return { kind: "columnList", slot: allocatePtr(cursor), optional, rustType: mapTdToRs(inner) };
};

const classifyList = (
  decls: readonly ResolvedDecl[],
  layout: Layout,
  outer: ResolvedTypeRef,
  inner: ResolvedTypeRef,
  cursor: LayoutCursor,
  optional: boolean
): FieldPlan | FieldError | null => {
  const columnar = layout === 2 ? columnarListPlan(decls, outer, inner, cursor, optional) : null;
  if (columnar !== null) {
    return columnar;
  }
  const plan = listPlanFor(decls, inner);
  if (plan === null || isFieldError(plan)) {
    return plan;
  }
  return { kind: "list", slot: allocatePtr(cursor), optional, list: plan };
};

/** Classify an `Option<T>` field: a scalar inner takes a 1-bit presence flag in
 *  the shared bool bitset plus a natural-width value slot ([TDBIN-PRIM-OPTION]);
 *  a pointer inner takes one pointer slot with null = `None`. */
const classifyOption = (
  decls: readonly ResolvedDecl[],
  layout: Layout,
  inner: ResolvedTypeRef,
  cursor: LayoutCursor
): FieldPlan | FieldError | null => {
  const listInner = listInnerOf(inner);
  if (listInner !== undefined) {
    return classifyList(decls, layout, inner, listInner, cursor, true);
  }
  if (isPrim(inner, "Bool")) {
    return allocateOptBool(cursor);
  }
  const innerSemantic = semanticOf(inner);
  if (innerSemantic !== undefined) {
    return allocateOptSemantic(innerSemantic, cursor);
  }
  const innerScalar = scalarOf(inner);
  if (innerScalar !== undefined) {
    const presence = allocateBit(cursor);
    return {
      kind: "optScalar",
      presenceSlot: presence.slot,
      presenceBit: presence.bit,
      valueSlot: allocateWord(cursor),
      bits: innerScalar.bits,
      from: innerScalar.from,
    };
  }
  const plan = pointerInner(decls, inner, cursor.ptrSlot, true);
  if (plan !== null && !isFieldError(plan)) {
    allocatePtr(cursor);
  }
  return plan;
};

/** Classify one record field into a scalar, `Option<scalar>`, or pointer plan. */
const classifyField = (
  decls: readonly ResolvedDecl[],
  layout: Layout,
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
    return { kind: "scalar", slot: allocateWord(cursor), bits: scalar.bits, from: scalar.from };
  }
  const optionInner = optionInnerOf(t);
  if (optionInner !== undefined) {
    return classifyOption(decls, layout, optionInner, cursor);
  }
  const listInner = listInnerOf(t);
  if (listInner !== undefined) {
    return classifyList(decls, layout, t, listInner, cursor, false);
  }
  const plan = pointerInner(decls, t, cursor.ptrSlot, false);
  if (plan !== null && !isFieldError(plan)) {
    allocatePtr(cursor);
  }
  return plan;
};

export const classifyRecord = (
  decls: readonly ResolvedDecl[],
  rec: ResolvedRecord,
  layout: Layout
): Result<RecordPlan, Diagnostic[]> => {
  const cursor = newLayoutCursor();
  const fields: Array<{ name: string; plan: FieldPlan }> = [];
  for (const f of rec.fields) {
    const c = classifyField(decls, layout, f.type, cursor);
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
  const single = variantPayloadType(v);
  if (single === undefined) {
    return err(diag(`tdbin: variant '${v.name}' must be bare or a single tuple field in v0`));
  }
  return isDeclared(single)
    ? ok({ kind: "child", rustType: mapTdToRs(single) })
    : isPrim(single, "String")
      ? ok({ kind: "string" })
      : err(diag(`tdbin: variant '${v.name}' payload '${printTypeRef(single)}' unsupported in v0`));
};

/** The single tuple payload type of a variant, if it has exactly that shape. */
export const variantPayloadType = (v: ResolvedVariant): ResolvedTypeRef | undefined =>
  v.fields.length === 1 && isTupleVariantFields(v.fields) ? v.fields[0]?.type : undefined;

export const classifyUnion = (u: ResolvedUnion): Result<UnionPlan, Diagnostic[]> => {
  const variants: UnionPlan["variants"] = [];
  for (const [ordinal, v] of u.variants.entries()) {
    const payload = classifyVariant(v);
    if (!payload.ok) {
      return payload;
    }
    variants.push({ name: v.name, ordinal, payload: payload.value });
  }
  // [TDBIN-UNION-OVERLAP] every variant's payload overlaps the same slot: only
  // one variant is ever live, so the union of all variants is one pointer slot.
  const ptrWords = variants.some((v) => v.payload !== null) ? 1 : 0;
  return ok({ ptrWords, variants });
};
