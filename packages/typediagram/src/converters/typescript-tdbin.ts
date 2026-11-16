// [CONV-TS-TDBIN] Generate TypeScript TDBIN codecs that target
// `packages/typediagram/src/tdbin`. Like the Rust generator, this bakes the
// schema layout into typed codec objects instead of using reflective values on
// the hot path ([TDBIN-FUTURE-TS], [TDBIN-REC-ALLOC]).
import type { Diagnostic } from "../parser/diagnostics.js";
import {
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
import { fnv1a64, layoutManifest } from "./rust-tdbin-hash.js";
import { allocateBit, allocatePtr, allocateWord, type LayoutCursor, newLayoutCursor } from "./tdbin-alloc.js";
import {
  type DeclPlan,
  diag,
  emitDefaultFactories,
  type FieldPlan,
  pointerDefault,
  type RecordPlan,
  type UnionPlan,
  inlineVariantValue,
  variantPayloadDefault,
  type VariantPlan,
} from "./typescript-tdbin-defaults.js";
import { isInlineVariant, payloadFieldName, variantPayloadName, withVariantRecords } from "./tdbin-variant-records.js";
import type { TypeScriptOpts } from "./types.js";
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

const classifyUnion = (union: ResolvedUnion): Result<UnionPlan, Diagnostic[]> => {
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

const fieldValue = (field: string, plan: FieldPlan, options: TypeScriptOpts): string => {
  const integer =
    options.integerType === "bigint"
      ? `BigInt.asIntN(64, ${field}Word.value)`
      : `tdbin.scalar.i64From(${field}Word.value)`;
  switch (plan.kind) {
    case "int":
      return integer;
    case "float":
      return `tdbin.scalar.f64From(${field}Word.value)`;
    case "optInt":
      return `${field}Present.value ? ${integer} : undefined`;
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

const emitRecordCodec = (record: ResolvedRecord, plan: RecordPlan, hash: bigint, options: TypeScriptOpts): string => {
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
    hashLine(hash),
    `  dataWords: ${tsNum(plan.dataWords)},`,
    `  ptrWords: ${tsNum(plan.ptrWords)},`,
    `  write: (writer, at, value) => {`,
    ...writeLines,
    `    return ok(undefined);`,
    `  },`,
    `  read: (reader, at) => {`,
    ...readLines,
    ...resultNames.map((name) => `    if (!${name}.ok) return ${name};`),
    `    return ok({ ${plan.fields.map(({ name, plan: fieldPlan }) => `${name}: ${fieldValue(name, fieldPlan, options)}`).join(", ")} });`,
    `  },`,
    `};`,
  ].join("\n");
};

const writeVariantPayload = (union: string, variant: UnionPlan["variants"][number]): string => {
  const p = variant.payload;
  if (p === null) {
    return `        return disc;`;
  }
  const at = `writer, at, ${union}Codec.dataWords, 0`;
  const payload =
    p.kind === "inline"
      ? `tdbin.writer.child(${at}, ${p.typeName}Codec, { ${p.fields.map((f) => `${f.payload}: value.${f.name}`).join(", ")} })`
      : p.kind === "child"
        ? `tdbin.writer.child(${at}, ${p.typeName}Codec, value._0)`
        : `tdbin.writer.string(${at}, value._0)`;
  return `        return disc.ok ? ${payload} : disc;`;
};

const readVariantPayload = (union: string, variant: UnionPlan["variants"][number]): string[] => {
  const p = variant.payload;
  if (p === null) {
    return [
      `        const inactive = tdbin.reader.requireNullPointer(reader, at, 0);`,
      `        return inactive.ok ? ok({ kind: "${variant.name}" }) : inactive;`,
    ];
  }
  const at = `reader, at, ${union}Codec.dataWords, 0`;
  const read = p.kind === "string" ? `tdbin.reader.string(${at})` : `tdbin.reader.child(${at}, ${p.typeName}Codec)`;
  const value =
    p.kind === "inline"
      ? inlineVariantValue(variant.name, p.fields, `(payload.value ?? default${p.typeName}())`)
      : `{ kind: "${variant.name}", _0: payload.value ?? ${variantPayloadDefault(p)} }`;
  return [
    `        const payload = ${read};`,
    `        if (!payload.ok) return payload;`,
    `        return ok(${value});`,
  ];
};

const emitUnionCodec = (union: ResolvedUnion, plan: UnionPlan, hash: bigint): string =>
  [
    `export const ${union.name}Codec: tdbin.StructCodec<${union.name}> = {`,
    hashLine(hash),
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

/** `layoutHash` property: the SAME canonical manifest + FNV-1a 64 the Rust
 *  emitter pins as `LAYOUT_HASH`, so both languages advertise one identity
 *  per compatibility major ([TDBIN-SCHEMA-HASH], [TDBIN-SCHEMA-CANON]). */
const hashLine = (hash: bigint): string => `  layoutHash: 0x${hash.toString(16).padStart(16, "0")}n,`;

const layoutHashFor = (decls: readonly ResolvedDecl[], decl: ResolvedDecl): Result<bigint, Diagnostic[]> => {
  const manifest = layoutManifest(decls, decl, 1);
  return manifest.ok ? ok(fnv1a64(manifest.value)) : manifest;
};

const emitCodec = (decls: readonly ResolvedDecl[], plan: DeclPlan, options: TypeScriptOpts) => {
  const hash = layoutHashFor(decls, plan.decl);
  return !hash.ok
    ? hash
    : ok(
        plan.kind === "record"
          ? emitRecordCodec(plan.decl, plan.plan, hash.value, options)
          : emitUnionCodec(plan.decl, plan.plan, hash.value)
      );
};

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
  const decls = withVariantRecords(model.decls);
  for (const decl of withVariantRecords(visibleDeclsForTarget(model.decls, "typescript"))) {
    const planned = planDecl(decls, decl);
    if (!planned.ok) {
      return planned;
    }
    plans.push(...(planned.value === null ? [] : [planned.value]));
  }
  return ok(plans);
};

export const emitTypeScriptCodec = (model: Model, options: TypeScriptOpts = {}): Result<string, Diagnostic[]> => {
  const plans = planDecls(model);
  if (!plans.ok) {
    return plans;
  }
  const defaults = emitDefaultFactories(plans.value, options.integerType === "bigint" ? "0n" : "0");
  if (!defaults.ok) {
    return defaults;
  }
  const codecs: string[] = [];
  for (const plan of plans.value) {
    const codec = emitCodec(model.decls, plan, options);
    if (!codec.ok) {
      return codec;
    }
    codecs.push(codec.value);
  }
  return ok([...defaults.value, ...codecs].join("\n\n"));
};

export const generateTypeScriptModule = (model: Model, options: TypeScriptOpts = {}): Result<string, Diagnostic[]> => {
  const codec = emitTypeScriptCodec(model, options);
  if (!codec.ok) {
    return codec;
  }
  return ok(
    [
      `import { ok } from "typediagram-core/tdbin";`,
      `import * as tdbin from "typediagram-core/tdbin";`,
      ``,
      typescript.toSource({ ...model, decls: withVariantRecords(model.decls) }, options),
      codec.value,
      ``,
    ].join("\n")
  );
};
