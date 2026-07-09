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
  type ResolvedField,
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
  | { kind: "string"; slot: number; optional: boolean }
  | { kind: "bytes"; slot: number; optional: boolean }
  | { kind: "child"; slot: number; optional: boolean; rustType: string };

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

const diag = (message: string): Diagnostic[] => [{ severity: "error", message, line: 0, col: 0, length: 0 }];

const isPrim = (t: ResolvedTypeRef, name: string): boolean =>
  t.name === name && t.resolution.kind === "primitive" && t.args.length === 0;

const isDeclared = (t: ResolvedTypeRef): boolean => t.resolution.kind === "declared";

/** Classify a pointer-typed inner (String/Bytes/declared) for `Option<T>`. */
const pointerInner = (t: ResolvedTypeRef, slot: number, optional: boolean): FieldPlan | null =>
  isPrim(t, "String")
    ? { kind: "string", slot, optional }
    : isPrim(t, "Bytes")
      ? { kind: "bytes", slot, optional }
      : isDeclared(t)
        ? { kind: "child", slot, optional, rustType: mapTdToRs(t) }
        : null;

/** Classify one record field into a scalar or pointer plan. */
const classifyField = (t: ResolvedTypeRef, dataSlot: number, ptrSlot: number): { plan: FieldPlan; dataSlot: number; ptrSlot: number } | null => {
  const scalar = t.args.length === 0 && t.resolution.kind === "primitive" ? SCALARS[t.name] : undefined;
  if (scalar !== undefined) {
    return { plan: { kind: "scalar", slot: dataSlot, bits: scalar.bits, from: scalar.from }, dataSlot: dataSlot + 1, ptrSlot };
  }
  const optionInner = t.name === "Option" && t.args.length === 1 ? t.args[0] : undefined;
  const plan = optionInner !== undefined ? pointerInner(optionInner, ptrSlot, true) : pointerInner(t, ptrSlot, false);
  return plan === null ? null : { plan, dataSlot, ptrSlot: ptrSlot + 1 };
};

const classifyRecord = (rec: ResolvedRecord): Result<RecordPlan, Diagnostic[]> => {
  let dataSlot = 0;
  let ptrSlot = 0;
  const fields: Array<{ name: string; plan: FieldPlan }> = [];
  for (const f of rec.fields) {
    const c = classifyField(f.type, dataSlot, ptrSlot);
    if (c === null) {
      return err(diag(`tdbin: unsupported field type '${printTypeRef(f.type)}' in ${rec.name}.${f.name}`));
    }
    fields.push({ name: f.name, plan: c.plan });
    dataSlot = c.dataSlot;
    ptrSlot = c.ptrSlot;
  }
  return ok({ dataWords: dataSlot, ptrWords: ptrSlot, fields });
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

const writeField = (name: string, p: FieldPlan): string => {
  const self = `self.${name}`;
  switch (p.kind) {
    case "scalar":
      return `        w.scalar(at, ${p.slot}, tdbin::scalar::${p.bits}(${self}))?;`;
    case "string":
      return `        w.string(at, Self::DATA_WORDS, ${p.slot}, ${p.optional ? `${self}.as_deref()` : `Some(&${self})`})?;`;
    case "bytes":
      return `        w.bytes(at, Self::DATA_WORDS, ${p.slot}, ${p.optional ? `${self}.as_deref()` : `Some(&${self})`})?;`;
    case "child":
      return `        w.child(at, Self::DATA_WORDS, ${p.slot}, ${p.optional ? `${self}.as_ref()` : `Some(&${self})`})?;`;
  }
};

/** Tail after a `Result<Option<_>, _>` reader: keep the `Option` when the field
 *  is optional, else unwrap it or fail with `UnexpectedNull`. */
const optTail = (optional: boolean): string => (optional ? "?" : "?.ok_or(tdbin::DecodeError::UnexpectedNull)?");

const readField = (name: string, p: FieldPlan): string => {
  switch (p.kind) {
    case "scalar":
      return `        let ${name} = tdbin::scalar::${p.from}(r.scalar(at, ${p.slot})?);`;
    case "string":
      return `        let ${name} = r.string(at, Self::DATA_WORDS, ${p.slot})${optTail(p.optional)};`;
    case "bytes":
      return `        let ${name} = r.bytes(at, Self::DATA_WORDS, ${p.slot})${optTail(p.optional)};`;
    case "child":
      return `        let ${name} = r.child::<${p.rustType}>(at, Self::DATA_WORDS, ${p.slot})${optTail(p.optional)};`;
  }
};

const emitRecordCodec = (rec: ResolvedRecord, plan: RecordPlan): string =>
  [
    `impl tdbin::Struct for ${rec.name} {`,
    `    const DATA_WORDS: u16 = ${plan.dataWords};`,
    `    const PTR_WORDS: u16 = ${plan.ptrWords};`,
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
    return `${head} => {\n                w.scalar(at, 0, ${v.ordinal})?;\n                Ok(())\n            }`;
  }
  const call = v.payload.kind === "child" ? `w.child(at, Self::DATA_WORDS, 0, Some(payload))` : `w.string(at, Self::DATA_WORDS, 0, Some(payload))`;
  return `${head}(payload) => {\n                w.scalar(at, 0, ${v.ordinal})?;\n                ${call}\n            }`;
};

const readVariantArm = (v: UnionPlan["variants"][number]): string => {
  const nn = "?.ok_or(tdbin::DecodeError::UnexpectedNull)?";
  if (v.payload === null) {
    return `            ${v.ordinal} => Ok(Self::${v.name}),`;
  }
  const read = v.payload.kind === "child" ? `r.child::<${v.payload.rustType}>(at, Self::DATA_WORDS, 0)${nn}` : `r.string(at, Self::DATA_WORDS, 0)${nn}`;
  return `            ${v.ordinal} => Ok(Self::${v.name}(${read})),`;
};

const emitUnionCodec = (u: ResolvedUnion, plan: UnionPlan): string =>
  [
    `impl tdbin::Struct for ${u.name} {`,
    `    const DATA_WORDS: u16 = 1;`,
    `    const PTR_WORDS: u16 = ${plan.ptrWords};`,
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
      const plan = classifyRecord(d);
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
