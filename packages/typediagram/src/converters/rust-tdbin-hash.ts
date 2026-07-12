// [CONV-RUST-TDBIN] Canonical layout manifests and the FNV-1a 64 layout hash
// ([TDBIN-SCHEMA-HASH], [TDBIN-SCHEMA-CANON]) pinned into every generated
// `impl tdbin::Struct` as `LAYOUT_HASH`. Two schemas with identical wire
// layouts hash identically because the manifest renders ONLY wire facts —
// never source names.
//
// ## Manifest grammar (normative for the hash)
//
// manifest   := "tdbin-layout v1 major=" ("1" | "2") entry*
// entry      := "\n" INDEX ":" (record | union)
// record     := "record d=" DATA_WORDS " p=" PTR_WORDS " [" fields? "]" cols?
// union      := "union d=1 p=" PTR_WORDS " [" variants? "]" cols?
// fields     := field (";" field)*
// variants   := variant (";" variant)*
// variant    := "unit" | "ref" INDEX "@p0" | "str@p0"
// cols       := " cols[" col (";" col)* "]"    only at layout major 2, only for
//                                              columnar-reachable entries
//
// Types are numbered by DFS preorder from the root (root = 0, fields/variants
// in declaration order), deduplicated by type identity; `refN` cites that
// numbering. Positions: `wN` = data word N, `wN.B` = bit B of bitset word N,
// `pN` = pointer slot N, `cN` = column slot N. Widths are implied by kind:
// bit = 1 bit; i64/f64/ts (DateTime micros) = one word; uuid/dec = two words;
// str/byt and their var/list forms are pointer-encoded byte lists.
//
// field      := ("i64" | "f64" | "ts") "@w" N
//             | "bit@w" N "." B
//             | ("uuid" | "dec") "@w" N                   two words at N, N+1
//             | "opt(bit@w" N "." B "," value ")"         [TDBIN-PRIM-OPTION]
//             | ("str" | "byt" | "ref" INDEX) "?"? "@p" N
//             | "list(" elem ")" "?"? "@p" N              v1 list forms
//             | "col(ref" INDEX ")" "?"? "@p" N           layout-2 column group
//             | ("vstr" | "vbyt") "@p" N                  layout-2 var pair N, N+1
// value      := ("i64" | "f64" | "ts") "@w" N | "bit@w" N "." B
//             | ("uuid" | "dec") "@w" N
// elem       := "bit" | "i64" | "f64" | "ts" | "uuid" | "dec" | "str" | "byt"
//             | "i64b"                                    Int delta block, layout 2
//             | "ref" INDEX | "en" INDEX                  enum-union byte list
// col        := "tag@c0"                                  union tag column
//             | ("bit" | "f64" | "ts" | "uuid" | "dec") "@c" K
//             | "i64b@c" K                                Int delta block column
//                                                         ([TDBIN-COL-INTBLOCK])
//             | ("var" | "vbyt") "@c" K                   two slots at K
//             | ("optbit" | "opti64" | "optf64" | "optts") "@c" K
//             | ("optvar" | "optvbyt") "@c" K             three slots at K
//             | ("grp" | "optgrp") "(ref" INDEX ")@c" K
//             | "nl(" elem ")@c" K                        nested-list columns
// [TDBIN-EVOLVE-BREAKING] [TDBIN-EVOLVE-WIDTH] any change to a frozen layout
// fact below produces a different manifest and therefore a different hash, so
// breaking releases are rejected by the framed hash guard.
import type { Diagnostic } from "../parser/diagnostics.js";
import type { ResolvedDecl, ResolvedRecord, ResolvedUnion } from "../model/types.js";
import { err, ok, type Result } from "../result.js";
import {
  classifyRecord,
  classifyUnion,
  diag,
  type FieldPlan,
  isFieldError,
  type Layout,
  type ListPlan,
  type RecordPlan,
  type UnionPlan,
} from "./rust-tdbin-plan.js";
import { columnarReachable, unionColumns } from "./rust-tdbin-columnar.js";
import { type ColPlan, columnPlans, type NestedPlan } from "./rust-tdbin-columns.js";

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const U64 = (1n << 64n) - 1n;

/** FNV-1a 64 over the UTF-8 bytes of `text` ([TDBIN-SCHEMA-HASH]). */
export const fnv1a64 = (text: string): bigint => {
  let hash = FNV_OFFSET;
  for (const byte of new TextEncoder().encode(text)) {
    hash = ((hash ^ BigInt(byte)) * FNV_PRIME) & U64;
  }
  return hash;
};

/** Render a hash as the generated Rust literal (`0x1234_5678_9abc_def0`). */
export const layoutHashLiteral = (hash: bigint): string => {
  const hex = hash.toString(16).padStart(16, "0");
  const groups = [hex.slice(0, 4), hex.slice(4, 8), hex.slice(8, 12), hex.slice(12, 16)];
  return `0x${groups.join("_")}`;
};

type Planned =
  { kind: "record"; decl: ResolvedRecord; plan: RecordPlan } | { kind: "union"; decl: ResolvedUnion; plan: UnionPlan };

interface ManifestCtx {
  decls: readonly ResolvedDecl[];
  layout: Layout;
  indices: Map<string, number>;
  order: Planned[];
}

const scalarKind = (bits: string): string => (bits === "i64_bits" ? "i64" : "f64");

const semanticKind = (semantic: "Uuid" | "Decimal"): string => (semantic === "Uuid" ? "uuid" : "dec");

const opt = (optional: boolean): string => (optional ? "?" : "");

/** Decl names a field plan references, in declaration order. */
const fieldRefNames = (p: FieldPlan): string[] =>
  p.kind === "child" || p.kind === "columnList"
    ? [p.rustType]
    : p.kind === "list" && (p.list.kind === "child" || p.list.kind === "enum")
      ? [p.list.rustType]
      : [];

const plannedRefNames = (planned: Planned): string[] =>
  planned.kind === "record"
    ? planned.plan.fields.flatMap((f) => fieldRefNames(f.plan))
    : planned.plan.variants.flatMap((v) =>
        v.payload !== null && v.payload.kind === "child" ? [v.payload.rustType] : []
      );

const planOf = (decls: readonly ResolvedDecl[], d: ResolvedDecl, layout: Layout): Result<Planned, Diagnostic[]> => {
  if (d.kind === "record") {
    const plan = classifyRecord(decls, d, layout);
    return plan.ok ? ok({ kind: "record", decl: d, plan: plan.value }) : plan;
  }
  if (d.kind === "union") {
    const plan = classifyUnion(d);
    return plan.ok ? ok({ kind: "union", decl: d, plan: plan.value }) : plan;
  }
  return err(diag(`tdbin: alias '${d.name}' cannot anchor a layout manifest`));
};

/** DFS preorder discovery: assign the next index, then recurse into refs. */
const discover = (ctx: ManifestCtx, name: string): Result<undefined, Diagnostic[]> => {
  if (ctx.indices.has(name)) {
    return ok(undefined);
  }
  const d = ctx.decls.find((candidate) => candidate.name === name);
  if (d === undefined) {
    return err(diag(`tdbin: layout manifest reference '${name}' has no declaration`));
  }
  ctx.indices.set(name, ctx.order.length);
  const planned = planOf(ctx.decls, d, ctx.layout);
  if (!planned.ok) {
    return planned;
  }
  ctx.order.push(planned.value);
  for (const ref of plannedRefNames(planned.value)) {
    const walked = discover(ctx, ref);
    if (!walked.ok) {
      return walked;
    }
  }
  return ok(undefined);
};

const refIndex = (ctx: ManifestCtx, name: string): Result<number, Diagnostic[]> => {
  const index = ctx.indices.get(name);
  return index === undefined ? err(diag(`tdbin: layout manifest reference '${name}' was never discovered`)) : ok(index);
};

const listElem = (ctx: ManifestCtx, list: ListPlan): Result<string, Diagnostic[]> => {
  switch (list.kind) {
    case "bool":
      return ok("bit");
    case "flat":
      return ok(list.method === "i64_list" ? "i64" : "f64");
    case "intBlock":
      return ok("i64b");
    case "dateTime":
      return ok("ts");
    case "bytes16":
      return ok(semanticKind(list.semantic));
    case "string":
      return ok("str");
    case "bytes":
      return ok("byt");
    case "child": {
      const index = refIndex(ctx, list.rustType);
      return index.ok ? ok(`ref${String(index.value)}`) : index;
    }
    case "enum": {
      const index = refIndex(ctx, list.rustType);
      return index.ok ? ok(`en${String(index.value)}`) : index;
    }
  }
};

const optValue = (p: FieldPlan): string => {
  switch (p.kind) {
    case "optScalar":
      return `${scalarKind(p.bits)}@w${String(p.valueSlot)}`;
    case "optBool":
      return `bit@w${String(p.valueSlot)}.${String(p.valueBit)}`;
    case "optDateTime":
      return `ts@w${String(p.valueSlot)}`;
    case "optBytes16":
      return `${semanticKind(p.semantic)}@w${String(p.valueSlot)}`;
    default:
      return "";
  }
};

const renderField = (ctx: ManifestCtx, p: FieldPlan): Result<string, Diagnostic[]> => {
  switch (p.kind) {
    case "scalar":
      return ok(`${scalarKind(p.bits)}@w${String(p.slot)}`);
    case "boolBit":
      return ok(`bit@w${String(p.slot)}.${String(p.bit)}`);
    case "dateTime":
      return ok(`ts@w${String(p.slot)}`);
    case "bytes16":
      return ok(`${semanticKind(p.semantic)}@w${String(p.slot)}`);
    case "optScalar":
    case "optBool":
    case "optDateTime":
    case "optBytes16":
      return ok(`opt(bit@w${String(p.presenceSlot)}.${String(p.presenceBit)},${optValue(p)})`);
    case "string":
      return ok(`str${opt(p.optional)}@p${String(p.slot)}`);
    case "bytes":
      return ok(`byt${opt(p.optional)}@p${String(p.slot)}`);
    case "child": {
      const index = refIndex(ctx, p.rustType);
      return index.ok ? ok(`ref${String(index.value)}${opt(p.optional)}@p${String(p.slot)}`) : index;
    }
    case "list": {
      const elem = listElem(ctx, p.list);
      return elem.ok ? ok(`list(${elem.value})${opt(p.optional)}@p${String(p.slot)}`) : elem;
    }
    case "columnList": {
      const index = refIndex(ctx, p.rustType);
      return index.ok ? ok(`col(ref${String(index.value)})${opt(p.optional)}@p${String(p.slot)}`) : index;
    }
    case "varList":
      return ok(`${p.variant === "string" ? "vstr" : "vbyt"}@p${String(p.lenSlot)}`);
  }
};

const nestedElem = (ctx: ManifestCtx, p: NestedPlan): Result<string, Diagnostic[]> => {
  switch (p.kind) {
    case "bit":
      return ok("bit");
    case "word":
      return ok(p.col === "i64_column" ? "i64b" : "f64");
    case "dateTime":
      return ok("ts");
    case "bytes16":
      return ok(semanticKind(p.semantic));
    case "var":
      return ok(p.into === "into_strings" ? "str" : "byt");
    case "group": {
      const index = refIndex(ctx, p.rustType);
      return index.ok ? ok(`ref${String(index.value)}`) : index;
    }
  }
};

const renderCol = (ctx: ManifestCtx, p: ColPlan, k: number): Result<string, Diagnostic[]> => {
  const at = `@c${String(k)}`;
  switch (p.kind) {
    case "bit":
      return ok(`bit${at}`);
    case "word":
      return ok(`${p.col === "i64_column" ? "i64b" : "f64"}${at}`);
    case "dateTime":
      return ok(`ts${at}`);
    case "bytes16":
      return ok(`${semanticKind(p.semantic)}${at}`);
    case "var":
      return ok(`${p.into === "into_strings" ? "var" : "vbyt"}${at}`);
    case "optVar":
      return ok(`${p.into === "into_strings" ? "optvar" : "optvbyt"}${at}`);
    case "optBit":
      return ok(`optbit${at}`);
    case "optWord":
      return ok(`${p.col === "i64_column" ? "opti64" : "optf64"}${at}`);
    case "optDateTime":
      return ok(`optts${at}`);
    case "group":
    case "optGroup": {
      const index = refIndex(ctx, p.rustType);
      const head = p.kind === "group" ? "grp" : "optgrp";
      return index.ok ? ok(`${head}(ref${String(index.value)})${at}`) : index;
    }
    case "nested": {
      const elem = nestedElem(ctx, p.inner);
      return elem.ok ? ok(`nl(${elem.value})${at}`) : elem;
    }
  }
};

const collect = <T>(items: Array<Result<T, Diagnostic[]>>): Result<T[], Diagnostic[]> => {
  const values: T[] = [];
  for (const item of items) {
    if (!item.ok) {
      return item;
    }
    values.push(item.value);
  }
  return ok(values);
};

const recordCols = (ctx: ManifestCtx, decl: ResolvedRecord): Result<string, Diagnostic[]> => {
  const columns = columnPlans(ctx.decls, decl);
  if (isFieldError(columns)) {
    return err(diag(columns.error));
  }
  const rendered = collect(columns.map((c) => renderCol(ctx, c.plan, c.slot)));
  return rendered.ok ? ok(` cols[${rendered.value.join(";")}]`) : rendered;
};

const unionCols = (ctx: ManifestCtx, plan: UnionPlan): Result<string, Diagnostic[]> => {
  const payloadCols = unionColumns(plan)
    .filter((v) => v.payload !== null)
    .map((v) => {
      if (v.payload?.kind !== "child") {
        return ok(`var@c${String(v.slot)}`);
      }
      const index = refIndex(ctx, v.payload.rustType);
      return index.ok ? ok(`grp(ref${String(index.value)})@c${String(v.slot)}`) : index;
    });
  const rendered = collect(payloadCols);
  return rendered.ok ? ok(` cols[${["tag@c0", ...rendered.value].join(";")}]`) : rendered;
};

const renderVariant = (ctx: ManifestCtx, v: UnionPlan["variants"][number]): Result<string, Diagnostic[]> => {
  if (v.payload === null) {
    return ok("unit");
  }
  if (v.payload.kind === "string") {
    return ok("str@p0");
  }
  const index = refIndex(ctx, v.payload.rustType);
  return index.ok ? ok(`ref${String(index.value)}@p0`) : index;
};

const renderRecordBody = (ctx: ManifestCtx, plan: RecordPlan): Result<string, Diagnostic[]> => {
  const fields = collect(plan.fields.map((f) => renderField(ctx, f.plan)));
  return fields.ok
    ? ok(`record d=${String(plan.dataWords)} p=${String(plan.ptrWords)} [${fields.value.join(";")}]`)
    : fields;
};

const renderUnionBody = (ctx: ManifestCtx, plan: UnionPlan): Result<string, Diagnostic[]> => {
  const variants = collect(plan.variants.map((v) => renderVariant(ctx, v)));
  return variants.ok ? ok(`union d=1 p=${String(plan.ptrWords)} [${variants.value.join(";")}]`) : variants;
};

const renderEntry = (ctx: ManifestCtx, planned: Planned, colSet: ReadonlySet<string>): Result<string, Diagnostic[]> => {
  const body = planned.kind === "record" ? renderRecordBody(ctx, planned.plan) : renderUnionBody(ctx, planned.plan);
  if (!body.ok) {
    return body;
  }
  const cols = !colSet.has(planned.decl.name)
    ? ok("")
    : planned.kind === "record"
      ? recordCols(ctx, planned.decl)
      : unionCols(ctx, planned.plan);
  return cols.ok ? ok(`${body.value}${cols.value}`) : cols;
};

/** The canonical layout manifest for `root` at `layout` ([TDBIN-SCHEMA-CANON]):
 *  deterministic DFS over the reachable monomorphized types, wire facts only. */
export const layoutManifest = (
  decls: readonly ResolvedDecl[],
  root: ResolvedDecl,
  layout: Layout
): Result<string, Diagnostic[]> => {
  const ctx: ManifestCtx = { decls, layout, indices: new Map(), order: [] };
  const walked = discover(ctx, root.name);
  if (!walked.ok) {
    return walked;
  }
  const colSet =
    layout === 2
      ? columnarReachable(
          decls,
          ctx.order.map((p) => p.decl)
        )
      : new Set<string>();
  const entries = collect(ctx.order.map((planned) => renderEntry(ctx, planned, colSet)));
  if (!entries.ok) {
    return entries;
  }
  const body = entries.value.map((entry, index) => `\n${String(index)}:${entry}`).join("");
  return ok(`tdbin-layout v1 major=${String(layout)}${body}`);
};
