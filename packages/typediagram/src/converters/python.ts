// [CONV-PY] Python <-> typeDiagram bidirectional converter.
//
// Default dataclass style aims for round-trip fidelity with the home-page
// sample. Unions with struct variants emit as a set of per-variant
// `@dataclass` classes plus a `Name = VarA | VarB | "Bare"` alias line that
// the parser reads back as a union. Generic unions/records include
// `(Generic[T])`. Aliases emit as `Alias = Target`.
//
// Pydantic style is intentionally *not* kept lossless — it remains a
// convenience emitter for downstream use.
import type { Diagnostic } from "../parser/diagnostics.js";
import { type Result, err } from "../result.js";
import {
  modelReferencesType,
  visibleDeclsForTarget,
  type Model,
  type ResolvedDecl,
  type ResolvedTypeRef,
} from "../model/types.js";
import { ModelBuilder, record, union, alias } from "../model/builder.js";
import type { Converter, PythonOpts } from "./types.js";
import { mapBuiltinName, parseTypeRef, splitGenericArgs } from "./parse-typeref.js";

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
  DateTime: "datetime.datetime",
  Uuid: "uuid.UUID",
  Decimal: "decimal.Decimal",
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
  "datetime.datetime": "DateTime",
  datetime: "DateTime",
  "uuid.UUID": "Uuid",
  UUID: "Uuid",
  "decimal.Decimal": "Decimal",
  Decimal: "Decimal",
};

// [MODEL-SCALARS] stdlib module imported per scalar when the model uses it.
const PY_SCALAR_MODULES: ReadonlyArray<readonly [string, string]> = [
  ["DateTime", "datetime"],
  ["Uuid", "uuid"],
  ["Decimal", "decimal"],
];

const scalarImportLines = (decls: readonly ResolvedDecl[]): string[] =>
  PY_SCALAR_MODULES.filter(([scalar]) => modelReferencesType(decls, scalar)).map(([, mod]) => `import ${mod}`);

// ── From Python ──

const CLASS_RE = /@dataclass\s*\n\s*class\s+(\w+)(?:\(([^)]*)\))?\s*:\s*\n((?:\s+\w+\s*:.+\n?)*)/g;
const ENUM_RE = /class\s+(\w+)\((?:str,\s*)?Enum\)\s*:\s*\n((?:[ \t]+\w+\s*=.+\n?)*)/g;
const TYPED_DICT_RE = /class\s+(\w+)\(TypedDict\)\s*:\s*\n((?:\s+\w+\s*:.+\n?)*)/g;
const PY_FIELD_RE = /(\w+)\s*:\s*(.+)/;

// Union alias line emitted by toPython for struct-variant unions:
//   Option = OptionSome | "None"
// RHS is a `|`-separated list of variant-class names and/or string literals
// (for bare variants). Matches a whole line.
const UNION_ALIAS_RE = /^(\w+)\s*=\s*([\w"'|\s]+)\s*$/gm;

// Plain alias: `Email = str` or `IdList = list[str]`. Same LHS as union-alias
// but RHS lacks `|`. Parsed in a second pass so we can tell them apart.
const PLAIN_ALIAS_RE = /^(\w+)\s*=\s*(\w[\w\s[\],.]*)$/gm;

// Generic parameters: `class Foo(Generic[T])`, `class Foo(Generic[T, U])`,
// or `class Foo(Bar, Generic[T])`. We extract the bracketed list.
const GENERIC_BASE_RE = /Generic\[([^\]]+)\]/;

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
  const args = splitGenericArgs(inner).map(mapPyType);
  return `${mapped}<${args.join(", ")}>`;
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

const extractGenericsFromBases = (bases: string | undefined): string[] => {
  if (bases === undefined) {
    return [];
  }
  const gm = GENERIC_BASE_RE.exec(bases);
  if (gm?.[1] === undefined) {
    return [];
  }
  return gm[1]
    .split(",")
    .map((g) => g.trim())
    .filter((g) => g.length > 0);
};

// One pending parsed class or alias. We collect all decls with their source
// offsets and emit in source order so round-trip preserves declaration order.
type PendingDecl =
  | { kind: "class"; name: string; bases: string | undefined; body: string; offset: number }
  | { kind: "enum"; name: string; body: string; offset: number }
  | { kind: "typed-dict"; name: string; body: string; offset: number }
  | { kind: "union-alias"; name: string; rhs: string; offset: number }
  | { kind: "plain-alias"; name: string; rhs: string; offset: number };

const fromPython = (source: string): Result<Model, Diagnostic[]> => {
  const builder = new ModelBuilder();
  let found = false;
  const pending: PendingDecl[] = [];

  CLASS_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CLASS_RE.exec(source)) !== null) {
    const [, name, bases, body] = m;
    if (name === undefined || body === undefined) {
      continue;
    }
    pending.push({ kind: "class", name, bases, body, offset: m.index });
  }

  TYPED_DICT_RE.lastIndex = 0;
  while ((m = TYPED_DICT_RE.exec(source)) !== null) {
    const [, name, body] = m;
    if (name === undefined || body === undefined) {
      continue;
    }
    pending.push({ kind: "typed-dict", name, body, offset: m.index });
  }

  ENUM_RE.lastIndex = 0;
  while ((m = ENUM_RE.exec(source)) !== null) {
    const [, name, body] = m;
    if (name === undefined || body === undefined) {
      continue;
    }
    pending.push({ kind: "enum", name, body, offset: m.index });
  }

  const classNames = new Set(pending.filter((p) => p.kind === "class" || p.kind === "typed-dict").map((p) => p.name));
  const enumNames = new Set(pending.filter((p) => p.kind === "enum").map((p) => p.name));

  // Scan for top-level `=` lines. Distinguish:
  //   * Union-alias (`Foo = A | B | "C"`): has `|`.
  //   * Plain alias (`Email = str`): no `|`, and the LHS name isn't already a
  //     class/enum we've captured (to avoid re-capturing something like
  //     `ExampleValue = "x"` inside an enum body — enum bodies are multi-line
  //     but the regex is anchored to line start so we still need to filter).
  UNION_ALIAS_RE.lastIndex = 0;
  while ((m = UNION_ALIAS_RE.exec(source)) !== null) {
    const [, name, rhs] = m;
    if (name === undefined || rhs === undefined) {
      continue;
    }
    if (!rhs.includes("|")) {
      continue;
    }
    if (classNames.has(name) || enumNames.has(name)) {
      continue;
    }
    pending.push({ kind: "union-alias", name, rhs, offset: m.index });
  }

  const unionAliasNames = new Set(pending.filter((p) => p.kind === "union-alias").map((p) => p.name));

  PLAIN_ALIAS_RE.lastIndex = 0;
  while ((m = PLAIN_ALIAS_RE.exec(source)) !== null) {
    const [, name, rhs] = m;
    if (name === undefined || rhs === undefined) {
      continue;
    }
    if (classNames.has(name) || enumNames.has(name) || unionAliasNames.has(name)) {
      continue;
    }
    // Skip import lines, assignments like `x = 42`, TypeVar declarations,
    // etc. — keep only things that look like a type alias.
    const trimmed = rhs.trim();
    if (trimmed.length === 0 || /^[0-9"']/.test(trimmed) || trimmed.startsWith("TypeVar(")) {
      continue;
    }
    pending.push({ kind: "plain-alias", name, rhs: trimmed, offset: m.index });
  }

  pending.sort((a, b) => a.offset - b.offset);

  // Build a map of variant-class -> {union, variantName} so we can skip
  // emitting variant classes as standalone records. Union-alias RHS tells us
  // which classes to fold.
  type VariantInfo = { unionName: string; variantName: string };
  const variantClassToUnion = new Map<string, VariantInfo>();
  // Ordered per-union list of variants: each entry is either a class (record)
  // fold-in or a bare literal.
  type VariantDef = { name: string; className: string | null };
  const unionVariants = new Map<string, VariantDef[]>();
  for (const p of pending) {
    if (p.kind !== "union-alias") {
      continue;
    }
    const parts = p.rhs
      .split("|")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const variants: VariantDef[] = [];
    for (const part of parts) {
      const literalMatch = /^["'](.+)["']$/.exec(part);
      if (literalMatch?.[1] !== undefined) {
        variants.push({ name: literalMatch[1], className: null });
        continue;
      }
      const className = part;
      // Strip the union-name prefix from the class-name if present (e.g.
      // `OptionSome` -> `Some` under union `Option`).
      const variantName = className.startsWith(p.name) ? className.slice(p.name.length) : className;
      variants.push({ name: variantName, className });
      variantClassToUnion.set(className, { unionName: p.name, variantName });
    }
    unionVariants.set(p.name, variants);
  }

  for (const p of pending) {
    if (p.kind === "class" || p.kind === "typed-dict") {
      // If this class is a folded union variant, skip — it'll be emitted
      // under the union's variant list below.
      if (variantClassToUnion.has(p.name)) {
        continue;
      }
      found = true;
      const fields = parsePyFields(p.body).map((f) => ({ name: f.name, type: parseTypeRef(f.type) }));
      const generics = p.kind === "class" ? extractGenericsFromBases(p.bases) : [];
      builder.add(record(p.name, fields, generics));
      continue;
    }
    if (p.kind === "enum") {
      found = true;
      const variants = p.body
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !l.startsWith("#"))
        .map((l) => {
          const [variantName] = l.split("=");
          return { name: (variantName ?? l).trim(), fields: [] };
        });
      builder.add(union(p.name, variants));
      continue;
    }
    if (p.kind === "union-alias") {
      found = true;
      const variants = unionVariants.get(p.name) ?? [];
      const builtVariants = variants.map((v) => {
        if (v.className === null) {
          return { name: v.name, fields: [] };
        }
        const cls = pending.find((x) => (x.kind === "class" || x.kind === "typed-dict") && x.name === v.className);
        if (cls === undefined || (cls.kind !== "class" && cls.kind !== "typed-dict")) {
          return { name: v.name, fields: [] };
        }
        const fields = parsePyFields(cls.body).map((f) => ({ name: f.name, type: parseTypeRef(f.type) }));
        return { name: v.name, fields };
      });
      // Look for the first variant class's generics — generic unions (e.g.
      // Option[T]) emit their variants with the same generics.
      const firstCls = variants
        .map((v) => (v.className === null ? null : pending.find((x) => x.kind === "class" && x.name === v.className)))
        .find((x) => x !== null && x !== undefined);
      const generics = firstCls?.kind === "class" ? extractGenericsFromBases(firstCls.bases) : [];
      builder.add(union(p.name, builtVariants, generics));
      continue;
    }
    // plain-alias
    found = true;
    builder.add(alias(p.name, parseTypeRef(mapPyType(p.rhs))));
  }

  return found
    ? builder.build()
    : err([{ severity: "error", message: "No Python type definitions found", line: 0, col: 0, length: 0 }]);
};

// ── To Python ──

const isOption = (t: ResolvedTypeRef): boolean => t.name === "Option";
const isList = (t: ResolvedTypeRef): boolean => t.name === "List";
const isMap = (t: ResolvedTypeRef): boolean => t.name === "Map";

const mapTdToPyDataclass = (t: ResolvedTypeRef): string => {
  const name = mapBuiltinName(t, TD_TO_PY);
  return t.args.length === 0 ? name : `${name}[${t.args.map(mapTdToPyDataclass).join(", ")}]`;
};

const mapTdToPyPydantic = (t: ResolvedTypeRef): string => {
  if (isOption(t) && t.args.length === 1) {
    const inner = t.args[0];
    if (inner !== undefined) {
      return `${mapTdToPyPydantic(inner)} | None`;
    }
  }
  const name = mapBuiltinName(t, TD_TO_PY);
  return t.args.length === 0 ? name : `${name}[${t.args.map(mapTdToPyPydantic).join(", ")}]`;
};

const dataclassFieldSuffix = (t: ResolvedTypeRef): string =>
  isOption(t)
    ? " = None"
    : isList(t)
      ? " = field(default_factory=list)"
      : isMap(t)
        ? " = field(default_factory=dict)"
        : "";

const pydanticFieldSuffix = (t: ResolvedTypeRef): string =>
  isOption(t)
    ? " = None"
    : isList(t)
      ? " = Field(default_factory=list)"
      : isMap(t)
        ? " = Field(default_factory=dict)"
        : "";

const needsDataclassField = (decls: readonly ResolvedDecl[]): boolean =>
  decls.some(
    (d) =>
      (d.kind === "record" && d.fields.some((f) => isList(f.type) || isMap(f.type))) ||
      (d.kind === "union" && d.variants.some((v) => v.fields.some((f) => isList(f.type) || isMap(f.type))))
  );

const hasBareEnum = (decls: readonly ResolvedDecl[]): boolean =>
  decls.some((d) => d.kind === "union" && d.variants.every((v) => v.fields.length === 0));

const hasOption = (decls: readonly ResolvedDecl[]): boolean =>
  decls.some(
    (d) =>
      (d.kind === "record" && d.fields.some((f) => isOption(f.type))) ||
      (d.kind === "union" && d.variants.some((v) => v.fields.some((f) => isOption(f.type)))) ||
      (d.kind === "alias" && isOption(d.target))
  );

const hasGenerics = (decls: readonly ResolvedDecl[]): boolean => decls.some((d) => d.generics.length > 0);

const buildDataclassImports = (decls: readonly ResolvedDecl[]): string[] => {
  const lines = ["from __future__ import annotations", ...scalarImportLines(decls)];
  const dataclassImports = ["dataclass"];
  if (needsDataclassField(decls)) {
    dataclassImports.push("field");
  }
  lines.push(`from dataclasses import ${dataclassImports.join(", ")}`);
  if (hasBareEnum(decls)) {
    lines.push("from enum import Enum");
  }
  const typingNames: string[] = [];
  if (hasOption(decls)) {
    typingNames.push("Optional");
  }
  if (modelReferencesType(decls, "Any")) {
    typingNames.push("Any");
  }
  if (hasGenerics(decls)) {
    typingNames.push("Generic", "TypeVar");
  }
  if (typingNames.length > 0) {
    lines.push(`from typing import ${typingNames.join(", ")}`);
  }
  // Declare the TypeVars used across the model so `Generic[T]` resolves.
  const typeVars = new Set<string>();
  for (const d of decls) {
    for (const g of d.generics) {
      typeVars.add(g);
    }
  }
  if (typeVars.size > 0) {
    for (const tv of [...typeVars].sort()) {
      lines.push(`${tv} = TypeVar("${tv}")`);
    }
  }
  lines.push("");
  return lines;
};

const buildPydanticImports = (decls: readonly ResolvedDecl[]): string[] => {
  const lines = ["from __future__ import annotations", ...scalarImportLines(decls), "from pydantic import BaseModel"];
  const hasCollections = decls.some(
    (d) =>
      (d.kind === "record" && d.fields.some((f) => isList(f.type) || isMap(f.type))) ||
      (d.kind === "union" && d.variants.some((v) => v.fields.some((f) => isList(f.type) || isMap(f.type))))
  );
  if (hasCollections) {
    lines.push("from pydantic import Field");
  }
  if (hasBareEnum(decls)) {
    lines.push("from enum import Enum");
  }
  if (modelReferencesType(decls, "Any")) {
    lines.push("from typing import Any");
  }
  lines.push("");
  return lines;
};

const genericBase = (generics: string[]): string => (generics.length === 0 ? "" : `(Generic[${generics.join(", ")}])`);

const emitDataclassRecord = (
  name: string,
  fields: readonly { name: string; type: ResolvedTypeRef }[],
  generics: string[] = []
): string[] => {
  const lines = ["@dataclass", `class ${name}${genericBase(generics)}:`];
  if (fields.length === 0) {
    lines.push("    pass");
    return lines;
  }
  for (const f of fields) {
    lines.push(`    ${f.name}: ${mapTdToPyDataclass(f.type)}${dataclassFieldSuffix(f.type)}`);
  }
  return lines;
};

const emitPydanticRecord = (
  name: string,
  fields: readonly { name: string; type: ResolvedTypeRef }[],
  generics: string[] = []
): string[] => {
  const bases = generics.length > 0 ? `BaseModel, Generic[${generics.join(", ")}]` : "BaseModel";
  const lines = [`class ${name}(${bases}):`];
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
  const decls = visibleDeclsForTarget(model.decls, "python");
  const lines: string[] = pydantic ? buildPydanticImports(decls) : buildDataclassImports(decls);
  const emitRecord = pydantic ? emitPydanticRecord : emitDataclassRecord;

  for (const d of decls) {
    if (d.kind === "record") {
      lines.push(...emitRecord(d.name, d.fields, d.generics), "");
    } else if (d.kind === "union") {
      const allEmpty = d.variants.every((v) => v.fields.length === 0);
      if (allEmpty) {
        lines.push(...emitBareEnum(d.name, d.variants), "");
        continue;
      }
      for (const v of d.variants.filter((x) => x.fields.length > 0)) {
        lines.push(...emitRecord(variantClassName(d.name, v.name), v.fields, d.generics), "");
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
