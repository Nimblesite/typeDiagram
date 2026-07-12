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
import { allocateBit, allocatePtr, allocateWord, type LayoutCursor, newLayoutCursor } from "./tdbin-alloc.js";
import {
  type DeclPlan,
  diag,
  emitDefaultFactories,
  type FieldPlan,
  pointerDefault,
  type RecordPlan,
  type UnionPlan,
  variantPayloadDefault,
  type VariantPlan,
} from "./typescript-tdbin-defaults.js";
import { typescript } from "./typescript.js";

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
  if (isPrim(t, "Int") || isPrim(t, "Float")) {
    return { kind: isPrim(t, "Int") ? "int" : "float", slot: allocateWord(cursor) };
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

const classifyRecord = (decls: readonly ResolvedDecl[], rec: ResolvedRecord): Result<RecordPlan, Diagnostic[]> => {
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

/** Write the 1-bit presence flag; absent values write zero lanes ([TDBIN-ENC-ZERO]). */
const writePresenceLines = (field: string, plan: { presenceSlot: number; presenceBit: number }): string[] => [
  `    const ${field}Present = tdbin.writer.boolBit(writer, at, ${tsNum(plan.presenceSlot)}, ${tsNum(plan.presenceBit)}, value.${field} !== undefined);`,
  `    if (!${field}Present.ok) return ${field}Present;`,
];

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
    case "optInt":
      return [
        ...writePresenceLines(field, plan),
        `    const ${field}Bits = tdbin.scalar.i64Bits(${value} ?? 0);`,
        `    if (!${field}Bits.ok) return ${field}Bits;`,
        `    const ${field} = tdbin.writer.scalar(writer, at, ${tsNum(plan.valueSlot)}, ${field}Bits.value);`,
      ];
    case "optFloat":
      return [
        ...writePresenceLines(field, plan),
        `    const ${field} = tdbin.writer.scalar(writer, at, ${tsNum(plan.valueSlot)}, tdbin.scalar.f64Bits(${value} ?? 0));`,
      ];
    case "optBool":
      return [
        ...writePresenceLines(field, plan),
        `    const ${field} = tdbin.writer.boolBit(writer, at, ${tsNum(plan.valueSlot)}, ${tsNum(plan.valueBit)}, ${value} ?? false);`,
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
    case "optInt":
    case "optFloat":
      return [
        `    const ${field}Present = tdbin.reader.boolBit(reader, at, ${tsNum(plan.presenceSlot)}, ${tsNum(plan.presenceBit)});`,
        `    const ${field}Word = tdbin.reader.scalar(reader, at, ${tsNum(plan.valueSlot)});`,
      ];
    case "optBool":
      return [
        `    const ${field}Present = tdbin.reader.boolBit(reader, at, ${tsNum(plan.presenceSlot)}, ${tsNum(plan.presenceBit)});`,
        `    const ${field}Value = tdbin.reader.boolBit(reader, at, ${tsNum(plan.valueSlot)}, ${tsNum(plan.valueBit)});`,
      ];
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

/** READ-path result bindings the ok-guards must check, in emission order. */
const fieldResultNames = (field: string, plan: FieldPlan): string[] => {
  switch (plan.kind) {
    case "int":
    case "float":
      return [`${field}Word`];
    case "optInt":
    case "optFloat":
      return [`${field}Present`, `${field}Word`];
    case "optBool":
      return [`${field}Present`, `${field}Value`];
    default:
      return [field];
  }
};

const fieldValue = (field: string, plan: FieldPlan): string => {
  switch (plan.kind) {
    case "int":
      return `tdbin.scalar.i64From(${field}Word.value)`;
    case "float":
      return `tdbin.scalar.f64From(${field}Word.value)`;
    case "optInt":
      return `${field}Present.value ? tdbin.scalar.i64From(${field}Word.value) : undefined`;
    case "optFloat":
      return `${field}Present.value ? tdbin.scalar.f64From(${field}Word.value) : undefined`;
    case "optBool":
      return `${field}Present.value ? ${field}Value.value : undefined`;
    case "string":
    case "bytes":
    case "child":
      return `${field}.value ?? ${plan.optional ? "undefined" : pointerDefault(plan)}`;
    case "bool":
      return `${field}.value`;
  }
};

const emitRecordCodec = (record: ResolvedRecord, plan: RecordPlan): string => {
  const codec = `${record.name}Codec`;
  // Write results always bind to the plain field name; `fieldResultName` is the
  // READ-path binding (`${field}Word` for scalars) and must not guard writes.
  const writeLines = plan.fields.flatMap(({ name, plan: fieldPlan }) => [
    ...emitWriteField(codec, name, fieldPlan),
    `    if (!${name}.ok) return ${name};`,
  ]);
  const readLines = plan.fields.flatMap(({ name, plan: fieldPlan }) => emitReadField(codec, name, fieldPlan));
  const resultNames = plan.fields.flatMap(({ name, plan: fieldPlan }) => fieldResultNames(name, fieldPlan));
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
    return [
      `        const inactive = tdbin.reader.requireNullPointer(reader, at, 0);`,
      `        return inactive.ok ? ok({ kind: "${variant.name}" }) : inactive;`,
    ];
  }
  const payload =
    variant.payload.kind === "child"
      ? `tdbin.reader.child(reader, at, ${union}Codec.dataWords, 0, ${variant.payload.typeName}Codec)`
      : `tdbin.reader.string(reader, at, ${union}Codec.dataWords, 0)`;
  return [
    `        const payload = ${payload};`,
    `        if (!payload.ok) return payload;`,
    `        return ok({ kind: "${variant.name}", _0: payload.value ?? ${variantPayloadDefault(variant.payload)} });`,
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

const planDecl = (decls: readonly ResolvedDecl[], decl: ResolvedDecl): Result<DeclPlan | null, Diagnostic[]> => {
  if (decl.generics.length > 0) {
    return err(diag(`tdbin-ts: generic decl '${decl.name}' must be monomorphized before codec generation`));
  }
  if (decl.kind === "record") {
    const plan = classifyRecord(decls, decl);
    return plan.ok ? ok({ kind: "record", decl, plan: plan.value }) : plan;
  }
  if (decl.kind === "union") {
    const plan = classifyUnion(decl);
    return plan.ok ? ok({ kind: "union", decl, plan: plan.value }) : plan;
  }
  return ok(null);
};

const planDecls = (model: Model): Result<DeclPlan[], Diagnostic[]> => {
  const plans: DeclPlan[] = [];
  for (const decl of visibleDeclsForTarget(model.decls, "typescript")) {
    const planned = planDecl(model.decls, decl);
    if (!planned.ok) {
      return planned;
    }
    plans.push(...(planned.value === null ? [] : [planned.value]));
  }
  return ok(plans);
};

export const emitTypeScriptCodec = (model: Model): Result<string, Diagnostic[]> => {
  const plans = planDecls(model);
  if (!plans.ok) {
    return plans;
  }
  const defaults = emitDefaultFactories(plans.value);
  if (!defaults.ok) {
    return defaults;
  }
  const codecs = plans.value.map((plan) =>
    plan.kind === "record" ? emitRecordCodec(plan.decl, plan.plan) : emitUnionCodec(plan.decl, plan.plan)
  );
  return ok([...defaults.value, ...codecs].join("\n\n"));
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
