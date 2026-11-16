// [TDBIN-TS-LIST] `List<T>` / `Option<List<T>>` fields for the TypeScript TDBIN
// generator. Each element form uses the SAME wire encoding as the Rust layout-1
// emitter (rust-tdbin-plan.ts `listPlanFor`), so bytes and layout hashes match:
// Bool → bit list, Int/Float → word list, String/Bytes → pointer list,
// record/union → composite list, all-bare union → one ordinal byte each.
import type { ResolvedDecl, ResolvedTypeRef } from "../model/types.js";
import type { TsListPlan } from "./typescript-tdbin-defaults.js";

type ListField = { slot: number; optional: boolean; list: TsListPlan };

const isPrim = (t: ResolvedTypeRef, name: string): boolean =>
  t.name === name && t.resolution.kind === "primitive" && t.args.length === 0;

const PRIMS = { Bool: "bool", Int: "int", Float: "float", String: "string", Bytes: "bytes" } as const;

const primList = (t: ResolvedTypeRef): TsListPlan | null => {
  const hit = Object.entries(PRIMS).find(([name]) => isPrim(t, name));
  return hit === undefined ? null : { kind: hit[1] };
};

const declList = (decls: readonly ResolvedDecl[], t: ResolvedTypeRef): TsListPlan | null => {
  const resolution = t.resolution;
  const decl = resolution.kind === "declared" ? decls.find((d) => d.name === resolution.declName) : undefined;
  return decl?.kind === "union" && decl.variants.every((v) => v.fields.length === 0)
    ? { kind: "enum", variants: decl.variants.map((v) => v.name) }
    : (decl?.kind === "record" && decl.fields.length > 0) || decl?.kind === "union"
      ? { kind: "child", typeName: decl.name }
      : null;
};

/** The list plan for `List<T>` (or `null` when `t` is not a supported list). */
export const listPlanOf = (decls: readonly ResolvedDecl[], t: ResolvedTypeRef): TsListPlan | null => {
  const inner = t.name === "List" && t.args.length === 1 ? t.args[0] : undefined;
  return inner === undefined ? null : (primList(inner) ?? declList(decls, inner));
};

const names = (list: Extract<TsListPlan, { kind: "enum" }>): string => JSON.stringify(list.variants);

const at = (codec: string, slot: number): string => `writer, at, ${codec}.dataWords, ${String(slot)}`;

/** Write lines; the final binding is `${field}` (a write Result). */
export const writeListLines = (codec: string, field: string, plan: ListField): string[] => {
  const v = `value.${field}`;
  const orNull = (expr: string): string => (plan.optional ? `${v} === undefined ? null : ${expr}` : expr);
  const target = at(codec, plan.slot);
  switch (plan.list.kind) {
    case "bool":
      return [`    const ${field} = tdbin.writer.boolList(${target}, ${plan.optional ? `${v} ?? null` : v});`];
    case "int":
      return [
        `    const ${field}Words = ${plan.optional ? `${v} === undefined ? ok(null) : ` : ""}tdbin.list.i64Words(${v});`,
        `    if (!${field}Words.ok) return ${field}Words;`,
        `    const ${field} = tdbin.writer.wordList(${target}, ${field}Words.value);`,
      ];
    case "float":
      return [`    const ${field} = tdbin.writer.wordList(${target}, ${orNull(`${v}.map(tdbin.scalar.f64Bits)`)});`];
    case "string":
    case "bytes":
      return [
        `    const ${field} = tdbin.writer.${plan.list.kind}List(${target}, ${plan.optional ? `${v} ?? null` : v});`,
      ];
    case "child":
      return [
        `    const ${field} = tdbin.writer.childList(${target}, ${plan.list.typeName}Codec, ${plan.optional ? `${v} ?? null` : v});`,
      ];
    case "enum":
      return [
        `    const ${field} = tdbin.writer.byteList(${target}, ${orNull(`tdbin.list.enumOrdinals(${v}, ${names(plan.list)})`)});`,
      ];
  }
};

const READERS = { bool: "boolList", int: "wordList", float: "wordList", string: "stringList", bytes: "bytesList" };

/** Read lines; the bindings to ok-guard are returned by `listResultNames`. */
export const readListLines = (codec: string, field: string, plan: ListField): string[] => {
  const src = `reader, at, ${codec}.dataWords, ${String(plan.slot)}`;
  return plan.list.kind === "child"
    ? [`    const ${field} = tdbin.reader.childList(${src}, ${plan.list.typeName}Codec);`]
    : plan.list.kind === "enum"
      ? [
          `    const ${field}Raw = tdbin.reader.byteList(${src});`,
          `    const ${field} = ${field}Raw.ok && ${field}Raw.value !== null ? tdbin.list.enumValues(${field}Raw.value, ${names(plan.list)}) : ok(null);`,
        ]
      : [`    const ${field} = tdbin.reader.${READERS[plan.list.kind]}(${src});`];
};

export const listResultNames = (field: string, plan: ListField): string[] =>
  plan.list.kind === "enum" ? [`${field}Raw`, field] : [field];

/** The decoded field value: elements converted, null → `[]` or `undefined`. */
export const listValue = (field: string, plan: ListField, integer: (word: string) => string): string => {
  const fallback = plan.optional ? "undefined" : "[]";
  const mapped =
    plan.list.kind === "int"
      ? `.map((word) => ${integer("word")})`
      : plan.list.kind === "float"
        ? ".map(tdbin.scalar.f64From)"
        : "";
  return `${field}.value${mapped === "" ? "" : `?${mapped}`} ?? ${fallback}`;
};
