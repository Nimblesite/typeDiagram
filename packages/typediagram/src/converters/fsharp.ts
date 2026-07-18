// [CONV-FS] F# <-> typeDiagram bidirectional converter.
import type { Diagnostic } from "../parser/diagnostics.js";
import { type Result, err } from "../result.js";
import { type Model, type ResolvedTypeRef, visibleDataDeclsForTarget } from "../model/types.js";
import { ModelBuilder, record, union, alias } from "../model/builder.js";
import type { Converter } from "./types.js";
import { mapBuiltinName, parseTypeRef, splitGenericArgs } from "./parse-typeref.js";
import { parseFields, scanAll } from "./scan-decls.js";

// ── Type mapping tables ──

const TD_TO_FS: Record<string, string> = {
  Bool: "bool",
  Int: "int",
  Float: "float",
  String: "string",
  Bytes: "byte[]",
  Unit: "unit",
  List: "list",
  Map: "Map",
  Option: "option",
  DateTime: "DateTimeOffset",
  Uuid: "Guid",
  Decimal: "decimal",
};

const FS_TO_TD: Record<string, string> = {
  bool: "Bool",
  int: "Int",
  int64: "Int",
  float: "Float",
  double: "Float",
  decimal: "Decimal",
  string: "String",
  unit: "Unit",
  list: "List",
  Map: "Map",
  option: "Option",
  Option: "Option",
  DateTimeOffset: "DateTime",
  DateTime: "DateTime",
  Guid: "Uuid",
};

// ── From F# ──

const RECORD_RE = /type\s+(\w+)(?:<([^>]+)>)?\s*=\s*\{([^}]*)}/g;
const DU_RE = /type\s+(\w+)(?:<([^>]+)>)?\s*=\s*\n((?:\s*\|\s*\w+(?:\s+of\s+[^\n]*)?\n?)+)/g;
const TYPE_ABBREV_RE = /type\s+(\w+)(?:<([^>]+)>)?\s*=\s*(\w[\w<>, ]*)/g;
const FIELD_RE = /(\w+)\s*:\s*(.+)/;

/** Map F# postfix generics (e.g. "ToolResult list option") to prefix form. */
const normalizeFsType = (t: string): string => {
  const trimmed = t.trim();
  const optMatch = /^(.+)\s+option$/.exec(trimmed);
  if (optMatch?.[1] !== undefined) {
    return `Option<${normalizeFsType(optMatch[1])}>`;
  }
  const listMatch = /^(.+)\s+list$/.exec(trimmed);
  if (listMatch?.[1] !== undefined) {
    return `List<${normalizeFsType(listMatch[1])}>`;
  }
  return trimmed;
};

const mapFsType = (t: string): string => {
  const normalized = normalizeFsType(t);
  const angleBracket = normalized.indexOf("<");
  if (angleBracket !== -1) {
    const baseName = normalized.slice(0, angleBracket);
    const mapped = FS_TO_TD[baseName] ?? baseName;
    const inner = normalized.slice(angleBracket + 1, normalized.lastIndexOf(">"));
    const args = splitGenericArgs(inner).map(mapFsType);
    return `${mapped}<${args.join(", ")}>`;
  }
  return FS_TO_TD[normalized] ?? normalized;
};

const parseFsFields = (body: string) =>
  parseFields(body, {
    separator: "\n",
    commentPrefix: "//",
    fieldRe: FIELD_RE,
    mapType: (type) => mapFsType(type.replace(/;?\s*$/, "").trim()),
  });

const parseDuVariants = (body: string) =>
  body
    .split("|")
    .map((v) => v.trim())
    .filter((v) => v.length > 0)
    .map((v) => {
      const ofIdx = v.indexOf(" of ");
      if (ofIdx === -1) {
        return { name: v.trim(), fields: [] as Array<{ name: string; type: string }> };
      }
      const name = v.slice(0, ofIdx).trim();
      const payload = v.slice(ofIdx + 4).trim();
      const parts = payload.split("*").map((p) => p.trim());
      const fields = parts.map((p, i) => {
        const fm = FIELD_RE.exec(p);
        if (fm?.[1] !== undefined && fm[2] !== undefined) {
          return { name: fm[1], type: mapFsType(fm[2].trim()) };
        }
        return { name: `_${String(i)}`, type: mapFsType(p) };
      });
      return { name, fields };
    });

const fsGenerics = (s: string | undefined): string[] =>
  s !== undefined && s.length > 0 ? s.split(",").map((g) => g.trim().replace(/^'/, "")) : [];

const fromFSharp = (source: string): Result<Model, Diagnostic[]> => {
  const builder = new ModelBuilder();
  let found = false;
  const recordNames = new Set<string>();
  const duNames = new Set<string>();

  // Records
  for (const r of scanAll(RECORD_RE, source, (m) => {
    const [, name, gens, body] = m;
    return name === undefined || body === undefined ? null : { name, gens, body };
  })) {
    found = true;
    recordNames.add(r.name);
    const fields = parseFsFields(r.body).map((f) => ({ name: f.name, type: parseTypeRef(f.type) }));
    builder.add(record(r.name, fields, fsGenerics(r.gens)));
  }

  // Discriminated unions
  for (const u of scanAll(DU_RE, source, (m) => {
    const [, name, gens, body] = m;
    return name === undefined || body === undefined ? null : { name, gens, body };
  })) {
    found = true;
    duNames.add(u.name);
    const variants = parseDuVariants(u.body).map((v) => ({
      name: v.name,
      fields: v.fields.map((f) => ({ name: f.name, type: parseTypeRef(f.type) })),
    }));
    builder.add(union(u.name, variants, fsGenerics(u.gens)));
  }

  // Type abbreviations (skip already-parsed records/DUs)
  for (const a of scanAll(TYPE_ABBREV_RE, source, (m) => {
    const [, name, gens, target] = m;
    return name === undefined || target === undefined || recordNames.has(name) || duNames.has(name)
      ? null
      : { name, gens, target };
  })) {
    found = true;
    builder.add(alias(a.name, parseTypeRef(mapFsType(a.target.trim())), fsGenerics(a.gens)));
  }

  return found
    ? builder.build()
    : err([{ severity: "error", message: "No F# type definitions found", line: 0, col: 0, length: 0 }]);
};

// ── To F# ──

const mapTdToFs = (t: ResolvedTypeRef): string => {
  const [a0, a1] = t.args;
  if (t.name === "List" && t.args.length === 1 && a0 !== undefined) {
    return `${mapTdToFs(a0)} list`;
  }
  if (t.name === "Option" && t.args.length === 1 && a0 !== undefined) {
    return `${mapTdToFs(a0)} option`;
  }
  if (t.name === "Map" && t.args.length === 2 && a0 !== undefined && a1 !== undefined) {
    return `Map<${mapTdToFs(a0)}, ${mapTdToFs(a1)}>`;
  }
  const name = mapBuiltinName(t, TD_TO_FS);
  return t.args.length === 0 ? name : `${name}<${t.args.map(mapTdToFs).join(", ")}>`;
};

const toFSharp = (model: Model): string => {
  const lines: string[] = [];

  for (const d of visibleDataDeclsForTarget(model.decls, "fsharp")) {
    const genericsStr = d.generics.length > 0 ? `<${d.generics.map((g) => `'${g}`).join(", ")}>` : "";

    if (d.kind === "record") {
      lines.push(`type ${d.name}${genericsStr} = {`);
      for (const f of d.fields) {
        lines.push(`    ${f.name}: ${mapTdToFs(f.type)}`);
      }
      lines.push("}", "");
    } else if (d.kind === "union") {
      lines.push(`type ${d.name}${genericsStr} =`);
      for (const v of d.variants) {
        if (v.fields.length === 0) {
          lines.push(`    | ${v.name}`);
        } else {
          lines.push(`    | ${v.name} of ${v.fields.map((f) => `${f.name}: ${mapTdToFs(f.type)}`).join(" * ")}`);
        }
      }
      lines.push("");
    } else {
      lines.push(`type ${d.name}${genericsStr} = ${mapTdToFs(d.target)}`, "");
    }
  }

  return lines.join("\n");
};

export const fsharp: Converter = {
  language: "fsharp",
  fromSource: fromFSharp,
  toSource: toFSharp,
};
