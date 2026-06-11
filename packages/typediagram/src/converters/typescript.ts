// [CONV-TS] TypeScript <-> typeDiagram bidirectional converter.
//
// SOMEWHAT LOSSY on round-trip: TypeScript has no canonical Option type, so
// we collapse four nullable shapes into the same Option<T>:
//   T | undefined         -> Option<T>
//   T | null              -> Option<T>
//   T | undefined | null  -> Option<T>
//   T | null | undefined  -> Option<T>
// On emit we always print `T | undefined`. A `T | undefined | null` input
// therefore becomes `T | undefined` after a full TS -> TD -> TS round-trip.
// TODO: revisit — a future option could let the user pick the emit shape, or
// preserve the original nullability form in the model.
import type { Diagnostic } from "../parser/diagnostics.js";
import { type Result, err } from "../result.js";
import {
  isTupleVariantFields,
  type Model,
  type ResolvedTypeRef,
  type ResolvedVariant,
  visibleDeclsForTarget,
} from "../model/types.js";
import { ModelBuilder, record, union, alias } from "../model/builder.js";
import type { Converter } from "./types.js";
import { mapBuiltinName, parseTypeRef } from "./parse-typeref.js";

// ── Type mapping tables ──

// Option<T> is emitted specially in mapTdToTs as `T | undefined`, so it's not
// listed here.
const TD_TO_TS: Record<string, string> = {
  Bool: "boolean",
  Int: "number",
  Float: "number",
  String: "string",
  Bytes: "Uint8Array",
  Unit: "void",
  List: "Array",
  Map: "Map",
  DateTime: "string",
  Uuid: "string",
  Decimal: "string",
};

const TS_TO_TD: Record<string, string> = {
  boolean: "Bool",
  number: "Int",
  string: "String",
  void: "Unit",
  Uint8Array: "Bytes",
  Array: "List",
  Map: "Map",
  Record: "Map",
  Set: "List",
  Date: "DateTime",
};

// ── From TypeScript ──

const IFACE_RE = /(?:export\s+)?interface\s+(\w+)(?:<([^>]+)>)?\s*\{([^}]*)}/g;
const TYPE_ALIAS_HEAD_RE = /(?:export\s+)?type\s+(\w+)(?:<([^>]+)>)?\s*=\s*/g;
const FIELD_RE = /(\w+)\??\s*:\s*(.+)/;

/** Extract the RHS of a type alias, respecting braces so `;` inside `{}` is skipped. */
const extractTypeAliasRhs = (source: string, startIdx: number): string | null => {
  let depth = 0;
  for (let i = startIdx; i < source.length; i++) {
    const c = source.charAt(i);
    depth += c === "{" ? 1 : c === "}" ? -1 : 0;
    if (c === ";" && depth === 0) {
      return source.slice(startIdx, i);
    }
  }
  return null;
};

const parseFields = (body: string) =>
  body
    .split(/[;\n]/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("//"))
    .map((l) => {
      const m = FIELD_RE.exec(l);
      if (m === null) {
        return null;
      }
      const [, name, type] = m;
      if (name === undefined || type === undefined) {
        return null;
      }
      return { name, type: mapTsType(type.replace(/;$/, "").trim()) };
    })
    .filter((f): f is { name: string; type: string } => f !== null);

const splitTsGenericArgs = (s: string): string[] => {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charAt(i);
    depth += c === "<" ? 1 : c === ">" ? -1 : 0;
    if (c === "," && depth === 0) {
      parts.push(s.slice(start, i).trim());
      start = i + 1;
    }
  }
  const last = s.slice(start).trim();
  return last.length > 0 ? [...parts, last] : parts;
};

// Split a top-level TypeScript union (`A | B | C`) into parts, respecting
// angle brackets so `Map<string, number> | undefined` splits into two, not
// three.
const splitTsUnion = (s: string): string[] => {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charAt(i);
    depth += c === "<" ? 1 : c === ">" ? -1 : 0;
    if (c === "|" && depth === 0) {
      parts.push(s.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(s.slice(start).trim());
  return parts.filter((p) => p.length > 0);
};

// If `t` is one of:
//   T | undefined
//   T | null
//   T | undefined | null  (any order)
// return the inner T (trimmed). Otherwise return null.
const extractOptionInner = (t: string): string | null => {
  const parts = splitTsUnion(t);
  if (parts.length < 2 || parts.length > 3) {
    return null;
  }
  const nullish = new Set(["undefined", "null"]);
  const nonNullish = parts.filter((p) => !nullish.has(p));
  const nullishParts = parts.filter((p) => nullish.has(p));
  if (nonNullish.length !== 1 || nullishParts.length !== parts.length - 1) {
    return null;
  }
  return nonNullish[0] ?? null;
};

const mapTsType = (t: string): string => {
  const trimmed = t.trim();
  const optionInner = extractOptionInner(trimmed);
  if (optionInner !== null) {
    return `Option<${mapTsType(optionInner)}>`;
  }
  const arrayMatch = /^(.+)\[\]$/.exec(trimmed);
  if (arrayMatch?.[1] !== undefined) {
    return `List<${mapTsType(arrayMatch[1])}>`;
  }
  const angleBracket = trimmed.indexOf("<");
  if (angleBracket !== -1) {
    const baseName = trimmed.slice(0, angleBracket);
    const mapped = TS_TO_TD[baseName] ?? baseName;
    const inner = trimmed.slice(angleBracket + 1, trimmed.lastIndexOf(">"));
    const args = splitTsGenericArgs(inner).map(mapTsType);
    return `${mapped}<${args.join(", ")}>`;
  }
  return TS_TO_TD[trimmed] ?? trimmed;
};

const VARIANT_FIELD_RE = /(\w+)\s*:\s*(.+)/;

const parseUnionVariant = (objectLiteral: string) => {
  const inner = objectLiteral.replace(/^\{/, "").replace(/}$/, "").trim();
  const entries = inner
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  let variantName = objectLiteral;
  const fields: Array<{ name: string; type: ReturnType<typeof parseTypeRef> }> = [];
  for (const entry of entries) {
    const fm = VARIANT_FIELD_RE.exec(entry);
    if (fm === null) {
      continue;
    }
    const [, fieldName, rawType] = fm;
    if (fieldName === undefined || rawType === undefined) {
      continue;
    }
    const fieldType = rawType.trim();
    const isDiscriminant = fieldName === "kind" || fieldName === "type" || fieldName === "tag";
    if (isDiscriminant) {
      variantName = fieldType.replace(/^["']/, "").replace(/["']$/, "");
    } else {
      fields.push({ name: fieldName, type: parseTypeRef(mapTsType(fieldType)) });
    }
  }
  return { name: variantName, fields };
};

const tsGenerics = (s: string | undefined): string[] =>
  s !== undefined && s.length > 0
    ? s.split(",").map((g) => {
        const [first] = g.trim().split(/\s/);
        return first ?? g.trim();
      })
    : [];

const fromTypeScript = (source: string): Result<Model, Diagnostic[]> => {
  const builder = new ModelBuilder();
  let found = false;

  IFACE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = IFACE_RE.exec(source)) !== null) {
    const [, name, gens, body] = m;
    if (name === undefined || body === undefined) {
      continue;
    }
    found = true;
    const fields = parseFields(body).map((f) => ({ name: f.name, type: parseTypeRef(f.type) }));
    builder.add(record(name, fields, tsGenerics(gens)));
  }

  TYPE_ALIAS_HEAD_RE.lastIndex = 0;
  while ((m = TYPE_ALIAS_HEAD_RE.exec(source)) !== null) {
    const [, name, gens] = m;
    if (name === undefined) {
      continue;
    }
    const rhsRaw = extractTypeAliasRhs(source, m.index + m[0].length);
    if (rhsRaw === null) {
      continue;
    }
    found = true;
    const rhs = rhsRaw.trim();

    const parts = rhs
      .split("|")
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    const allLiterals = parts.every((p) => /^["']/.test(p));
    // `T | undefined`, `T | null`, `T | undefined | null` is Option<T>, not a
    // tagged union — fall through to the alias branch where mapTsType will
    // convert it to Option<T>.
    const isOptionShape = extractOptionInner(rhs) !== null;
    const isUnion = parts.length > 1 && !allLiterals && !isOptionShape;

    if (isUnion) {
      builder.add(
        union(
          name,
          parts.map((p) => {
            const trimmedPart = p.trim();
            const isObject = trimmedPart.startsWith("{");
            return isObject ? parseUnionVariant(trimmedPart) : { name: mapTsType(trimmedPart), fields: [] };
          }),
          tsGenerics(gens)
        )
      );
    } else {
      builder.add(alias(name, parseTypeRef(mapTsType(rhs)), tsGenerics(gens)));
    }
  }

  return found
    ? builder.build()
    : err([{ severity: "error", message: "No TypeScript type definitions found", line: 0, col: 0, length: 0 }]);
};

// ── To TypeScript ──

const mapTdToTs = (t: ResolvedTypeRef): string => {
  // Option<T> -> T | undefined. If T is itself a union type this could become
  // `A | B | undefined`, which parses back via the `T | undefined` rule below
  // as `Option<A | B>` — still lossless for the round-trip of Option<Simple>.
  if (t.name === "Option" && t.args.length === 1 && t.args[0] !== undefined) {
    return `${mapTdToTs(t.args[0])} | undefined`;
  }
  const name = mapBuiltinName(t, TD_TO_TS);
  return t.args.length === 0 ? name : `${name}<${t.args.map(mapTdToTs).join(", ")}>`;
};

const mapUntaggedVariantToTs = (variant: ResolvedVariant): string => {
  if (variant.fields.length === 0) {
    return "undefined";
  }
  if (isTupleVariantFields(variant.fields)) {
    if (variant.fields.length === 1) {
      const [field] = variant.fields;
      return field === undefined ? "undefined" : mapTdToTs(field.type);
    }
    return `[${variant.fields.map((field) => mapTdToTs(field.type)).join(", ")}]`;
  }
  return `{ ${variant.fields.map((field) => `${field.name}: ${mapTdToTs(field.type)}`).join("; ")} }`;
};

const toTypeScript = (model: Model): string => {
  const lines: string[] = [];
  const decls = visibleDeclsForTarget(model.decls, "typescript");

  for (const d of decls) {
    const genericsStr = d.generics.length > 0 ? `<${d.generics.join(", ")}>` : "";

    if (d.kind === "record") {
      lines.push(`export interface ${d.name}${genericsStr} {`);
      for (const f of d.fields) {
        lines.push(`  ${f.name}: ${mapTdToTs(f.type)};`);
      }
      lines.push("}", "");
    } else if (d.kind === "union") {
      const variants =
        d.untagged === true
          ? d.variants.map(mapUntaggedVariantToTs)
          : d.variants.map((v) => {
              if (v.fields.length === 0) {
                return `{ kind: "${v.name}" }`;
              }
              return `{ kind: "${v.name}"; ${v.fields.map((f) => `${f.name}: ${mapTdToTs(f.type)}`).join("; ")} }`;
            });
      lines.push(`export type ${d.name}${genericsStr} =`, `  | ${variants.join("\n  | ")};`, "");
    } else {
      lines.push(`export type ${d.name}${genericsStr} = ${mapTdToTs(d.target)};`, "");
    }
  }

  return lines.join("\n");
};

export const typescript: Converter = {
  language: "typescript",
  fromSource: fromTypeScript,
  toSource: toTypeScript,
};
