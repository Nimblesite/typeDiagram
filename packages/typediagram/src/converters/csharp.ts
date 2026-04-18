// [CONV-CS] C# <-> typeDiagram bidirectional converter.
import type { Diagnostic } from "../parser/diagnostics.js";
import { type Result, err } from "../result.js";
import type { Model, ResolvedAlias, ResolvedDecl, ResolvedTypeRef } from "../model/types.js";
import { ModelBuilder, record, union } from "../model/builder.js";
import type { Converter } from "./types.js";
import { parseTypeRef } from "./parse-typeref.js";

// ── Type mapping tables ──

const TD_TO_CS: Record<string, string> = {
  Bool: "bool",
  Int: "int",
  Float: "double",
  String: "string",
  Bytes: "byte[]",
  Unit: "void",
  List: "List",
  Map: "Dictionary",
  Any: "object",
};

const CS_TO_TD: Record<string, string> = {
  bool: "Bool",
  int: "Int",
  long: "Int",
  short: "Int",
  float: "Float",
  double: "Float",
  decimal: "Float",
  string: "String",
  byte: "Int",
  void: "Unit",
  List: "List",
  Dictionary: "Map",
  HashSet: "List",
};

// ── From C# ──

const RECORD_RE = /(?:public\s+)?(?:sealed\s+)?record\s+(\w+)(?:<([^>]+)>)?\s*\(([^)]*)\)\s*;/g;
const CLASS_OR_RECORD_HEADER_RE = /(?:public\s+)?(?:sealed\s+)?(?:class|record)\s+(\w+)(?:<([^>]+)>)?\s*(?::[^{]+)?\{/g;
const ENUM_RE = /(?:public\s+)?enum\s+(\w+)\s*\{([^}]*)}/g;
const PROP_RE = /(?:public\s+)?(\w[\w<>,\s[\]?]*?)\s+(\w+)\s*\{[^}]*\}/;
const PARAM_RE = /(\w[\w<>,\s[\]?]*?)\s+(\w+)/;

const extractBalancedBody = (source: string, openIdx: number): { body: string; endIdx: number } | null => {
  if (source.charAt(openIdx) !== "{") {
    return null;
  }
  let depth = 1;
  for (let i = openIdx + 1; i < source.length; i++) {
    const c = source.charAt(i);
    if (c === "{") {
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0) {
        return { body: source.slice(openIdx + 1, i), endIdx: i };
      }
    }
  }
  return null;
};

const mapCsType = (t: string): string => {
  const cleaned = t.trim().replace(/\?$/, "");
  return CS_TO_TD[cleaned] ?? cleaned;
};

const parseCsParams = (body: string) =>
  body
    .split(",")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => {
      const m = PARAM_RE.exec(l);
      if (m === null) {
        return null;
      }
      const [, type, name] = m;
      if (type === undefined || name === undefined) {
        return null;
      }
      return { name, type: mapCsType(type) };
    })
    .filter((f): f is { name: string; type: string } => f !== null);

const parseCsProps = (body: string) =>
  body
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("//") && !l.startsWith("[") && !l.startsWith("}"))
    .map((l) => {
      const m = PROP_RE.exec(l);
      if (m === null) {
        return null;
      }
      const [, type, name] = m;
      if (type === undefined || name === undefined) {
        return null;
      }
      return { name, type: mapCsType(type) };
    })
    .filter((f): f is { name: string; type: string } => f !== null);

const parseGenerics = (s: string | undefined): string[] =>
  s !== undefined && s.length > 0 ? s.split(",").map((g) => g.trim()) : [];

const fromCSharp = (source: string): Result<Model, Diagnostic[]> => {
  const builder = new ModelBuilder();
  let found = false;

  RECORD_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RECORD_RE.exec(source)) !== null) {
    const [, name, gens, body] = m;
    if (name === undefined || body === undefined) {
      continue;
    }
    found = true;
    const fields = parseCsParams(body).map((f) => ({ name: f.name, type: parseTypeRef(f.type) }));
    builder.add(record(name, fields, parseGenerics(gens)));
  }

  CLASS_OR_RECORD_HEADER_RE.lastIndex = 0;
  while ((m = CLASS_OR_RECORD_HEADER_RE.exec(source)) !== null) {
    const [full, name, gens] = m;
    if (name === undefined) {
      continue;
    }
    const braceIdx = m.index + full.length - 1;
    const bodyRes = extractBalancedBody(source, braceIdx);
    if (bodyRes === null) {
      continue;
    }
    found = true;
    const fields = parseCsProps(bodyRes.body).map((f) => ({ name: f.name, type: parseTypeRef(f.type) }));
    builder.add(record(name, fields, parseGenerics(gens)));
    CLASS_OR_RECORD_HEADER_RE.lastIndex = bodyRes.endIdx;
  }

  ENUM_RE.lastIndex = 0;
  while ((m = ENUM_RE.exec(source)) !== null) {
    const [, name, body] = m;
    if (name === undefined || body === undefined) {
      continue;
    }
    found = true;
    const cleaned = body
      .split("\n")
      .map((l) => l.replace(/\/\/.*$/, "").trim())
      .join(",");
    const variants = cleaned
      .split(",")
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .map((l) => {
        const [variantName] = l.split("=");
        return { name: (variantName ?? l).trim(), fields: [] };
      });
    builder.add(union(name, variants));
  }

  return found
    ? builder.build()
    : err([{ severity: "error", message: "No C# type definitions found", line: 0, col: 0, length: 0 }]);
};

// ── To C# ──

const isOption = (t: ResolvedTypeRef): boolean => t.name === "Option";
const isList = (t: ResolvedTypeRef): boolean => t.name === "List";
const isMap = (t: ResolvedTypeRef): boolean => t.name === "Map";
const isString = (t: ResolvedTypeRef): boolean => t.name === "String";

const buildAliasMap = (model: Model): Map<string, ResolvedTypeRef> => {
  const map = new Map<string, ResolvedTypeRef>();
  for (const d of model.decls) {
    if (d.kind === "alias") {
      map.set(d.name, d.target);
    }
  }
  return map;
};

const resolveAliases = (t: ResolvedTypeRef, aliases: Map<string, ResolvedTypeRef>, seen: Set<string>): ResolvedTypeRef => {
  if (aliases.has(t.name) && !seen.has(t.name)) {
    const target = aliases.get(t.name);
    if (target !== undefined) {
      const nextSeen = new Set(seen);
      nextSeen.add(t.name);
      return resolveAliases(target, aliases, nextSeen);
    }
  }
  return {
    name: t.name,
    args: t.args.map((a) => resolveAliases(a, aliases, seen)),
    resolution: t.resolution,
  };
};

const mapTdToCs = (t: ResolvedTypeRef): string => {
  if (isOption(t) && t.args.length === 1) {
    const inner = t.args[0];
    if (inner !== undefined) {
      return `${mapTdToCs(inner)}?`;
    }
  }
  const name = TD_TO_CS[t.name] ?? t.name;
  return t.args.length === 0 ? name : `${name}<${t.args.map(mapTdToCs).join(", ")}>`;
};

const toPascalCase = (s: string): string =>
  s
    .split(/[_\s-]+/)
    .filter((p) => p.length > 0)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join("");

const defaultValueForField = (t: ResolvedTypeRef): string => {
  if (isOption(t)) {
    return "";
  }
  if (isString(t)) {
    return " = string.Empty";
  }
  if (isList(t)) {
    const inner = t.args[0];
    return inner === undefined ? " = new()" : ` = new List<${mapTdToCs(inner)}>()`;
  }
  if (isMap(t)) {
    const k = t.args[0];
    const v = t.args[1];
    return k === undefined || v === undefined ? " = new()" : ` = new Dictionary<${mapTdToCs(k)}, ${mapTdToCs(v)}>()`;
  }
  return "";
};

const emitPropLine = (typeStr: string, propName: string, t: ResolvedTypeRef): string => {
  const def = defaultValueForField(t);
  return def === ""
    ? `    public ${typeStr} ${propName} { get; init; }`
    : `    public ${typeStr} ${propName} { get; init; }${def};`;
};

const csFieldType = (t: ResolvedTypeRef): string => {
  if (isList(t) && t.args.length === 1) {
    const inner = t.args[0];
    if (inner !== undefined) {
      return `IReadOnlyList<${mapTdToCs(inner)}>`;
    }
  }
  if (isMap(t) && t.args.length === 2) {
    const k = t.args[0];
    const v = t.args[1];
    if (k !== undefined && v !== undefined) {
      return `IReadOnlyDictionary<${mapTdToCs(k)}, ${mapTdToCs(v)}>`;
    }
  }
  return mapTdToCs(t);
};

const emitPropertyBagRecord = (
  name: string,
  fields: readonly { name: string; type: ResolvedTypeRef }[],
  generics: string[]
): string[] => {
  const genericsStr = generics.length > 0 ? `<${generics.join(", ")}>` : "";
  const lines = [`public sealed record ${name}${genericsStr}`, "{"];
  fields.forEach((f, idx) => {
    const pascal = toPascalCase(f.name);
    const typeStr = csFieldType(f.type);
    lines.push(`    [JsonPropertyName("${f.name}")]`);
    lines.push(emitPropLine(typeStr, pascal, f.type));
    if (idx < fields.length - 1) {
      lines.push("");
    }
  });
  lines.push("}");
  return lines;
};

const variantClassName = (unionName: string, variantName: string): string => `${unionName}${variantName}`;

const emitPayloadUnion = (
  name: string,
  variants: readonly { name: string; fields: readonly { name: string; type: ResolvedTypeRef }[] }[]
): string[] => {
  const lines: string[] = [`public interface I${name} { string Kind { get; } }`, ""];
  for (const v of variants) {
    const cls = variantClassName(name, v.name);
    const kindTag = v.name.toLowerCase();
    const hdr = [`public sealed record ${cls} : I${name}`, "{"];
    hdr.push(`    [JsonPropertyName("kind")]`);
    hdr.push(`    public string Kind { get; init; } = "${kindTag}";`);
    for (const f of v.fields) {
      const pascal = toPascalCase(f.name);
      const typeStr = csFieldType(f.type);
      hdr.push("");
      hdr.push(`    [JsonPropertyName("${f.name}")]`);
      hdr.push(`    public ${typeStr} ${pascal} { get; init; }${defaultValueForField(f.type)};`);
    }
    hdr.push("}");
    lines.push(...hdr, "");
  }
  return lines;
};

const emitBareEnum = (name: string, variants: readonly { name: string }[]): string[] => {
  const lines = [`public enum ${name}`, "{"];
  lines.push(variants.map((v) => `    ${v.name}`).join(",\n"));
  lines.push("}");
  return lines;
};

const buildUsings = (model: Model): string[] => {
  const usings = new Set<string>();
  const hasCollections = model.decls.some(
    (d) =>
      (d.kind === "record" && d.fields.some((f) => isList(f.type) || isMap(f.type))) ||
      (d.kind === "union" && d.variants.some((v) => v.fields.some((f) => isList(f.type) || isMap(f.type))))
  );
  const hasJson = model.decls.some((d) => d.kind === "record" || (d.kind === "union" && d.variants.some((v) => v.fields.length > 0)));
  if (hasCollections) {
    usings.add("System.Collections.Generic");
  }
  if (hasJson) {
    usings.add("System.Text.Json.Serialization");
  }
  return [...usings].sort().map((u) => `using ${u};`);
};

const inlineDecl = (d: ResolvedDecl, aliases: Map<string, ResolvedTypeRef>): ResolvedDecl => {
  if (d.kind === "record") {
    return {
      ...d,
      fields: d.fields.map((f) => ({ name: f.name, type: resolveAliases(f.type, aliases, new Set()) })),
    };
  }
  if (d.kind === "union") {
    return {
      ...d,
      variants: d.variants.map((v) => ({
        name: v.name,
        fields: v.fields.map((f) => ({ name: f.name, type: resolveAliases(f.type, aliases, new Set()) })),
      })),
    };
  }
  return d;
};

const toCSharp = (model: Model): string => {
  const aliases = buildAliasMap(model);
  const inlinedDecls = model.decls.map((d) => inlineDecl(d, aliases)).filter((d): d is Exclude<ResolvedDecl, ResolvedAlias> => d.kind !== "alias");
  const inlinedModel: Model = { ...model, decls: inlinedDecls };

  const lines: string[] = ["#nullable enable", ""];
  const usings = buildUsings(inlinedModel);
  if (usings.length > 0) {
    lines.push(...usings, "");
  }

  for (const d of inlinedDecls) {
    if (d.kind === "record") {
      lines.push(...emitPropertyBagRecord(d.name, d.fields, d.generics), "");
      continue;
    }
    const allEmpty = d.variants.every((v) => v.fields.length === 0);
    lines.push(...(allEmpty ? emitBareEnum(d.name, d.variants) : emitPayloadUnion(d.name, d.variants)), "");
  }

  return lines.join("\n");
};

export const csharp: Converter = {
  language: "csharp",
  fromSource: fromCSharp,
  toSource: (model) => toCSharp(model),
};
