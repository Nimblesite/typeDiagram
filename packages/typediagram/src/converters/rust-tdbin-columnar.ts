// [CONV-RUST-TDBIN] Layout-major-2 column groups: the reachability closure
// over columnar list elements and the `impl tdbin::ColumnGroup` emission for
// every reached record/union ([TDBIN-COL-GROUP], [TDBIN-COL-PLAN],
// [TDBIN-COL-UNION]). Unknown tags fail typed WITHOUT re-verifying slots —
// every column was already visited by the reads above the tag loop.
import type { Diagnostic } from "../parser/diagnostics.js";
import type { ResolvedDecl, ResolvedRecord, ResolvedTypeRef, ResolvedUnion, ResolvedVariant } from "../model/types.js";
import { err, ok, type Result } from "../result.js";
import {
  classifyUnion,
  declaredRecord,
  declaredUnion,
  diag,
  isEnumUnion,
  isFieldError,
  listInnerOf,
  optionInnerOf,
  rsNumber,
  type UnionPlan,
  variantPayloadType,
} from "./rust-tdbin-plan.js";
import { type ColPlan, colSlots, type ColumnRead, columnPlans, readColumn, writeColumn } from "./rust-tdbin-columns.js";

const TAG_VARIANT_LIMIT = 256;

// ── Reachability ([TDBIN-COL-POLICY]) ──

type GroupDecl = ResolvedRecord | ResolvedUnion;

/** The record/mixed-union element decl of a columnar `List<Decl>`, if any. */
const columnarElement = (decls: readonly ResolvedDecl[], inner: ResolvedTypeRef): GroupDecl[] => {
  const rec = declaredRecord(decls, inner);
  if (rec !== undefined) {
    return [rec];
  }
  const union = declaredUnion(decls, inner);
  return union !== undefined && !isEnumUnion(union) ? [union] : [];
};

/** Seed decls contributed by one record field: `List<Decl>`/`Option<List<Decl>>`. */
const seedOf = (decls: readonly ResolvedDecl[], t: ResolvedTypeRef): GroupDecl[] => {
  const optInner = optionInnerOf(t);
  const inner = listInnerOf(t) ?? (optInner === undefined ? undefined : listInnerOf(optInner));
  return inner === undefined ? [] : columnarElement(decls, inner);
};

/** Decls a columnar element references as further column groups: direct,
 *  `Option<...>`, and nested `List<...>` record/union fields. */
const childGroupDecls = (decls: readonly ResolvedDecl[], t: ResolvedTypeRef): GroupDecl[] => {
  const target = optionInnerOf(t) ?? listInnerOf(t) ?? t;
  const d = declaredRecord(decls, target) ?? declaredUnion(decls, target);
  return d === undefined ? [] : [d];
};

const variantChildDecls = (decls: readonly ResolvedDecl[], v: ResolvedVariant): GroupDecl[] => {
  const single = variantPayloadType(v);
  return single === undefined ? [] : childGroupDecls(decls, single);
};

const expandDecl = (decls: readonly ResolvedDecl[], d: GroupDecl): GroupDecl[] =>
  d.kind === "record"
    ? d.fields.flatMap((f) => childGroupDecls(decls, f.type))
    : d.variants.flatMap((v) => variantChildDecls(decls, v));

/** Every record/union transitively reachable as a columnar element: seeded by
 *  `List<Decl>` fields, closed over record/Option/union/payload/nested-list
 *  references ([TDBIN-COL-PLAN], [TDBIN-COL-UNION]). */
export const columnarReachable = (decls: readonly ResolvedDecl[], visible: readonly ResolvedDecl[]): Set<string> => {
  const reached = new Set<string>();
  const queue = visible
    .filter((d): d is ResolvedRecord => d.kind === "record")
    .flatMap((rec) => rec.fields.flatMap((f) => seedOf(decls, f.type)));
  for (let next = queue.pop(); next !== undefined; next = queue.pop()) {
    if (!reached.has(next.name)) {
      reached.add(next.name);
      queue.push(...expandDecl(decls, next));
    }
  }
  return reached;
};

// ── Group impl assembly ──

const groupImpl = (name: string, columns: number, writeBody: string[], readBody: string[]): string =>
  [
    `impl tdbin::ColumnGroup for ${name} {`,
    `    const COLUMNS: u16 = ${rsNumber(columns)};`,
    ``,
    `    fn write_group<'v, I>(items: I, count: usize, w: &mut tdbin::Writer, at: usize) -> Result<(), tdbin::EncodeError>`,
    `    where`,
    `        I: Iterator<Item = &'v Self> + Clone,`,
    `        Self: 'v,`,
    `    {`,
    ...writeBody,
    `    }`,
    ``,
    `    fn read_group(r: &tdbin::Reader<'_>, at: usize, count: usize) -> Result<Vec<Self>, tdbin::DecodeError> {`,
    ...readBody,
    `    }`,
    `}`,
  ].join("\n");

// ── Record groups ──

interface RecordColumn {
  name: string;
  slot: number;
  plan: ColPlan;
  read: ColumnRead;
}

const recordColumns = (decls: readonly ResolvedDecl[], rec: ResolvedRecord): Result<RecordColumn[], Diagnostic[]> => {
  const columns = columnPlans(decls, rec);
  return isFieldError(columns)
    ? err(diag(columns.error))
    : ok(columns.map((c) => ({ ...c, read: readColumn(c.name, c.slot, c.plan) })));
};

const recordReadBody = (columns: RecordColumn[]): string[] => {
  const index = columns.some((c) => c.read.usesIndex) ? "i" : "_";
  return [
    ...columns.flatMap((c) => c.read.prelude),
    `        let mut rows = Vec::with_capacity(count);`,
    `        for ${index} in 0..count {`,
    ...columns.flatMap((c) => c.read.rowPrelude),
    `            rows.push(Self {`,
    ...columns.map((c) => `                ${c.name}: ${c.read.expr},`),
    `            });`,
    `        }`,
    `        Ok(rows)`,
  ];
};

const emitRecordGroup = (decls: readonly ResolvedDecl[], rec: ResolvedRecord): Result<string, Diagnostic[]> => {
  if (rec.fields.length === 0) {
    return err(diag(`tdbin: empty record '${rec.name}' cannot form a column group`));
  }
  const columns = recordColumns(decls, rec);
  if (!columns.ok) {
    return columns;
  }
  const total = columns.value.reduce((sum, c) => sum + colSlots(c.plan), 0);
  const writeBody = [...columns.value.flatMap((c) => writeColumn(c.name, c.slot, c.plan)), `        Ok(())`];
  return ok(groupImpl(rec.name, total, writeBody, recordReadBody(columns.value)));
};

// ── Union groups ([TDBIN-COL-UNION]) ──

type UnionVariant = UnionPlan["variants"][number];

/** A union variant with its allocated payload slot and snake_case local name. */
export interface UnionColumn extends UnionVariant {
  slot: number;
  local: string;
}

type PayloadColumn = UnionColumn & { payload: Exclude<UnionVariant["payload"], null> };

const hasPayload = (v: UnionColumn): v is PayloadColumn => v.payload !== null;

const snake = (name: string): string => name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();

/** Column slots a variant's payload occupies ([TDBIN-COL-UNION]). */
export const payloadSlots = (v: UnionVariant): number => (v.payload === null ? 0 : v.payload.kind === "child" ? 1 : 2);

/** Per-variant payload column slots, allocated after the tag column at slot 0. */
export const unionColumns = (plan: UnionPlan): UnionColumn[] => {
  let slot = 1;
  return plan.variants.map((v) => {
    const at = slot;
    slot = slot + payloadSlots(v);
    return { ...v, slot: at, local: snake(v.name) };
  });
};

const variantPattern = (v: UnionVariant, bind: string): string =>
  v.payload === null ? `Self::${v.name}` : `Self::${v.name}(${bind})`;

const tagArms = (variants: UnionColumn[]): string[] =>
  variants.map((v) => `            ${variantPattern(v, "_")} => ${rsNumber(v.ordinal)}_u8,`);

/** The active variant binds its payload; every other variant folds into ONE
 *  or-pattern arm so multi-variant unions stay `match_same_arms`-clean. */
const payloadFilterArms = (variants: UnionColumn[], active: PayloadColumn): string[] => {
  const activeArm = `            ${variantPattern(active, "payload")} => Some(payload),`;
  const others = variants
    .filter((v) => v.ordinal !== active.ordinal)
    .map((v) => variantPattern(v, "_"))
    .join(" | ");
  return others === "" ? [activeArm] : [activeArm, `            ${others} => None,`];
};

/** Partition ONCE per payload variant: materialize the dense ref vector, then
 *  stream it into the column — never re-scan the full item list per column. */
const writePayloadColumn = (variants: UnionColumn[], v: PayloadColumn): string[] => {
  const vecType = v.payload.kind === "string" ? "Vec<&String>" : `Vec<&${v.payload.rustType}>`;
  const call =
    v.payload.kind === "string"
      ? `        w.var_column(at, 1, ${rsNumber(v.slot)}, ${rsNumber(v.slot + 1)}, ${v.local}.len(), ${v.local}.iter().copied().map(String::as_bytes))?;`
      : `        w.dense_group(at, 1, ${rsNumber(v.slot)}, ${v.local}.len(), ${v.local}.iter().copied())?;`;
  return [
    `        let ${v.local}: ${vecType} = items.clone().filter_map(|row| match row {`,
    ...payloadFilterArms(variants, v),
    `        }).collect();`,
    call,
  ];
};

const unionWriteBody = (variants: UnionColumn[]): string[] => [
  `        w.byte_column(at, 1, 0, count, items.clone().map(|row| match row {`,
  ...tagArms(variants),
  `        }))?;`,
  ...variants.filter(hasPayload).flatMap((v) => writePayloadColumn(variants, v)),
  `        Ok(())`,
];

const readPayloadPrelude = (v: PayloadColumn): string[] => {
  const source =
    v.payload.kind === "string"
      ? `r.var_column(at, ${rsNumber(v.slot)}, ${rsNumber(v.slot + 1)}, ${v.local}_count)?.into_strings()?`
      : `r.dense_group::<${v.payload.rustType}>(at, ${rsNumber(v.slot)}, ${v.local}_count)?`;
  return [
    `        let ${v.local}_count = tags.iter().map(|tag| usize::from(*tag == ${rsNumber(v.ordinal)})).sum::<usize>();`,
    `        let mut ${v.local} = ${source}.into_iter();`,
  ];
};

const readTagArm = (v: UnionColumn): string =>
  v.payload === null
    ? `                ${rsNumber(v.ordinal)} => Self::${v.name},`
    : `                ${rsNumber(v.ordinal)} => Self::${v.name}(${v.local}.next().ok_or(tdbin::DecodeError::MalformedColumn)?),`;

const unionReadBody = (variants: UnionColumn[]): string[] => [
  `        let tags = r.byte_column(at, 0, count)?;`,
  ...variants.filter(hasPayload).flatMap(readPayloadPrelude),
  `        let mut rows = Vec::with_capacity(count);`,
  `        for tag in tags {`,
  `            rows.push(match tag {`,
  ...variants.map(readTagArm),
  `                ordinal => {`,
  `                    return Err(tdbin::DecodeError::UnknownVariant { ordinal: u64::from(ordinal) });`,
  `                }`,
  `            });`,
  `        }`,
  `        Ok(rows)`,
];

const emitUnionGroup = (u: ResolvedUnion): Result<string, Diagnostic[]> => {
  if (u.variants.length > TAG_VARIANT_LIMIT) {
    return err(diag(`tdbin: union '${u.name}' exceeds 256 variants, so layout 2 cannot encode its tag column`));
  }
  const plan = classifyUnion(u);
  if (!plan.ok) {
    return plan;
  }
  const variants = unionColumns(plan.value);
  const columns = 1 + variants.reduce((sum, v) => sum + payloadSlots(v), 0);
  return ok(groupImpl(u.name, columns, unionWriteBody(variants), unionReadBody(variants)));
};

/** Emit `impl tdbin::ColumnGroup` for one columnar-reachable record or union. */
export const emitColumnGroup = (
  decls: readonly ResolvedDecl[],
  d: ResolvedRecord | ResolvedUnion
): Result<string, Diagnostic[]> => (d.kind === "record" ? emitRecordGroup(decls, d) : emitUnionGroup(d));
