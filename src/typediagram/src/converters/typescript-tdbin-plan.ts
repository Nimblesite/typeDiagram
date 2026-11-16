// [CONV-TS-TDBIN] Field/record/union layout planning for the TypeScript TDBIN
// generator. Shares the Rust emitter's allocator (tdbin-alloc.ts) so both bake
// identical slot/bit numbers ([TDBIN-REC-ALLOC]).
import type { Diagnostic } from "../parser/diagnostics.js";
import type { ResolvedDecl, ResolvedRecord, ResolvedTypeRef, ResolvedUnion, ResolvedVariant } from "../model/types.js";
import { type Result, err, ok } from "../result.js";
import { printTypeRef } from "./parse-typeref.js";
import { allocateBit, allocatePtr, allocateWord, type LayoutCursor, newLayoutCursor } from "./tdbin-alloc.js";
import { isInlineVariant, payloadFieldName, variantPayloadName } from "./tdbin-variant-records.js";
import {
  diag,
  type FieldPlan,
  type RecordPlan,
  type UnionPlan,
  type VariantPlan,
} from "./typescript-tdbin-defaults.js";
import { listPlanOf } from "./typescript-tdbin-lists.js";
import { widthOf } from "./typescript-tdbin-widths.js";

const isPrim = (t: ResolvedTypeRef, name: string): boolean =>
  t.name === name && t.resolution.kind === "primitive" && t.args.length === 0;

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

const allocateBool = (cursor: LayoutCursor): FieldPlan => {
  const { slot, bit } = allocateBit(cursor);
  return { kind: "bool", slot, bit };
};

/** `Option<scalar>` takes a 1-bit presence flag in the shared bool bitset plus
 *  a natural-width value slot ([TDBIN-PRIM-OPTION]) — the SAME allocator the
 *  Rust emitter uses, so both emitters bake identical slot/bit numbers. */
const allocateOptScalar = (inner: ResolvedTypeRef, cursor: LayoutCursor): FieldPlan | null => {
  if (isPrim(inner, "Bool")) {
    const presence = allocateBit(cursor);
    const value = allocateBit(cursor);
    return {
      kind: "optBool",
      presenceSlot: presence.slot,
      presenceBit: presence.bit,
      valueSlot: value.slot,
      valueBit: value.bit,
    };
  }
  const width = widthOf(inner);
  if (width !== undefined) {
    const presence = allocateBit(cursor);
    return {
      kind: "optWidth",
      presenceSlot: presence.slot,
      presenceBit: presence.bit,
      valueSlot: allocateWord(cursor),
      width,
    };
  }
  if (!isPrim(inner, "Int") && !isPrim(inner, "Float")) {
    return null;
  }
  const presence = allocateBit(cursor);
  return {
    kind: isPrim(inner, "Int") ? "optInt" : "optFloat",
    presenceSlot: presence.slot,
    presenceBit: presence.bit,
    valueSlot: allocateWord(cursor),
  };
};

const pointerField = (
  decls: readonly ResolvedDecl[],
  t: ResolvedTypeRef,
  slot: number,
  optional: boolean
): FieldPlan | null => {
  const list = listPlanOf(decls, t);
  return list !== null ? { kind: "list", slot, optional, list } : scalarPointer(decls, t, slot, optional);
};

const scalarPointer = (
  decls: readonly ResolvedDecl[],
  t: ResolvedTypeRef,
  slot: number,
  optional: boolean
): FieldPlan | null =>
  isPrim(t, "String") || isPrim(t, "Path")
    ? { kind: "string", slot, optional }
    : isPrim(t, "Bytes")
      ? { kind: "bytes", slot, optional }
      : declaredRecord(decls, t) !== undefined || declaredUnion(decls, t) !== undefined
        ? { kind: "child", slot, optional, typeName: t.resolution.kind === "declared" ? t.resolution.declName : t.name }
        : null;

const classifyField = (decls: readonly ResolvedDecl[], t: ResolvedTypeRef, cursor: LayoutCursor): FieldPlan | null => {
  if (isPrim(t, "Bool")) {
    return allocateBool(cursor);
  }
  if (isPrim(t, "Int") || isPrim(t, "Float")) {
    return { kind: isPrim(t, "Int") ? "int" : "float", slot: allocateWord(cursor) };
  }
  const width = widthOf(t);
  if (width !== undefined) {
    return { kind: "width", slot: allocateWord(cursor), width };
  }
  const optionInner = t.name === "Option" && t.args.length === 1 ? t.args[0] : undefined;
  const optScalar = optionInner === undefined ? null : allocateOptScalar(optionInner, cursor);
  if (optScalar !== null) {
    return optScalar;
  }
  const optional = optionInner === undefined ? null : pointerField(decls, optionInner, cursor.ptrSlot, true);
  const required = optionInner === undefined ? pointerField(decls, t, cursor.ptrSlot, false) : optional;
  if (required !== null) {
    allocatePtr(cursor);
  }
  return required;
};

export const classifyRecord = (
  decls: readonly ResolvedDecl[],
  rec: ResolvedRecord
): Result<RecordPlan, Diagnostic[]> => {
  const cursor = newLayoutCursor();
  const fields: Array<{ name: string; plan: FieldPlan }> = [];
  for (const field of rec.fields) {
    const plan = classifyField(decls, field.type, cursor);
    if (plan === null) {
      return err(diag(`tdbin-ts: unsupported field type '${printTypeRef(field.type)}' in ${rec.name}.${field.name}`));
    }
    fields.push({ name: field.name, plan });
  }
  return ok({ dataWords: cursor.dataSlot, ptrWords: cursor.ptrSlot, fields });
};

const classifyVariant = (union: ResolvedUnion, variant: ResolvedVariant): Result<VariantPlan, Diagnostic[]> => {
  if (variant.fields.length === 0) {
    return ok(null);
  }
  if (isInlineVariant(variant)) {
    return ok({
      kind: "inline",
      typeName: variantPayloadName(union, variant),
      fields: variant.fields.map((f, i) => ({ name: f.name, payload: payloadFieldName(variant, i) })),
    });
  }
  const single = variant.fields[0]?.type;
  return single?.resolution.kind === "declared"
    ? ok({ kind: "child", typeName: single.resolution.declName })
    : single !== undefined && isPrim(single, "String")
      ? ok({ kind: "string" })
      : err(
          diag(
            `tdbin-ts: variant '${variant.name}' payload '${single === undefined ? "?" : printTypeRef(single)}' unsupported in v0`
          )
        );
};

export const classifyUnion = (union: ResolvedUnion): Result<UnionPlan, Diagnostic[]> => {
  const variants: Array<{ name: string; ordinal: number; payload: VariantPlan }> = [];
  for (const [ordinal, variant] of union.variants.entries()) {
    const payload = classifyVariant(union, variant);
    if (!payload.ok) {
      return payload;
    }
    variants.push({ name: variant.name, ordinal, payload: payload.value });
  }
  return ok({ ptrWords: variants.some((variant) => variant.payload !== null) ? 1 : 0, variants });
};
