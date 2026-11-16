// [CONV-RUST] Rust <-> typeDiagram bidirectional converter.
import type { Diagnostic } from "../parser/diagnostics.js";
import { type Result, err } from "../result.js";
import { formatVariantName, withDiscriminant } from "../variant.js";
import {
  isTupleVariantFields,
  type Model,
  type ResolvedDataDecl,
  type ResolvedDecl,
  type ResolvedField,
  type ResolvedTypeRef,
  type ResolvedVariant,
  visibleDataDeclsForTarget,
} from "../model/types.js";
import { ModelBuilder, record, union, alias } from "../model/builder.js";
import type { Converter } from "./types.js";
import { mapBuiltinName, parseTypeRef, splitGenericArgs } from "./parse-typeref.js";

// ── Type mapping ──

const TD_TO_RS: Record<string, string> = {
  Bool: "bool",
  Int: "i64",
  Float: "f64",
  String: "String",
  Bytes: "Vec<u8>",
  Unit: "()",
  List: "Vec",
  Map: "HashMap",
  Option: "Option",
  DateTime: "chrono::DateTime<chrono::Utc>",
  Uuid: "uuid::Uuid",
  Decimal: "rust_decimal::Decimal",
};

const RS_TO_TD: Record<string, string> = {
  bool: "Bool",
  i8: "Int",
  i16: "Int",
  i32: "Int",
  i64: "Int",
  u8: "Int",
  u16: "Int",
  u32: "Int",
  u64: "Int",
  f32: "Float",
  f64: "Float",
  String: "String",
  str: "String",
  Vec: "List",
  HashMap: "Map",
  BTreeMap: "Map",
  Option: "Option",
  "uuid::Uuid": "Uuid",
  Uuid: "Uuid",
  "rust_decimal::Decimal": "Decimal",
  Decimal: "Decimal",
  Box: "",
};

// ── From Rust ──

// Header-only regexes: capture `[pub] struct Name<Gens> {` but NOT the body.
// The body is extracted below with a brace-balanced scan so nested `{}`
// (struct-style enum variants) are captured correctly.
const STRUCT_HEAD_RE = /(?:pub\s+)?struct\s+(\w+)(?:<([^>]+)>)?\s*\{/g;
const ENUM_HEAD_RE = /(?:pub\s+)?enum\s+(\w+)(?:<([^>]+)>)?\s*\{/g;
const TYPE_ALIAS_RE = /(?:pub\s+)?type\s+(\w+)(?:<([^>]+)>)?\s*=\s*([^;]+);/g;
const FIELD_RE = /(?:pub\s+)?(\w+)\s*:\s*(.+)/;

/** Given a position just past an opening `{`, return the contents up to the
 *  matching `}`, respecting nesting. Returns null if no matching brace. */
const extractBracedBody = (source: string, startIdx: number): string | null => {
  let depth = 1;
  for (let i = startIdx; i < source.length; i++) {
    const c = source.charAt(i);
    if (c === "{") {
      depth += 1;
    } else if (c === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(startIdx, i);
      }
    }
  }
  return null;
};

// chrono's DateTime carries a zone parameter, so it must match as a whole
// string before generic splitting would tear it apart. [MODEL-SCALARS]
const RS_FULL_TO_TD: Record<string, string> = {
  "chrono::DateTime<chrono::Utc>": "DateTime",
  "DateTime<Utc>": "DateTime",
};

const mapRsType = (t: string): string => {
  const cleaned = t
    .trim()
    .replace(/&'?\w*\s*/g, "")
    .replace(/^&/, "");
  const full = RS_FULL_TO_TD[cleaned];
  if (full !== undefined) {
    return full;
  }
  const angleBracket = cleaned.indexOf("<");
  if (angleBracket !== -1) {
    const baseName = cleaned.slice(0, angleBracket);
    const mapped = RS_TO_TD[baseName] ?? baseName;
    const inner = cleaned.slice(angleBracket + 1, cleaned.lastIndexOf(">"));
    const args = splitGenericArgs(inner).map(mapRsType);
    return `${mapped}<${args.join(", ")}>`;
  }
  return RS_TO_TD[cleaned] ?? cleaned;
};

// Split a struct/variant body on commas, respecting angle-bracket and brace
// depth so `HashMap<String, String>` is not mis-split.
const splitRsFieldList = (body: string): string[] => {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body.charAt(i);
    if (c === "<" || c === "{" || c === "(") {
      depth += 1;
    } else if (c === ">" || c === "}" || c === ")") {
      depth -= 1;
    } else if (c === "," && depth === 0) {
      parts.push(body.slice(start, i).trim());
      start = i + 1;
    }
  }
  const last = body.slice(start).trim();
  return last.length > 0 ? [...parts, last] : parts;
};

const RENAME_MARK = '#[serde(rename = "';

/** The schema name a `#[serde(rename = "…")]` attribute preserves ([CONV-RUST-IDIOM]). */
const serdeRename = (chunk: string): string | undefined => {
  const at = chunk.indexOf(RENAME_MARK);
  const start = at + RENAME_MARK.length;
  return at === -1 ? undefined : chunk.slice(start, chunk.indexOf('"', start));
};

const parseRsFields = (body: string) =>
  splitRsFieldList(body)
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
      return { name: serdeRename(l) ?? name, type: mapRsType(type.replace(/,$/, "").trim()) };
    })
    .filter((f): f is { name: string; type: string } => f !== null);

const splitRsVariants = (body: string): string[] => {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body.charAt(i);
    depth += c === "{" || c === "(" ? 1 : c === "}" || c === ")" ? -1 : 0;
    if (c === "," && depth === 0) {
      parts.push(body.slice(start, i).trim());
      start = i + 1;
    }
  }
  const last = body.slice(start).trim();
  return last.length > 0 ? [...parts, last] : parts;
};

const parseUnitVariant = (line: string) => {
  const [rawName, rawDiscriminant] = line.split("=").map((part) => part.trim());
  return rawDiscriminant === undefined
    ? { name: line.replace(/,$/, "").trim() }
    : { name: rawName ?? line.replace(/,$/, "").trim(), discriminant: rawDiscriminant.replace(/,$/, "").trim() };
};

const parseRsVariants = (body: string) => {
  const variants: Array<{ name: string; discriminant?: string; fields: Array<{ name: string; type: string }> }> = [];
  const raw = splitRsVariants(body).filter((s) => s.length > 0 && !s.startsWith("//"));

  for (const line of raw) {
    const braceIdx = line.indexOf("{");
    const parenIdx = line.indexOf("(");

    if (braceIdx !== -1) {
      const name = line.slice(0, braceIdx).trim();
      const inner = line.slice(braceIdx + 1, line.lastIndexOf("}"));
      variants.push({ name, fields: parseRsFields(inner) });
    } else if (parenIdx !== -1) {
      const name = line.slice(0, parenIdx).trim();
      const inner = line.slice(parenIdx + 1, line.lastIndexOf(")"));
      const types = inner
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t.length > 0);
      const fields = types.map((t, i) => ({ name: `_${String(i)}`, type: mapRsType(t) }));
      variants.push({ name, fields });
    } else {
      variants.push({ ...parseUnitVariant(line), fields: [] });
    }
  }
  return variants;
};

const rsGenerics = (s: string | undefined): string[] =>
  s !== undefined && s.length > 0
    ? s.split(",").map((g) => {
        const [first] = g.trim().split(/[:\s]/);
        return first ?? g.trim();
      })
    : [];

const fromRust = (source: string): Result<Model, Diagnostic[]> => {
  const builder = new ModelBuilder();
  let found = false;

  STRUCT_HEAD_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = STRUCT_HEAD_RE.exec(source)) !== null) {
    const [, name, gens] = m;
    if (name === undefined) {
      continue;
    }
    const body = extractBracedBody(source, m.index + m[0].length);
    if (body === null) {
      continue;
    }
    found = true;
    const fields = parseRsFields(body).map((f) => ({ name: f.name, type: parseTypeRef(f.type) }));
    builder.add(record(name, fields, rsGenerics(gens)));
  }

  ENUM_HEAD_RE.lastIndex = 0;
  while ((m = ENUM_HEAD_RE.exec(source)) !== null) {
    const [, name, gens] = m;
    if (name === undefined) {
      continue;
    }
    const body = extractBracedBody(source, m.index + m[0].length);
    if (body === null) {
      continue;
    }
    found = true;
    const variants = parseRsVariants(body).map((v) =>
      withDiscriminant<{
        name: string;
        discriminant?: string;
        fields: Array<{ name: string; type: ResolvedTypeRef }>;
      }>(
        {
          name: v.name,
          fields: v.fields.map((f) => ({ name: f.name, type: parseTypeRef(f.type) })),
        },
        v.discriminant
      )
    );
    builder.add(union(name, variants, rsGenerics(gens)));
  }

  TYPE_ALIAS_RE.lastIndex = 0;
  while ((m = TYPE_ALIAS_RE.exec(source)) !== null) {
    const [, name, gens, target] = m;
    if (name === undefined || target === undefined) {
      continue;
    }
    found = true;
    builder.add(alias(name, parseTypeRef(mapRsType(target.trim())), rsGenerics(gens)));
  }

  return found
    ? builder.build()
    : err([{ severity: "error", message: "No Rust type definitions found", line: 0, col: 0, length: 0 }]);
};

// ── To Rust ──

export const mapTdToRs = (t: ResolvedTypeRef): string => {
  const name = mapBuiltinName(t, TD_TO_RS);
  return t.args.length === 0 ? name : `${name}<${t.args.map(mapTdToRs).join(", ")}>`;
};

/** A one-line Rust doc comment for a generated item ([CONV-RUST-DECL]). Emitted
 *  only when `docs` is requested so generated code satisfies `missing_docs`. */
const rustDoc = (indent: string, name: string, kind: string): string => `${indent}/// The \`${name}\` ${kind}.`;

/** [CONV-RUST-IDIOM] snake_case for a Rust field (`isHTTPServer` → `is_http_server`). */
export const rustFieldName = (name: string): string =>
  name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toLowerCase();

/** `decls` with every record / struct-variant field renamed to its Rust name, so
 *  codecs planned over them bind the same identifiers the ADT declares. */
export const rustNamedDecls = (decls: readonly ResolvedDecl[]): ResolvedDecl[] => {
  const rename = (fields: ResolvedField[]): ResolvedField[] =>
    isTupleVariantFields(fields) ? fields : fields.map((f) => ({ ...f, name: rustFieldName(f.name) }));
  return decls.map((d) =>
    d.kind === "record"
      ? { ...d, fields: rename(d.fields) }
      : d.kind === "union"
        ? { ...d, variants: d.variants.map((v) => ({ ...v, fields: rename(v.fields) })) }
        : d
  );
};

const renameAttr = (f: ResolvedField): string =>
  rustFieldName(f.name) === f.name ? "" : `#[serde(rename = "${f.name}")]`;

const needsSerde = (d: ResolvedDataDecl): boolean =>
  d.kind === "record"
    ? d.fields.some((f) => renameAttr(f) !== "")
    : d.kind === "union" &&
      (d.untagged === true ||
        d.variants.some((v) => !isTupleVariantFields(v.fields) && v.fields.some((f) => renameAttr(f) !== "")));

const deriveLine = (d: ResolvedDataDecl, extra: readonly string[]): string[] =>
  d.kind === "alias"
    ? []
    : [
        `#[derive(${["Debug", "Clone", "PartialEq", ...extra, ...(needsSerde(d) ? ["serde::Serialize", "serde::Deserialize"] : [])].join(", ")})]`,
      ];

const emitRustVariant = (v: ResolvedVariant, docs: boolean): string => {
  const structField = (f: ResolvedField): string =>
    `${renameAttr(f) === "" ? "" : `${renameAttr(f)} `}${rustFieldName(f.name)}: ${mapTdToRs(f.type)}`;
  const body =
    v.fields.length === 0
      ? `    ${formatVariantName(v.name, v.discriminant)},`
      : isTupleVariantFields(v.fields)
        ? `    ${v.name}(${v.fields.map((f) => mapTdToRs(f.type)).join(", ")}),`
        : `    ${v.name} { ${v.fields.map(structField).join(", ")} },`;
  return docs ? `${rustDoc("    ", v.name, "variant")}\n${body}` : body;
};

/** [CONV-RUST-DECL] [CONV-RUST-IDIOM] Emit one Rust type declaration: derives
 *  (`Debug, Clone, PartialEq`, plus `extraDerives`, plus serde when a serde
 *  attribute is needed), snake_case fields with `#[serde(rename)]` preserving
 *  the schema name. Shared by the type converter and the TDBIN codec generator.
 *  With `docs`, prepends `///` comments so the output is `missing_docs`-clean. */
export const emitRustDecl = (d: ResolvedDataDecl, docs = false, extraDerives: readonly string[] = []): string[] => {
  const genericsStr = d.generics.length > 0 ? `<${d.generics.join(", ")}>` : "";
  const lead = [...(docs ? [rustDoc("", d.name, d.kind)] : []), ...deriveLine(d, extraDerives)];
  const field = (f: ResolvedField): string =>
    [
      ...(docs ? [rustDoc("    ", f.name, "field")] : []),
      ...(renameAttr(f) === "" ? [] : [`    ${renameAttr(f)}`]),
      `    pub ${rustFieldName(f.name)}: ${mapTdToRs(f.type)},`,
    ].join("\n");
  if (d.kind === "record") {
    return [...lead, `pub struct ${d.name}${genericsStr} {`, ...d.fields.map(field), "}", ""];
  }
  if (d.kind === "union") {
    const header = d.untagged === true ? ["#[serde(untagged)]"] : [];
    return [
      ...lead,
      ...header,
      `pub enum ${d.name}${genericsStr} {`,
      ...d.variants.map((v) => emitRustVariant(v, docs)),
      "}",
      "",
    ];
  }
  return [...lead, `pub type ${d.name}${genericsStr} = ${mapTdToRs(d.target)};`, ""];
};

const toRust = (model: Model): string =>
  visibleDataDeclsForTarget(model.decls, "rust")
    .flatMap((d) => emitRustDecl(d))
    .join("\n");

export const rust: Converter = {
  language: "rust",
  fromSource: fromRust,
  toSource: toRust,
};
