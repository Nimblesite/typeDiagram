// [CONV-TS-TDBIN] Generate TypeScript TDBIN codecs that target
// `packages/typediagram/src/tdbin`. Like the Rust generator, this bakes the
// schema layout into typed codec objects instead of using reflective values on
// the hot path ([TDBIN-FUTURE-TS], [TDBIN-REC-ALLOC]).
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
import { type Result, err, ok } from "../result.js";
import { printTypeRef } from "./parse-typeref.js";
import { typescript } from "./typescript.js";

type FieldPlan =
  | { kind: "int"; slot: number }
  | { kind: "float"; slot: number }
  | { kind: "bool"; slot: number; bit: number }
  | { kind: "string"; slot: number; optional: boolean }
  | { kind: "bytes"; slot: number; optional: boolean }
  | { kind: "child"; slot: number; optional: boolean; typeName: string };

interface RecordPlan {
  readonly dataWords: number;
  readonly ptrWords: number;
  readonly fields: readonly { readonly name: string; readonly plan: FieldPlan }[];
}

type VariantPlan = null | { readonly kind: "child"; readonly typeName: string } | { readonly kind: "string" };

interface UnionPlan {
  readonly ptrWords: number;
  readonly variants: readonly { readonly name: string; readonly ordinal: number; readonly payload: VariantPlan }[];
}

interface LayoutCursor {
  dataSlot: number;
  ptrSlot: number;
  boolSlot: number | null;
  nextBoolBit: number;
}

const BOOL_BITS_PER_WORD = 64;

const diag = (message: string): Diagnostic[] => [{ severity: "error", message, line: 0, col: 0, length: 0 }];

const tsNum = (value: number): string => String(value);

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
  const slot = cursor.boolSlot ?? cursor.dataSlot;
  cursor.boolSlot = slot;
  cursor.dataSlot = cursor.nextBoolBit === 0 ? cursor.dataSlot + 1 : cursor.dataSlot;
  const bit = cursor.nextBoolBit;
  cursor.nextBoolBit = bit + 1 >= BOOL_BITS_PER_WORD ? 0 : bit + 1;
  cursor.boolSlot = cursor.nextBoolBit === 0 ? null : cursor.boolSlot;
  return { kind: "bool", slot, bit };
};

const pointerField = (
  decls: readonly ResolvedDecl[],
  t: ResolvedTypeRef,
  slot: number,
  optional: boolean
): FieldPlan | null =>
  isPrim(t, "String")
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
  if (isPrim(t, "Int")) {
    const slot = cursor.dataSlot;
    cursor.dataSlot += 1;
    return { kind: "int", slot };
  }
  if (isPrim(t, "Float")) {
    const slot = cursor.dataSlot;
    cursor.dataSlot += 1;
    return { kind: "float", slot };
  }
  const optionInner = t.name === "Option" && t.args.length === 1 ? t.args[0] : undefined;
  const optional = optionInner === undefined ? null : pointerField(decls, optionInner, cursor.ptrSlot, true);
  const required = optionInner === undefined ? pointerField(decls, t, cursor.ptrSlot, false) : optional;
  cursor.ptrSlot = required === null ? cursor.ptrSlot : cursor.ptrSlot + 1;
  return required;
};

const classifyRecord = (decls: readonly ResolvedDecl[], rec: ResolvedRecord): Result<RecordPlan, Diagnostic[]> => {
  const cursor: LayoutCursor = { dataSlot: 0, ptrSlot: 0, boolSlot: null, nextBoolBit: 0 };
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

const classifyVariant = (variant: ResolvedVariant): Result<VariantPlan, Diagnostic[]> => {
  if (variant.fields.length === 0) {
    return ok(null);
  }
  const single =
    variant.fields.length === 1 && isTupleVariantFields(variant.fields) ? variant.fields[0]?.type : undefined;
  if (single === undefined) {
    return err(diag(`tdbin-ts: variant '${variant.name}' must be bare or a single tuple field in v0`));
  }
  return single.resolution.kind === "declared"
    ? ok({ kind: "child", typeName: single.resolution.declName })
    : isPrim(single, "String")
      ? ok({ kind: "string" })
      : err(diag(`tdbin-ts: variant '${variant.name}' payload '${printTypeRef(single)}' unsupported in v0`));
};

const classifyUnion = (union: ResolvedUnion): Result<UnionPlan, Diagnostic[]> => {
  const variants: Array<{ name: string; ordinal: number; payload: VariantPlan }> = [];
  for (const [ordinal, variant] of union.variants.entries()) {
    const payload = classifyVariant(variant);
    if (!payload.ok) {
      return payload;
    }
    variants.push({ name: variant.name, ordinal, payload: payload.value });
  }
  return ok({ ptrWords: variants.some((variant) => variant.payload !== null) ? 1 : 0, variants });
};

const emitWriteField = (codec: string, field: string, plan: FieldPlan): string[] => {
  const value = `value.${field}`;
  switch (plan.kind) {
    case "int":
      return [
        `    const ${field}Bits = tdbin.scalar.i64Bits(${value});`,
        `    if (!${field}Bits.ok) return ${field}Bits;`,
        `    const ${field} = tdbin.writer.scalar(writer, at, ${tsNum(plan.slot)}, ${field}Bits.value);`,
      ];
    case "float":
      return [
        `    const ${field} = tdbin.writer.scalar(writer, at, ${tsNum(plan.slot)}, tdbin.scalar.f64Bits(${value}));`,
      ];
    case "bool":
      return [
        `    const ${field} = tdbin.writer.boolBit(writer, at, ${tsNum(plan.slot)}, ${tsNum(plan.bit)}, ${value});`,
      ];
    case "string":
      return [
        `    const ${field} = tdbin.writer.string(writer, at, ${codec}.dataWords, ${tsNum(plan.slot)}, ${plan.optional ? `${value} ?? null` : value});`,
      ];
    case "bytes":
      return [
        `    const ${field} = tdbin.writer.bytes(writer, at, ${codec}.dataWords, ${tsNum(plan.slot)}, ${plan.optional ? `${value} ?? null` : value});`,
      ];
    case "child":
      return [
        `    const ${field} = tdbin.writer.child(writer, at, ${codec}.dataWords, ${tsNum(plan.slot)}, ${plan.typeName}Codec, ${plan.optional ? `${value} ?? null` : value});`,
      ];
  }
};

const emitReadField = (codec: string, field: string, plan: FieldPlan): string[] => {
  switch (plan.kind) {
    case "int":
      return [`    const ${field}Word = tdbin.reader.scalar(reader, at, ${tsNum(plan.slot)});`];
    case "float":
      return [`    const ${field}Word = tdbin.reader.scalar(reader, at, ${tsNum(plan.slot)});`];
    case "bool":
      return [`    const ${field} = tdbin.reader.boolBit(reader, at, ${tsNum(plan.slot)}, ${tsNum(plan.bit)});`];
    case "string":
      return [`    const ${field} = tdbin.reader.string(reader, at, ${codec}.dataWords, ${tsNum(plan.slot)});`];
    case "bytes":
      return [`    const ${field} = tdbin.reader.bytes(reader, at, ${codec}.dataWords, ${tsNum(plan.slot)});`];
    case "child":
      return [
        `    const ${field} = tdbin.reader.child(reader, at, ${codec}.dataWords, ${tsNum(plan.slot)}, ${plan.typeName}Codec);`,
      ];
  }
};

const fieldResultName = (field: string, plan: FieldPlan): string =>
  plan.kind === "int" || plan.kind === "float" ? `${field}Word` : field;

const fieldValue = (field: string, plan: FieldPlan): string => {
  const result = fieldResultName(field, plan);
  switch (plan.kind) {
    case "int":
      return `tdbin.scalar.i64From(${result}.value)`;
    case "float":
      return `tdbin.scalar.f64From(${result}.value)`;
    case "string":
    case "bytes":
    case "child":
      return plan.optional ? `${result}.value ?? undefined` : `${result}.value`;
    case "bool":
      return `${result}.value`;
  }
};

const emitRecordCodec = (record: ResolvedRecord, plan: RecordPlan): string => {
  const codec = `${record.name}Codec`;
  const writeLines = plan.fields.flatMap(({ name, plan: fieldPlan }) => [
    ...emitWriteField(codec, name, fieldPlan),
    `    if (!${fieldResultName(name, fieldPlan)}.ok) return ${fieldResultName(name, fieldPlan)};`,
  ]);
  const readLines = plan.fields.flatMap(({ name, plan: fieldPlan }) => emitReadField(codec, name, fieldPlan));
  const resultNames = plan.fields.map(({ name, plan: fieldPlan }) => fieldResultName(name, fieldPlan));
  const required = plan.fields.filter(({ plan: fieldPlan }) => "optional" in fieldPlan && !fieldPlan.optional);
  return [
    `export const ${codec}: tdbin.StructCodec<${record.name}> = {`,
    `  dataWords: ${tsNum(plan.dataWords)},`,
    `  ptrWords: ${tsNum(plan.ptrWords)},`,
    `  write: (writer, at, value) => {`,
    ...writeLines,
    `    return ok(undefined);`,
    `  },`,
    `  read: (reader, at) => {`,
    ...readLines,
    ...resultNames.map((name) => `    if (!${name}.ok) return ${name};`),
    ...required.map(({ name }) => `    if (${name}.value === null) return tdbin.readerError("UnexpectedNull");`),
    `    return ok({ ${plan.fields.map(({ name, plan: fieldPlan }) => `${name}: ${fieldValue(name, fieldPlan)}`).join(", ")} });`,
    `  },`,
    `};`,
  ].join("\n");
};

const writeVariantPayload = (union: string, variant: UnionPlan["variants"][number]): string => {
  if (variant.payload === null) {
    return `        return disc;`;
  }
  const payload =
    variant.payload.kind === "child"
      ? `tdbin.writer.child(writer, at, ${union}Codec.dataWords, 0, ${variant.payload.typeName}Codec, value._0)`
      : `tdbin.writer.string(writer, at, ${union}Codec.dataWords, 0, value._0)`;
  return `        return disc.ok ? ${payload} : disc;`;
};

const readVariantPayload = (union: string, variant: UnionPlan["variants"][number]): string[] => {
  if (variant.payload === null) {
    return [`        return ok({ kind: "${variant.name}" });`];
  }
  const payload =
    variant.payload.kind === "child"
      ? `tdbin.reader.child(reader, at, ${union}Codec.dataWords, 0, ${variant.payload.typeName}Codec)`
      : `tdbin.reader.string(reader, at, ${union}Codec.dataWords, 0)`;
  return [
    `        const payload = ${payload};`,
    `        if (!payload.ok) return payload;`,
    `        if (payload.value === null) return tdbin.readerError("UnexpectedNull");`,
    `        return ok({ kind: "${variant.name}", _0: payload.value });`,
  ];
};

const emitUnionCodec = (union: ResolvedUnion, plan: UnionPlan): string =>
  [
    `export const ${union.name}Codec: tdbin.StructCodec<${union.name}> = {`,
    `  dataWords: 1,`,
    `  ptrWords: ${tsNum(plan.ptrWords)},`,
    `  write: (writer, at, value) => {`,
    `    switch (value.kind) {`,
    ...plan.variants.flatMap((variant) => [
      `      case "${variant.name}": {`,
      `        const disc = tdbin.writer.scalar(writer, at, 0, ${tsNum(variant.ordinal)}n);`,
      writeVariantPayload(union.name, variant),
      `      }`,
    ]),
    `    }`,
    `  },`,
    `  read: (reader, at) => {`,
    `    const ordinal = tdbin.reader.scalar(reader, at, 0);`,
    `    if (!ordinal.ok) return ordinal;`,
    `    switch (ordinal.value) {`,
    ...plan.variants.flatMap((variant) => [
      `      case ${tsNum(variant.ordinal)}n: {`,
      ...readVariantPayload(union.name, variant),
      `      }`,
    ]),
    `      default: return tdbin.readerError("UnknownVariant", { ordinal: ordinal.value });`,
    `    }`,
    `  },`,
    `};`,
  ].join("\n");

export const emitTypeScriptCodec = (model: Model): Result<string, Diagnostic[]> => {
  const blocks: string[] = [];
  for (const decl of visibleDeclsForTarget(model.decls, "typescript")) {
    if (decl.generics.length > 0) {
      return err(diag(`tdbin-ts: generic decl '${decl.name}' must be monomorphized before codec generation`));
    }
    if (decl.kind === "record") {
      const plan = classifyRecord(model.decls, decl);
      if (!plan.ok) {
        return plan;
      }
      blocks.push(emitRecordCodec(decl, plan.value));
    }
    if (decl.kind === "union") {
      const plan = classifyUnion(decl);
      if (!plan.ok) {
        return plan;
      }
      blocks.push(emitUnionCodec(decl, plan.value));
    }
  }
  return ok(blocks.join("\n\n"));
};

export const generateTypeScriptModule = (model: Model): Result<string, Diagnostic[]> => {
  const codec = emitTypeScriptCodec(model);
  if (!codec.ok) {
    return codec;
  }
  return ok(
    [
      `import { ok } from "typediagram-core";`,
      `import * as tdbin from "typediagram-core/tdbin";`,
      ``,
      typescript.toSource(model),
      codec.value,
      ``,
    ].join("\n")
  );
};
