// [CONV-PY] Python <-> typeDiagram bidirectional converter.
import type { Diagnostic } from "../parser/diagnostics.js";
import { type Result, err } from "../result.js";
import type { Model, ResolvedDecl, ResolvedTypeRef } from "../model/types.js";
import { ModelBuilder, record, union } from "../model/builder.js";
import type { Converter, PythonOpts } from "./types.js";
import { parseTypeRef } from "./parse-typeref.js";

// ── Type mapping ──

const TD_TO_PY: Record<string, string> = {
  Bool: "bool",
  Int: "int",
  Float: "float",
  String: "str",
  Bytes: "bytes",
  Unit: "None",
  List: "list",
  Map: "dict",
  Option: "Optional",
  Any: "Any",
};

const PY_TO_TD: Record<string, string> = {
  bool: "Bool",
  int: "Int",
  float: "Float",
  str: "String",
  bytes: "Bytes",
  None: "Unit",
  list: "List",
  dict: "Map",
  Optional: "Option",
  List: "List",
  Dict: "Map",
  Set: "List",
  Tuple: "List",
};

// ── From Python ──

const CLASS_RE = /@dataclass\s*\n\s*class\s+(\w+)(?:\(([^)]*)\))?\s*:\s*\n((?:\s+\w+\s*:.+\n?)*)/g;
const ENUM_RE = /class\s+(\w+)\((?:str,\s*)?Enum\)\s*:\s*\n((?:[ \t]+\w+\s*=.+\n?)*)/g;
const TYPED_DICT_RE = /class\s+(\w+)\(TypedDict\)\s*:\s*\n((?:\s+\w+\s*:.+\n?)*)/g;
const PY_FIELD_RE = /(\w+)\s*:\s*(.+)/;

const mapPyType = (t: string): string => {
  const cleaned = t.trim().replace(/\s*#.*$/, "");
  const normalized = cleaned.replace(/\[/g, "<").replace(/\]/g, ">");
  const angleBracket = normalized.indexOf("<");
  const baseName = angleBracket === -1 ? normalized : normalized.slice(0, angleBracket);
  const mapped = PY_TO_TD[baseName] ?? baseName;
  if (angleBracket === -1) {
    return mapped;
  }
  const inner = normalized.slice(angleBracket + 1, normalized.lastIndexOf(">"));
  const args = splitPyArgs(inner).map(mapPyType);
  return `${mapped}<${args.join(", ")}>`;
};

const splitPyArgs = (s: string): string[] => {
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

const parsePyFields = (body: string) =>
  body
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"))
    .map((l) => {
      const m = PY_FIELD_RE.exec(l);
      if (m === null) {
        return null;
      }
      const [, name, type] = m;
      if (name === undefined || type === undefined) {
        return null;
      }
      return { name, type: mapPyType(type.replace(/\s*=.*$/, "").trim()) };
    })
    .filter((f): f is { name: string; type: string } => f !== null);

const fromPython = (source: string): Result<Model, Diagnostic[]> => {
  const builder = new ModelBuilder();
  let found = false;

  CLASS_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CLASS_RE.exec(source)) !== null) {
    const [, name, , body] = m;
    if (name === undefined || body === undefined) {
      continue;
    }
    found = true;
    const fields = parsePyFields(body).map((f) => ({ name: f.name, type: parseTypeRef(f.type) }));
    builder.add(record(name, fields));
  }

  TYPED_DICT_RE.lastIndex = 0;
  while ((m = TYPED_DICT_RE.exec(source)) !== null) {
    const [, name, body] = m;
    if (name === undefined || body === undefined) {
      continue;
    }
    found = true;
    const fields = parsePyFields(body).map((f) => ({ name: f.name, type: parseTypeRef(f.type) }));
    builder.add(record(name, fields));
  }

  ENUM_RE.lastIndex = 0;
  while ((m = ENUM_RE.exec(source)) !== null) {
    const [, name, body] = m;
    if (name === undefined || body === undefined) {
      continue;
    }
    found = true;
    const variants = body
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("#"))
      .map((l) => {
        const [variantName] = l.split("=");
        return { name: (variantName ?? l).trim(), fields: [] };
      });
    builder.add(union(name, variants));
  }

  return found
    ? builder.build()
    : err([{ severity: "error", message: "No Python type definitions found", line: 0, col: 0, length: 0 }]);
};

// ── To Python ──

const isOption = (t: ResolvedTypeRef): boolean => t.name === "Option";
const isList = (t: ResolvedTypeRef): boolean => t.name === "List";
const isMap = (t: ResolvedTypeRef): boolean => t.name === "Map";

const usesAny = (t: ResolvedTypeRef): boolean =>
  t.name === "Any" || t.args.some(usesAny);

const declUsesAny = (d: ResolvedDecl): boolean =>
  d.kind === "record"
    ? d.fields.some((f) => usesAny(f.type))
    : d.kind === "union"
      ? d.variants.some((v) => v.fields.some((f) => usesAny(f.type)))
      : usesAny(d.target);

const modelUsesAny = (model: Model): boolean => model.decls.some(declUsesAny);

const mapTdToPyDataclass = (t: ResolvedTypeRef): string => {
  const name = TD_TO_PY[t.name] ?? t.name;
  return t.args.length === 0 ? name : `${name}[${t.args.map(mapTdToPyDataclass).join(", ")}]`;
};

const mapTdToPyPydantic = (t: ResolvedTypeRef): string => {
  if (isOption(t) && t.args.length === 1) {
    const inner = t.args[0];
    if (inner !== undefined) {
      return `${mapTdToPyPydantic(inner)} | None`;
    }
  }
  const name = TD_TO_PY[t.name] ?? t.name;
  return t.args.length === 0 ? name : `${name}[${t.args.map(mapTdToPyPydantic).join(", ")}]`;
};

const dataclassFieldSuffix = (t: ResolvedTypeRef): string =>
  isOption(t) ? " = None" : isList(t) ? " = field(default_factory=list)" : isMap(t) ? " = field(default_factory=dict)" : "";

const pydanticFieldSuffix = (t: ResolvedTypeRef): string =>
  isOption(t) ? " = None" : isList(t) ? " = Field(default_factory=list)" : isMap(t) ? " = Field(default_factory=dict)" : "";

const needsDataclassField = (model: Model): boolean =>
  model.decls.some(
    (d) =>
      (d.kind === "record" && d.fields.some((f) => isList(f.type) || isMap(f.type))) ||
      (d.kind === "union" && d.variants.some((v) => v.fields.some((f) => isList(f.type) || isMap(f.type))))
  );

const hasBareEnum = (model: Model): boolean =>
  model.decls.some((d) => d.kind === "union" && d.variants.every((v) => v.fields.length === 0));

const hasOption = (model: Model): boolean =>
  model.decls.some(
    (d) =>
      (d.kind === "record" && d.fields.some((f) => isOption(f.type))) ||
      (d.kind === "union" && d.variants.some((v) => v.fields.some((f) => isOption(f.type)))) ||
      (d.kind === "alias" && isOption(d.target))
  );

const buildDataclassImports = (model: Model): string[] => {
  const lines = ["from __future__ import annotations"];
  const dataclassImports = ["dataclass"];
  if (needsDataclassField(model)) {
    dataclassImports.push("field");
  }
  lines.push(`from dataclasses import ${dataclassImports.join(", ")}`);
  if (hasBareEnum(model)) {
    lines.push("from enum import Enum");
  }
  const typingNames: string[] = [];
  if (hasOption(model)) {
    typingNames.push("Optional");
  }
  if (modelUsesAny(model)) {
    typingNames.push("Any");
  }
  if (typingNames.length > 0) {
    lines.push(`from typing import ${typingNames.join(", ")}`);
  }
  lines.push("");
  return lines;
};

const buildPydanticImports = (model: Model): string[] => {
  const lines = ["from __future__ import annotations", "from pydantic import BaseModel"];
  const hasCollections = model.decls.some(
    (d) =>
      (d.kind === "record" && d.fields.some((f) => isList(f.type) || isMap(f.type))) ||
      (d.kind === "union" && d.variants.some((v) => v.fields.some((f) => isList(f.type) || isMap(f.type))))
  );
  if (hasCollections) {
    lines.push("from pydantic import Field");
  }
  if (hasBareEnum(model)) {
    lines.push("from enum import Enum");
  }
  if (modelUsesAny(model)) {
    lines.push("from typing import Any");
  }
  lines.push("");
  return lines;
};

const emitDataclassRecord = (name: string, fields: readonly { name: string; type: ResolvedTypeRef }[]): string[] => {
  const lines = ["@dataclass", `class ${name}:`];
  if (fields.length === 0) {
    lines.push("    pass");
    return lines;
  }
  for (const f of fields) {
    lines.push(`    ${f.name}: ${mapTdToPyDataclass(f.type)}${dataclassFieldSuffix(f.type)}`);
  }
  return lines;
};

const emitPydanticRecord = (name: string, fields: readonly { name: string; type: ResolvedTypeRef }[]): string[] => {
  const lines = [`class ${name}(BaseModel):`];
  if (fields.length === 0) {
    lines.push("    pass");
    return lines;
  }
  for (const f of fields) {
    lines.push(`    ${f.name}: ${mapTdToPyPydantic(f.type)}${pydanticFieldSuffix(f.type)}`);
  }
  return lines;
};

const variantClassName = (unionName: string, variantName: string): string => `${unionName}${variantName}`;

const emitBareEnum = (name: string, variants: readonly { name: string }[]): string[] => {
  const lines = [`class ${name}(str, Enum):`];
  for (const v of variants) {
    lines.push(`    ${v.name} = "${v.name.toLowerCase()}"`);
  }
  return lines;
};

const toPython = (model: Model, opts?: PythonOpts): string => {
  const pydantic = opts?.style === "pydantic";
  const lines: string[] = pydantic ? buildPydanticImports(model) : buildDataclassImports(model);
  const emitRecord = pydantic ? emitPydanticRecord : emitDataclassRecord;

  for (const d of model.decls) {
    if (d.kind === "record") {
      lines.push(...emitRecord(d.name, d.fields), "");
    } else if (d.kind === "union") {
      const allEmpty = d.variants.every((v) => v.fields.length === 0);
      if (allEmpty) {
        lines.push(...emitBareEnum(d.name, d.variants), "");
        continue;
      }
      for (const v of d.variants.filter((x) => x.fields.length > 0)) {
        lines.push(...emitRecord(variantClassName(d.name, v.name), v.fields), "");
      }
      const variantTypes = d.variants.map((v) =>
        v.fields.length > 0 ? variantClassName(d.name, v.name) : `"${v.name}"`
      );
      lines.push(`${d.name} = ${variantTypes.join(" | ")}`, "");
    } else {
      const mapper = pydantic ? mapTdToPyPydantic : mapTdToPyDataclass;
      lines.push(`${d.name} = ${mapper(d.target)}`, "");
    }
  }

  return lines.join("\n");
};

export const python: Converter = {
  language: "python",
  fromSource: fromPython,
  toSource: (model, opts) => toPython(model, opts as PythonOpts | undefined),
};
