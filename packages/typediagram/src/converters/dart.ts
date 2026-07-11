// [CONV-DART] Dart <-> typeDiagram bidirectional converter.
//
// Dart 3 sealed-class DUs:
//   sealed class ContentItem { }
//   final class Text extends ContentItem { final TextPart value; Text(this.value); }
//
// Option<T> <-> T?. Alias <-> `typedef Alias = Target;`.
// Generics use Dart's first-class type parameters.
import type { Diagnostic } from "../parser/diagnostics.js";
import { type Result, err } from "../result.js";
import { type Model, type ResolvedTypeRef } from "../model/types.js";
import { ModelBuilder, record, union, alias } from "../model/builder.js";
import type { Converter } from "./types.js";
import { emitDecls } from "./emit-decls.js";
import { isOption, mapBuiltinName, parseTypeRef } from "./parse-typeref.js";
import {
  extractTrailingNullable,
  formatGenericsDecl,
  parseGenericParamList,
  splitTopLevelCommas,
} from "./brace-lang.js";
import { makeConsumedTracker, orderBySource, scanAll, scanBraceBlocks } from "./scan-decls.js";

// ── Type mapping tables ──

const TD_TO_DART: Record<string, string> = {
  Bool: "bool",
  Int: "int",
  Float: "double",
  String: "String",
  Bytes: "List<int>",
  Unit: "void",
  List: "List",
  Map: "Map",
  Any: "Object",
  DateTime: "DateTime",
  Uuid: "String",
  Decimal: "String",
};

const DART_TO_TD: Record<string, string> = {
  bool: "Bool",
  int: "Int",
  double: "Float",
  num: "Float",
  String: "String",
  void: "Unit",
  List: "List",
  Map: "Map",
  Set: "List",
  Object: "Any",
  dynamic: "Any",
  DateTime: "DateTime",
};

// ── From Dart ──

// `typedef Email = String;`
const TYPEDEF_RE = /typedef\s+(\w+)(?:<([^>]+)>)?\s*=\s*([^;]+);/g;

// Sealed-class DU parent: `sealed class ContentItem<T> {` — body contains
// variant `final class`es OR we match sibling `final class Foo extends Parent`
// lines elsewhere in the file. Dart convention is to place variants as
// top-level siblings with `extends`/`implements`, so we parse that form.
const SEALED_CLASS_HEAD_RE = /sealed\s+class\s+(\w+)(?:<([^>]+)>)?\s*\{/g;

// Final/concrete class that extends or implements a sealed parent:
//   final class Text extends ContentItem { ... }
//   final class None<T> extends Option<T> { ... }
const EXTENDING_CLASS_HEAD_RE =
  /final\s+class\s+(\w+)(?:<([^>]+)>)?\s+(?:extends|implements)\s+(\w+)(?:<[^>]+>)?\s*\{/g;

// Regular (non-extending) class: `class Foo<T> { ... }` or `final class Foo`
// without a base. These are records.
const PLAIN_CLASS_HEAD_RE = /(?:final\s+)?class\s+(\w+)(?:<([^>]+)>)?\s*\{/g;

// Dart enum: `enum UriKind { Image, Audio, ... }`
const ENUM_RE = /enum\s+(\w+)\s*\{([^}]*)\}/g;

// Field declaration inside a class body:
//   final String name;
//   final List<Foo> tags;
//   final Map<String, int> metadata;
const FIELD_RE = /final\s+([\w<>,\s?]+?)\s+(\w+)\s*;/g;

const mapDartType = (t: string): string => {
  const nullableInner = extractTrailingNullable(t);
  if (nullableInner !== null) {
    return `Option<${mapDartType(nullableInner)}>`;
  }
  const trimmed = t.trim();
  const angleBracket = trimmed.indexOf("<");
  if (angleBracket !== -1) {
    const baseName = trimmed.slice(0, angleBracket);
    const mapped = DART_TO_TD[baseName] ?? baseName;
    const inner = trimmed.slice(angleBracket + 1, trimmed.lastIndexOf(">"));
    const args = splitTopLevelCommas(inner).map(mapDartType);
    return `${mapped}<${args.join(", ")}>`;
  }
  return DART_TO_TD[trimmed] ?? trimmed;
};

const parseDartFields = (body: string) => {
  const fields: Array<{ name: string; type: string }> = [];
  FIELD_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FIELD_RE.exec(body)) !== null) {
    const [, type, name] = m;
    /* v8 ignore next 3 — regex guarantees both captures */
    if (type === undefined || name === undefined) {
      continue;
    }
    fields.push({ name, type: mapDartType(type) });
  }
  return fields;
};

const fromDart = (source: string): Result<Model, Diagnostic[]> => {
  const builder = new ModelBuilder();
  let found = false;

  type PendingDecl =
    | { kind: "sealed-parent"; name: string; generics: string[]; offset: number }
    | { kind: "extending"; name: string; generics: string[]; parent: string; body: string; offset: number }
    | { kind: "record"; name: string; generics: string[]; body: string; offset: number }
    | { kind: "enum"; name: string; body: string; offset: number }
    | { kind: "alias"; name: string; generics: string[]; target: string; offset: number };
  const consumed = makeConsumedTracker();

  // 1. Sealed parents (union headers) — mark their bodies consumed.
  const sealedParents = scanBraceBlocks(source, SEALED_CLASS_HEAD_RE, { mark: consumed }).flatMap(
    (b): PendingDecl[] => {
      const [name, gens] = b.groups;
      /* v8 ignore next 3 — regex guarantees name is captured */
      return name === undefined
        ? []
        : [{ kind: "sealed-parent", name, generics: parseGenericParamList(gens), offset: b.offset }];
    }
  );

  // 2. Extending classes (variants) — also mark their bodies consumed.
  const extending = scanBraceBlocks(source, EXTENDING_CLASS_HEAD_RE, { mark: consumed }).flatMap((b): PendingDecl[] => {
    const [name, gens, parent] = b.groups;
    /* v8 ignore next 3 — regex guarantees both captures */
    return name === undefined || parent === undefined
      ? []
      : [{ kind: "extending", name, generics: parseGenericParamList(gens), parent, body: b.body, offset: b.offset }];
  });

  // 3. Plain classes (records) — skip anything inside sealed parents or that
  // matches the extending pattern (already captured).
  const records = scanBraceBlocks(source, PLAIN_CLASS_HEAD_RE, { skip: consumed }).flatMap((b): PendingDecl[] => {
    const [name, gens] = b.groups;
    /* v8 ignore next 3 — regex guarantees name is captured */
    return name === undefined
      ? []
      : [{ kind: "record", name, generics: parseGenericParamList(gens), body: b.body, offset: b.offset }];
  });

  // 4. Enums.
  const enums = scanAll(ENUM_RE, source, (m): PendingDecl | null => {
    const [, name, body] = m;
    /* v8 ignore next 3 — regex guarantees both captures */
    return name === undefined || body === undefined || consumed.isInside(m.index)
      ? null
      : { kind: "enum", name, body, offset: m.index };
  });

  // 5. Typedefs.
  const aliases = scanAll(TYPEDEF_RE, source, (m): PendingDecl | null => {
    const [, name, gens, target] = m;
    return name === undefined || target === undefined
      ? null
      : { kind: "alias", name, generics: parseGenericParamList(gens), target: target.trim(), offset: m.index };
  });

  const pending = orderBySource<PendingDecl>([...sealedParents, ...extending, ...records, ...enums, ...aliases]);

  // Group extending-classes under their sealed parents. Emit the sealed
  // parent at its source position, with variants in source order.
  const variantsByParent = new Map<string, Array<{ name: string; body: string; offset: number }>>();
  for (const p of pending) {
    if (p.kind !== "extending") {
      continue;
    }
    const list = variantsByParent.get(p.parent) ?? [];
    list.push({ name: p.name, body: p.body, offset: p.offset });
    variantsByParent.set(p.parent, list);
  }

  for (const p of pending) {
    if (p.kind === "extending") {
      // Handled under its parent below.
      continue;
    }
    found = true;
    if (p.kind === "sealed-parent") {
      const variants = orderBySource(variantsByParent.get(p.name) ?? []);
      builder.add(
        union(
          p.name,
          variants.map((v) => ({
            name: v.name,
            fields: parseDartFields(v.body).map((f) => ({ name: f.name, type: parseTypeRef(f.type) })),
          })),
          p.generics
        )
      );
      continue;
    }
    if (p.kind === "record") {
      const fields = parseDartFields(p.body).map((f) => ({ name: f.name, type: parseTypeRef(f.type) }));
      builder.add(record(p.name, fields, p.generics));
      continue;
    }
    if (p.kind === "enum") {
      const variants = p.body
        .split(",")
        .map((l) => l.replace(/\/\/.*$/, "").trim())
        .filter((l) => l.length > 0)
        .map((l) => ({ name: l, fields: [] }));
      builder.add(union(p.name, variants));
      continue;
    }
    // alias
    builder.add(alias(p.name, parseTypeRef(mapDartType(p.target)), p.generics));
  }

  return found
    ? builder.build()
    : err([{ severity: "error", message: "No Dart type definitions found", line: 0, col: 0, length: 0 }]);
};

// ── To Dart ──

const mapTdToDart = (t: ResolvedTypeRef): string => {
  if (isOption(t) && t.args.length === 1) {
    const inner = t.args[0];
    if (inner !== undefined) {
      return `${mapTdToDart(inner)}?`;
    }
  }
  const name = mapBuiltinName(t, TD_TO_DART);
  return t.args.length === 0 ? name : `${name}<${t.args.map(mapTdToDart).join(", ")}>`;
};

const emitRecord = (
  name: string,
  fields: readonly { name: string; type: ResolvedTypeRef }[],
  generics: string[]
): string[] => {
  const gens = formatGenericsDecl(generics);
  if (fields.length === 0) {
    return [`class ${name}${gens} {`, `  const ${name}();`, "}"];
  }
  const lines = [`class ${name}${gens} {`];
  for (const f of fields) {
    lines.push(`  final ${mapTdToDart(f.type)} ${f.name};`);
  }
  lines.push("");
  lines.push(`  const ${name}(${fields.map((f) => `this.${f.name}`).join(", ")});`);
  lines.push("}");
  return lines;
};

const emitExtendingVariant = (
  parentName: string,
  parentGenerics: string[],
  variantName: string,
  fields: readonly { name: string; type: ResolvedTypeRef }[]
): string[] => {
  const gens = formatGenericsDecl(parentGenerics);
  const extendsClause = `${parentName}${gens}`;
  if (fields.length === 0) {
    return [`final class ${variantName}${gens} extends ${extendsClause} {`, `  const ${variantName}();`, "}"];
  }
  const lines = [`final class ${variantName}${gens} extends ${extendsClause} {`];
  for (const f of fields) {
    lines.push(`  final ${mapTdToDart(f.type)} ${f.name};`);
  }
  lines.push("");
  lines.push(`  const ${variantName}(${fields.map((f) => `this.${f.name}`).join(", ")});`);
  lines.push("}");
  return lines;
};

const emitEnum = (name: string, variants: readonly { name: string }[]): string[] => {
  return [`enum ${name} {`, `  ${variants.map((v) => v.name).join(", ")}`, "}"];
};

const emitUnion = (
  name: string,
  variants: readonly { name: string; fields: readonly { name: string; type: ResolvedTypeRef }[] }[],
  generics: string[]
): string[] => {
  const allEmpty = variants.every((v) => v.fields.length === 0);
  if (allEmpty && generics.length === 0) {
    return emitEnum(name, variants);
  }
  const gens = formatGenericsDecl(generics);
  const lines = [`sealed class ${name}${gens} {`, `  const ${name}();`, "}"];
  for (const v of variants) {
    lines.push("");
    lines.push(...emitExtendingVariant(name, generics, v.name, v.fields));
  }
  return lines;
};

const emitAlias = (name: string, target: ResolvedTypeRef, generics: string[]): string => {
  const gens = formatGenericsDecl(generics);
  return `typedef ${name}${gens} = ${mapTdToDart(target)};`;
};

const toDart = (model: Model): string =>
  emitDecls(
    model,
    "dart",
    {
      record: (d) => emitRecord(d.name, d.fields, d.generics),
      union: (d) => emitUnion(d.name, d.variants, d.generics),
      alias: (d) => [emitAlias(d.name, d.target, d.generics)],
    },
    { trimTrailing: true }
  );

export const dart: Converter = {
  language: "dart",
  fromSource: fromDart,
  toSource: toDart,
};
