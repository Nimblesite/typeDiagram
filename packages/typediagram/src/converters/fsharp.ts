// [CONV-FS] F# <-> typeDiagram bidirectional converter.
import type { Diagnostic } from "../parser/diagnostics.js";
import { type Result, err } from "../result.js";
import { type Model, type ResolvedTypeRef, visibleDeclsForTarget } from "../model/types.js";
import { ModelBuilder, record, union, alias } from "../model/builder.js";
import type { Converter } from "./types.js";
import { mapBuiltinName, parseTypeRef } from "./parse-typeref.js";

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

/** Split "A, B<C, D>" respecting nested angle brackets. */
const splitFsGenericArgs = (s: string): string[] => {
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

const mapFsType = (t: string): string => {
  const normalized = normalizeFsType(t);
  const angleBracket = normalized.indexOf("<");
  if (angleBracket !== -1) {
    const baseName = normalized.slice(0, angleBracket);
    const mapped = FS_TO_TD[baseName] ?? baseName;
    const inner = normalized.slice(angleBracket + 1, normalized.lastIndexOf(">"));
    const args = splitFsGenericArgs(inner).map(mapFsType);
    return `${mapped}<${args.join(", ")}>`;
  }
  return FS_TO_TD[normalized] ?? normalized;
};

const parseFsFields = (body: string) =>
  body
    .split("\n")
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
      return { name, type: mapFsType(type.replace(/;?\s*$/, "").trim()) };
    })
    .filter((f): f is { name: string; type: string } => f !== null);

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
  RECORD_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RECORD_RE.exec(source)) !== null) {
    const [, name, gens, body] = m;
    if (name === undefined || body === undefined) {
      continue;
    }
    found = true;
    recordNames.add(name);
    const fields = parseFsFields(body).map((f) => ({ name: f.name, type: parseTypeRef(f.type) }));
    builder.add(record(name, fields, fsGenerics(gens)));
  }

  // Discriminated unions
  DU_RE.lastIndex = 0;
  while ((m = DU_RE.exec(source)) !== null) {
    const [, name, gens, body] = m;
    if (name === undefined || body === undefined) {
      continue;
    }
    found = true;
    duNames.add(name);
    const variants = parseDuVariants(body).map((v) => ({
      name: v.name,
      fields: v.fields.map((f) => ({ name: f.name, type: parseTypeRef(f.type) })),
    }));
    builder.add(union(name, variants, fsGenerics(gens)));
  }

  // Type abbreviations (skip already-parsed records/DUs)
  TYPE_ABBREV_RE.lastIndex = 0;
  while ((m = TYPE_ABBREV_RE.exec(source)) !== null) {
    const [, name, gens, target] = m;
    if (name === undefined || target === undefined) {
      continue;
    }
    if (recordNames.has(name) || duNames.has(name)) {
      continue;
    }
    found = true;
    builder.add(alias(name, parseTypeRef(mapFsType(target.trim())), fsGenerics(gens)));
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

  for (const d of visibleDeclsForTarget(model.decls, "fsharp")) {
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
