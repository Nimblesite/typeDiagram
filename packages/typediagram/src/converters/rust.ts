// [CONV-RUST] Rust <-> typeDiagram bidirectional converter.
import type { Diagnostic } from "../parser/diagnostics.js";
import { type Result, err } from "../result.js";
import { formatVariantName, withDiscriminant } from "../variant.js";
import { isTupleVariantFields, type Model, type ResolvedTypeRef, visibleDeclsForTarget } from "../model/types.js";
import { ModelBuilder, record, union, alias } from "../model/builder.js";
import type { Converter } from "./types.js";
import { mapBuiltinName, parseTypeRef } from "./parse-typeref.js";

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

const splitGenericArgs = (s: string): string[] => {
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
      return { name, type: mapRsType(type.replace(/,$/, "").trim()) };
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

const mapTdToRs = (t: ResolvedTypeRef): string => {
  const name = mapBuiltinName(t, TD_TO_RS);
  return t.args.length === 0 ? name : `${name}<${t.args.map(mapTdToRs).join(", ")}>`;
};

const toRust = (model: Model): string => {
  const lines: string[] = [];
  const decls = visibleDeclsForTarget(model.decls, "rust");

  for (const d of decls) {
    const genericsStr = d.generics.length > 0 ? `<${d.generics.join(", ")}>` : "";

    if (d.kind === "record") {
      lines.push(`pub struct ${d.name}${genericsStr} {`);
      for (const f of d.fields) {
        lines.push(`    pub ${f.name}: ${mapTdToRs(f.type)},`);
      }
      lines.push("}", "");
    } else if (d.kind === "union") {
      if (d.untagged === true) {
        lines.push("#[serde(untagged)]");
      }
      lines.push(`pub enum ${d.name}${genericsStr} {`);
      for (const v of d.variants) {
        if (v.fields.length === 0) {
          lines.push(`    ${formatVariantName(v.name, v.discriminant)},`);
        } else if (isTupleVariantFields(v.fields)) {
          lines.push(`    ${v.name}(${v.fields.map((f) => mapTdToRs(f.type)).join(", ")}),`);
        } else {
          lines.push(`    ${v.name} { ${v.fields.map((f) => `${f.name}: ${mapTdToRs(f.type)}`).join(", ")} },`);
        }
      }
      lines.push("}", "");
    } else {
      lines.push(`pub type ${d.name}${genericsStr} = ${mapTdToRs(d.target)};`, "");
    }
  }

  return lines.join("\n");
};

export const rust: Converter = {
  language: "rust",
  fromSource: fromRust,
  toSource: toRust,
};
