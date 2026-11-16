// [CONV-RUST-TDBIN] Column-group field emission for layout major 2: classify a
// record field into its column plan (slots allocated in declaration order,
// [TDBIN-COL-PLAN]) and emit the per-column write/read code inside a generated
// `impl tdbin::ColumnGroup` ([TDBIN-COL-VAR], [TDBIN-COL-VALIDITY]).
import type { ResolvedDecl, ResolvedRecord, ResolvedTypeRef } from "../model/types.js";
import { printTypeRef } from "./parse-typeref.js";
import { mapTdToRs } from "./rust.js";
import { bytes16Source, bytes16Value, dateTimeResult } from "./rust-tdbin-fields.js";
import {
  type Bytes16Semantic,
  declaredRecord,
  declaredUnion,
  type FieldError,
  isFieldError,
  isPrim,
  listInnerOf,
  optionInnerOf,
  rsNumber,
  semanticOf,
} from "./rust-tdbin-plan.js";

export type VarInto = "into_strings" | "into_byte_vecs";
type WordCol = "i64_column" | "f64_column";

export type NestedPlan =
  | { kind: "bit" }
  | { kind: "word"; col: WordCol }
  | { kind: "dateTime" }
  | { kind: "bytes16"; semantic: Bytes16Semantic }
  | { kind: "var"; into: VarInto }
  | { kind: "group"; rustType: string };

export type ColPlan =
  | { kind: "bit" }
  | { kind: "word"; col: WordCol }
  | { kind: "dateTime" }
  | { kind: "bytes16"; semantic: Bytes16Semantic }
  | { kind: "var"; into: VarInto }
  | { kind: "optVar"; into: VarInto }
  | { kind: "optBit" }
  | { kind: "optWord"; col: WordCol }
  | { kind: "optDateTime" }
  | { kind: "group"; rustType: string }
  | { kind: "optGroup"; rustType: string }
  | { kind: "nested"; inner: NestedPlan };

/** Everything a field contributes to `read_group`: statements before the row
 *  loop, statements inside it, and the row expression itself. */
export interface ColumnRead {
  prelude: string[];
  rowPrelude: string[];
  expr: string;
  usesIndex: boolean;
}

const MALFORMED = "tdbin::DecodeError::MalformedColumn";

/** `Int` VALUE columns take the frame-of-reference delta block form at
 *  layout 2 ([TDBIN-COL-INTBLOCK]); Float, DateTime, and `Option<Int>`
 *  validity/value pairs stay plain word columns. */
const valueCol = (col: WordCol): string => (col === "i64_column" ? "i64_block_column" : "f64_column");

const nestedSlots = (p: NestedPlan): number => (p.kind === "var" ? 2 : 1);

/** Pointer slots a column plan occupies in the group ([TDBIN-COL-PLAN]). */
export const colSlots = (p: ColPlan): number => {
  switch (p.kind) {
    case "bit":
    case "word":
    case "dateTime":
    case "bytes16":
    case "group":
      return 1;
    case "var":
    case "optBit":
    case "optWord":
    case "optDateTime":
    case "optGroup":
      return 2;
    case "optVar":
      return 3;
    case "nested":
      return 1 + nestedSlots(p.inner);
  }
};

const noColumnError = (t: string): FieldError => ({
  error: `tdbin: field type '${t}' has no columnar encoding under layout 2`,
});

const wordColOf = (t: ResolvedTypeRef): WordCol | undefined =>
  isPrim(t, "Int") ? "i64_column" : isPrim(t, "Float") ? "f64_column" : undefined;

const varIntoOf = (t: ResolvedTypeRef): VarInto | undefined =>
  isPrim(t, "String") ? "into_strings" : isPrim(t, "Bytes") ? "into_byte_vecs" : undefined;

const groupTypeOf = (decls: readonly ResolvedDecl[], t: ResolvedTypeRef): string | undefined =>
  declaredRecord(decls, t) !== undefined || declaredUnion(decls, t) !== undefined ? mapTdToRs(t) : undefined;

const optColPlan = (decls: readonly ResolvedDecl[], inner: ResolvedTypeRef): ColPlan | FieldError => {
  const word = wordColOf(inner);
  const into = varIntoOf(inner);
  const group = groupTypeOf(decls, inner);
  return isPrim(inner, "Bool")
    ? { kind: "optBit" }
    : word !== undefined
      ? { kind: "optWord", col: word }
      : semanticOf(inner) === "DateTime"
        ? { kind: "optDateTime" }
        : into !== undefined
          ? { kind: "optVar", into }
          : group !== undefined
            ? { kind: "optGroup", rustType: group }
            : noColumnError(`Option<${printTypeRef(inner)}>`);
};

const nestedPlanFor = (decls: readonly ResolvedDecl[], inner: ResolvedTypeRef): NestedPlan | FieldError => {
  const word = wordColOf(inner);
  const semantic = semanticOf(inner);
  const into = varIntoOf(inner);
  const group = groupTypeOf(decls, inner);
  return isPrim(inner, "Bool")
    ? { kind: "bit" }
    : word !== undefined
      ? { kind: "word", col: word }
      : semantic === "DateTime"
        ? { kind: "dateTime" }
        : semantic !== undefined
          ? { kind: "bytes16", semantic }
          : into !== undefined
            ? { kind: "var", into }
            : group !== undefined
              ? { kind: "group", rustType: group }
              : noColumnError(`List<${printTypeRef(inner)}>`);
};

/** Classify one field of a columnar record into its column plan. */
export const colPlanFor = (decls: readonly ResolvedDecl[], t: ResolvedTypeRef): ColPlan | FieldError => {
  const word = wordColOf(t);
  const semantic = semanticOf(t);
  const into = varIntoOf(t);
  const optionInner = optionInnerOf(t);
  const listInner = listInnerOf(t);
  if (isPrim(t, "Bool")) {
    return { kind: "bit" };
  }
  if (word !== undefined) {
    return { kind: "word", col: word };
  }
  if (into !== undefined) {
    return { kind: "var", into };
  }
  if (semantic !== undefined) {
    return semantic === "DateTime" ? { kind: "dateTime" } : { kind: "bytes16", semantic };
  }
  if (optionInner !== undefined) {
    return optColPlan(decls, optionInner);
  }
  if (listInner !== undefined) {
    const inner = nestedPlanFor(decls, listInner);
    return isFieldError(inner) ? inner : { kind: "nested", inner };
  }
  const group = groupTypeOf(decls, t);
  return group !== undefined ? { kind: "group", rustType: group } : noColumnError(printTypeRef(t));
};

// ── Write emission ──

const W = "        ";

const validityLine = (f: string, k: number): string =>
  `${W}w.bit_column(at, 1, ${rsNumber(k)}, count, items.clone().map(|row| row.${f}.is_some()))?;`;

const varRowBytes = (value: string, into: VarInto): string =>
  into === "into_strings" ? `${value}.as_bytes()` : `${value}.as_slice()`;

/** Method paths keep flat-mapped closures clippy-clean (see columns.rs). */
const varFlatMap = (into: VarInto): string => (into === "into_strings" ? "String::as_bytes" : "Vec::as_slice");

const optVarRowBytes = (f: string, into: VarInto): string =>
  into === "into_strings"
    ? `row.${f}.as_deref().unwrap_or_default().as_bytes()`
    : `row.${f}.as_deref().unwrap_or_default()`;

const writeNestedValue = (f: string, k: number, p: NestedPlan): string => {
  const flat = `items.clone().flat_map(|row| row.${f}.iter())`;
  switch (p.kind) {
    case "bit":
      return `${W}w.bit_column(at, 1, ${rsNumber(k + 1)}, ${f}_total, ${flat}.copied())?;`;
    case "word":
      return `${W}w.${valueCol(p.col)}(at, 1, ${rsNumber(k + 1)}, ${f}_total, ${flat}.copied())?;`;
    case "dateTime":
      return `${W}w.i64_column(at, 1, ${rsNumber(k + 1)}, ${f}_total, ${flat}.map(chrono::DateTime::timestamp_micros))?;`;
    case "bytes16":
      return `${W}w.bytes16_column(at, 1, ${rsNumber(k + 1)}, ${f}_total, ${flat}.map(|value| tdbin::scalar::bytes16_words(${bytes16Source(p.semantic, "value")})))?;`;
    case "var":
      return `${W}w.var_column(at, 1, ${rsNumber(k + 1)}, ${rsNumber(k + 2)}, ${f}_total, ${flat}.map(${varFlatMap(p.into)}))?;`;
    case "group":
      return `${W}w.dense_group(at, 1, ${rsNumber(k + 1)}, ${f}_total, ${flat})?;`;
  }
};

const writeNested = (f: string, k: number, p: NestedPlan): string[] => [
  `${W}let ${f}_counts = items.clone().map(|row| u32::try_from(row.${f}.len())).collect::<Result<Vec<_>, _>>().map_err(|_| tdbin::EncodeError::LimitExceeded)?;`,
  `${W}w.len_column(at, 1, ${rsNumber(k)}, &${f}_counts)?;`,
  `${W}let ${f}_total = items.clone().map(|row| row.${f}.len()).try_fold(0_usize, usize::checked_add).ok_or(tdbin::EncodeError::LimitExceeded)?;`,
  writeNestedValue(f, k, p),
];

/** Partition ONCE: the validity bits and the dense group both come from a
 *  single materialized ref vector — never a second full-list scan. */
const writeOptGroup = (f: string, k: number, p: Extract<ColPlan, { kind: "optGroup" }>): string[] => [
  validityLine(f, k),
  `${W}let ${f}: Vec<&${p.rustType}> = items.clone().filter_map(|row| row.${f}.as_ref()).collect();`,
  `${W}w.dense_group(at, 1, ${rsNumber(k + 1)}, ${f}.len(), ${f}.iter().copied())?;`,
];

const writeOptColumn = (
  f: string,
  k: number,
  p: Extract<ColPlan, { kind: "optBit" | "optWord" | "optDateTime" | "optVar" }>
): string[] => {
  switch (p.kind) {
    case "optBit":
      return [
        validityLine(f, k),
        `${W}w.bit_column(at, 1, ${rsNumber(k + 1)}, count, items.clone().map(|row| row.${f}.unwrap_or_default()))?;`,
      ];
    case "optWord":
      return [
        validityLine(f, k),
        `${W}w.${p.col}(at, 1, ${rsNumber(k + 1)}, count, items.clone().map(|row| row.${f}.unwrap_or_default()))?;`,
      ];
    case "optDateTime":
      return [
        validityLine(f, k),
        `${W}w.i64_column(at, 1, ${rsNumber(k + 1)}, count, items.clone().map(|row| row.${f}.map_or(0, |value| value.timestamp_micros())))?;`,
      ];
    case "optVar":
      return [
        validityLine(f, k),
        `${W}w.var_column(at, 1, ${rsNumber(k + 1)}, ${rsNumber(k + 2)}, count, items.clone().map(|row| ${optVarRowBytes(f, p.into)}))?;`,
      ];
  }
};

/** Emit the write statements for one column-planned field at base slot `k`. */
export const writeColumn = (f: string, k: number, p: ColPlan): string[] => {
  switch (p.kind) {
    case "bit":
      return [`${W}w.bit_column(at, 1, ${rsNumber(k)}, count, items.clone().map(|row| row.${f}))?;`];
    case "word":
      return [`${W}w.${valueCol(p.col)}(at, 1, ${rsNumber(k)}, count, items.clone().map(|row| row.${f}))?;`];
    case "dateTime":
      return [`${W}w.i64_column(at, 1, ${rsNumber(k)}, count, items.clone().map(|row| row.${f}.timestamp_micros()))?;`];
    case "bytes16":
      return [
        `${W}w.bytes16_column(at, 1, ${rsNumber(k)}, count, items.clone().map(|row| tdbin::scalar::bytes16_words(${bytes16Source(p.semantic, `row.${f}`)})))?;`,
      ];
    case "var":
      return [
        `${W}w.var_column(at, 1, ${rsNumber(k)}, ${rsNumber(k + 1)}, count, items.clone().map(|row| ${varRowBytes(`row.${f}`, p.into)}))?;`,
      ];
    case "group":
      return [`${W}w.dense_group(at, 1, ${rsNumber(k)}, count, items.clone().map(|row| &row.${f}))?;`];
    case "optGroup":
      return writeOptGroup(f, k, p);
    case "nested":
      return writeNested(f, k, p.inner);
    default:
      return writeOptColumn(f, k, p);
  }
};

// ── Read emission ──

const nextRow = (iter: string): string => `${iter}.next().ok_or(${MALFORMED})?`;

const getRow = (vec: string): string => `${vec}.get(i).copied().unwrap_or_default()`;

const bytes16Collect = (semantic: Bytes16Semantic, call: string): string =>
  `${call}.into_iter().map(|(lo, hi)| ${bytes16Value(semantic, "tdbin::scalar::bytes16_from_words(lo, hi)")}).collect::<Vec<_>>()`;

const zipValidity = (f: string, values: string): string =>
  `${W}let mut ${f} = ${f}_valid.into_iter().zip(${values}).map(|(valid, value)| valid.then_some(value));`;

const readOptScalarColumn = (f: string, k: number, valueCall: string): ColumnRead => ({
  prelude: [
    `${W}let ${f}_valid = r.bit_column(at, ${rsNumber(k)}, count)?;`,
    `${W}let ${f}_values = ${valueCall};`,
    zipValidity(f, `${f}_values`),
  ],
  rowPrelude: [],
  expr: nextRow(f),
  usesIndex: false,
});

const readOptDateTime = (f: string, k: number): ColumnRead => ({
  prelude: [
    `${W}let ${f}_valid = r.bit_column(at, ${rsNumber(k)}, count)?;`,
    `${W}let ${f}_values = r.i64_column(at, ${rsNumber(k + 1)}, count)?;`,
    `${W}let ${f}_rows = ${f}_valid.into_iter().zip(${f}_values).map(|(valid, value)| valid.then(|| ${dateTimeResult("value")}).transpose()).collect::<Result<Vec<_>, _>>()?;`,
    `${W}let mut ${f} = ${f}_rows.into_iter();`,
  ],
  rowPrelude: [],
  expr: nextRow(f),
  usesIndex: false,
});

const readOptGroup = (f: string, k: number, rustType: string): ColumnRead => ({
  prelude: [
    `${W}let ${f}_valid = r.bit_column(at, ${rsNumber(k)}, count)?;`,
    `${W}let ${f}_count = ${f}_valid.iter().filter(|present| **present).count();`,
    `${W}let mut ${f} = r.dense_group::<${rustType}>(at, ${rsNumber(k + 1)}, ${f}_count)?.into_iter();`,
  ],
  rowPrelude: [],
  expr: `${f}_valid.get(i).copied().unwrap_or_default().then(|| ${nextRow(f).slice(0, -1)}).transpose()?`,
  usesIndex: true,
});

const nestedFlatPrelude = (f: string, k: number, p: NestedPlan): string[] => {
  switch (p.kind) {
    case "bit":
      return [`${W}let mut ${f} = r.bit_column(at, ${rsNumber(k + 1)}, ${f}_total)?.into_iter();`];
    case "word":
      return [`${W}let mut ${f} = r.${valueCol(p.col)}(at, ${rsNumber(k + 1)}, ${f}_total)?.into_iter();`];
    case "dateTime":
      return [
        `${W}let ${f}_flat = r.i64_column(at, ${rsNumber(k + 1)}, ${f}_total)?.into_iter().map(|value| ${dateTimeResult("value")}).collect::<Result<Vec<_>, _>>()?;`,
        `${W}let mut ${f} = ${f}_flat.into_iter();`,
      ];
    case "bytes16":
      return [
        `${W}let ${f}_flat = ${bytes16Collect(p.semantic, `r.bytes16_column(at, ${rsNumber(k + 1)}, ${f}_total)?`)};`,
        `${W}let mut ${f} = ${f}_flat.into_iter();`,
      ];
    case "var":
      return [
        `${W}let mut ${f} = r.var_column(at, ${rsNumber(k + 1)}, ${rsNumber(k + 2)}, ${f}_total)?.${p.into}()?.into_iter();`,
      ];
    case "group":
      return [`${W}let mut ${f} = r.dense_group::<${p.rustType}>(at, ${rsNumber(k + 1)}, ${f}_total)?.into_iter();`];
  }
};

const readNested = (f: string, k: number, p: NestedPlan): ColumnRead => ({
  prelude: [
    `${W}let ${f}_counts = r.len_column(at, ${rsNumber(k)}, count)?;`,
    `${W}let ${f}_total = tdbin::column_total(&${f}_counts)?;`,
    ...nestedFlatPrelude(f, k, p),
  ],
  rowPrelude: [
    `            let ${f}_take = usize::try_from(${f}_counts.get(i).copied().unwrap_or(0)).map_err(|_| tdbin::DecodeError::LimitExceeded)?;`,
  ],
  expr: `(0..${f}_take).map(|_| ${f}.next().ok_or(${MALFORMED})).collect::<Result<Vec<_>, _>>()?`,
  usesIndex: true,
});

const indexedVec = (prelude: string[], f: string, expr?: string): ColumnRead => ({
  prelude,
  rowPrelude: [],
  expr: expr ?? getRow(f),
  usesIndex: true,
});

const iterated = (prelude: string[], f: string): ColumnRead => ({
  prelude,
  rowPrelude: [],
  expr: nextRow(f),
  usesIndex: false,
});

/** Emit the read plan for one column-planned field at base slot `k`. */
export const readColumn = (f: string, k: number, p: ColPlan): ColumnRead => {
  switch (p.kind) {
    case "bit":
      return indexedVec([`${W}let ${f} = r.bit_column(at, ${rsNumber(k)}, count)?;`], f);
    case "word":
      return indexedVec([`${W}let ${f} = r.${valueCol(p.col)}(at, ${rsNumber(k)}, count)?;`], f);
    case "dateTime":
      return indexedVec(
        [`${W}let ${f} = r.i64_column(at, ${rsNumber(k)}, count)?;`],
        f,
        `${dateTimeResult(getRow(f))}?`
      );
    case "bytes16":
      return indexedVec(
        [`${W}let ${f} = ${bytes16Collect(p.semantic, `r.bytes16_column(at, ${rsNumber(k)}, count)?`)};`],
        f
      );
    case "var":
      return iterated(
        [`${W}let mut ${f} = r.var_column(at, ${rsNumber(k)}, ${rsNumber(k + 1)}, count)?.${p.into}()?.into_iter();`],
        f
      );
    case "optVar":
      return readOptScalarColumn(f, k, `r.var_column(at, ${rsNumber(k + 1)}, ${rsNumber(k + 2)}, count)?.${p.into}()?`);
    case "optBit":
      return readOptScalarColumn(f, k, `r.bit_column(at, ${rsNumber(k + 1)}, count)?`);
    case "optWord":
      return readOptScalarColumn(f, k, `r.${p.col}(at, ${rsNumber(k + 1)}, count)?`);
    case "optDateTime":
      return readOptDateTime(f, k);
    case "group":
      return iterated(
        [`${W}let mut ${f} = r.dense_group::<${p.rustType}>(at, ${rsNumber(k)}, count)?.into_iter();`],
        f
      );
    case "optGroup":
      return readOptGroup(f, k, p.rustType);
    case "nested":
      return readNested(f, k, p.inner);
  }
};

/** One classified field of a columnar record with its base column slot. */
export interface ColumnField {
  name: string;
  slot: number;
  plan: ColPlan;
}

/** Walk a columnar record's fields in declaration order, allocating column
 *  slots per [TDBIN-COL-PLAN]. Shared by the ColumnGroup emitter and the
 *  layout-manifest renderer so slot numbering has one source of truth. */
export const columnPlans = (decls: readonly ResolvedDecl[], rec: ResolvedRecord): ColumnField[] | FieldError => {
  const columns: ColumnField[] = [];
  let slot = 0;
  for (const f of rec.fields) {
    const plan = colPlanFor(decls, f.type);
    if (isFieldError(plan)) {
      return { error: `${plan.error} in ${rec.name}.${f.name}` };
    }
    columns.push({ name: f.name, slot, plan });
    slot = slot + colSlots(plan);
  }
  return columns;
};
