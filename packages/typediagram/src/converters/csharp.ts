// [CONV-CS] C# <-> typeDiagram bidirectional converter.
//
// Discriminated-union encoding: closed hierarchy via `abstract record` with
// nested `sealed record` variants. Inspired by the RestClient.Net /
// Outcome library (https://github.com/MelbourneDeveloper/RestClient.Net).
// Stopgap until C# ships real DUs (https://github.com/dotnet/csharplang/issues/8928).
//
// Option<T> <-> T?. Alias <-> `using X = Y;`.
import type { Diagnostic } from "../parser/diagnostics.js";
import { type Result, err } from "../result.js";
import type { Model, ResolvedTypeRef } from "../model/types.js";
import { ModelBuilder, record, union, alias } from "../model/builder.js";
import type { Converter } from "./types.js";
import { parseTypeRef } from "./parse-typeref.js";
import {
  extractBalancedBlock,
  extractTrailingNullable,
  formatGenericsDecl,
  parseGenericParamList,
  splitTopLevelCommas,
} from "./brace-lang.js";

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

// Names that appear as aliases / global-usings (e.g. `System.String`, `String`
// from the `System` namespace). Strip leading `System.` segments so the name
// matches the base map.
const stripSystemPrefix = (s: string): string => s.replace(/^System\./, "");

// ── From C# ──

const mapCsType = (t: string): string => {
  const nullableInner = extractTrailingNullable(stripSystemPrefix(t.trim()));
  if (nullableInner !== null) {
    return `Option<${mapCsType(nullableInner)}>`;
  }
  const trimmed = stripSystemPrefix(t.trim());
  // byte[] -> Bytes
  if (trimmed === "byte[]") {
    return "Bytes";
  }
  const angleBracket = trimmed.indexOf("<");
  if (angleBracket !== -1) {
    const baseName = trimmed.slice(0, angleBracket);
    const mapped = CS_TO_TD[baseName] ?? baseName;
    const inner = trimmed.slice(angleBracket + 1, trimmed.lastIndexOf(">"));
    const args = splitTopLevelCommas(inner).map(mapCsType);
    return `${mapped}<${args.join(", ")}>`;
  }
  return CS_TO_TD[trimmed] ?? trimmed;
};

// `using Email = System.String;`  or  `using Email = string;`
const USING_ALIAS_RE = /using\s+(\w+)\s*=\s*([^;]+);/g;

// Primary-constructor record: `public sealed record ChatRequest(string Message, ...);`
const PRIMARY_RECORD_RE = /(?:public\s+)?(?:sealed\s+)?record\s+(\w+)(?:<([^>]+)>)?\s*\(([^)]*)\)\s*;/g;

// Abstract record heading a DU: `public abstract record Foo<T> {`
const ABSTRACT_RECORD_HEAD_RE = /(?:public\s+)?abstract\s+record\s+(\w+)(?:<([^>]+)>)?\s*\{/g;

// Enum with no payload: `public enum UriKind { Image, Audio, ... }`
const ENUM_RE = /(?:public\s+)?enum\s+(\w+)\s*\{([^}]*)\}/g;

// Nested variant inside an abstract record body.
// Struct-variant: `public sealed record Some(T value) : Foo<T>;`
// Unit-variant:   `public sealed record None : Foo<T>;`
const NESTED_VARIANT_RE =
  /(?:public\s+)?sealed\s+record\s+(\w+)(?:<[^>]+>)?\s*(?:\(([^)]*)\))?\s*:\s*\w+(?:<[^>]+>)?\s*;/g;

const PARAM_RE = /^([\w<>,\s\[\]?.]+?)\s+(\w+)$/;

const parseCsParams = (body: string) =>
  splitTopLevelCommas(body)
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

const fromCSharp = (source: string): Result<Model, Diagnostic[]> => {
  const builder = new ModelBuilder();
  let found = false;
  // Record which offsets we've already consumed as abstract-record bodies so
  // the primary-record scan doesn't re-pick-up nested `sealed record` lines.
  const consumedRanges: Array<[number, number]> = [];
  const isInsideConsumed = (idx: number): boolean =>
    consumedRanges.some(([start, end]) => idx >= start && idx < end);

  // First pass: locate abstract-record DU bodies and mark them consumed. We
  // defer adding the unions until we interleave them with records by source
  // order, so declaration order round-trips.
  type PendingDecl =
    | { kind: "record"; name: string; gens: string | undefined; params: string; offset: number }
    | {
        kind: "union-abstract";
        name: string;
        gens: string | undefined;
        variants: Array<{ name: string; params: string | undefined }>;
        offset: number;
      }
    | { kind: "union-enum"; name: string; body: string; offset: number }
    | { kind: "alias"; name: string; target: string; offset: number };
  const pending: PendingDecl[] = [];

  ABSTRACT_RECORD_HEAD_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ABSTRACT_RECORD_HEAD_RE.exec(source)) !== null) {
    const [full, name, gens] = m;
    if (name === undefined) {
      continue;
    }
    const openIdx = m.index + full.length - 1;
    const body = extractBalancedBlock(source, openIdx, "{", "}");
    if (body === null) {
      continue;
    }
    const endIdx = openIdx + body.length + 2;
    consumedRanges.push([openIdx, endIdx]);

    const variants: Array<{ name: string; params: string | undefined }> = [];
    NESTED_VARIANT_RE.lastIndex = 0;
    let vm: RegExpExecArray | null;
    while ((vm = NESTED_VARIANT_RE.exec(body)) !== null) {
      const [, vname, vparams] = vm;
      if (vname === undefined) {
        continue;
      }
      variants.push({ name: vname, params: vparams });
    }
    pending.push({ kind: "union-abstract", name, gens, variants, offset: m.index });
  }

  PRIMARY_RECORD_RE.lastIndex = 0;
  while ((m = PRIMARY_RECORD_RE.exec(source)) !== null) {
    if (isInsideConsumed(m.index)) {
      continue;
    }
    const [, name, gens, params] = m;
    if (name === undefined || params === undefined) {
      continue;
    }
    pending.push({ kind: "record", name, gens, params, offset: m.index });
  }

  ENUM_RE.lastIndex = 0;
  while ((m = ENUM_RE.exec(source)) !== null) {
    if (isInsideConsumed(m.index)) {
      continue;
    }
    const [, name, body] = m;
    if (name === undefined || body === undefined) {
      continue;
    }
    pending.push({ kind: "union-enum", name, body, offset: m.index });
  }

  USING_ALIAS_RE.lastIndex = 0;
  while ((m = USING_ALIAS_RE.exec(source)) !== null) {
    const [, name, target] = m;
    if (name === undefined || target === undefined) {
      continue;
    }
    pending.push({ kind: "alias", name, target: target.trim(), offset: m.index });
  }

  pending.sort((a, b) => a.offset - b.offset);

  for (const p of pending) {
    found = true;
    if (p.kind === "record") {
      const fields = parseCsParams(p.params).map((f) => ({ name: f.name, type: parseTypeRef(f.type) }));
      builder.add(record(p.name, fields, parseGenericParamList(p.gens)));
      continue;
    }
    if (p.kind === "union-abstract") {
      builder.add(
        union(
          p.name,
          p.variants.map((v) => {
            const fields =
              v.params === undefined || v.params.trim().length === 0
                ? []
                : parseCsParams(v.params).map((f) => ({ name: f.name, type: parseTypeRef(f.type) }));
            return { name: v.name, fields };
          }),
          parseGenericParamList(p.gens)
        )
      );
      continue;
    }
    if (p.kind === "union-enum") {
      const variants = p.body
        .split(",")
        .map((l) => l.replace(/\/\/.*$/, "").trim())
        .filter((l) => l.length > 0)
        .map((l) => {
          const [variantName] = l.split("=");
          return { name: (variantName ?? l).trim(), fields: [] };
        });
      builder.add(union(p.name, variants));
      continue;
    }
    builder.add(alias(p.name, parseTypeRef(mapCsType(p.target))));
  }

  return found
    ? builder.build()
    : err([{ severity: "error", message: "No C# type definitions found", line: 0, col: 0, length: 0 }]);
};

// ── To C# ──

const isOption = (t: ResolvedTypeRef): boolean => t.name === "Option";

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

const emitRecord = (name: string, fields: readonly { name: string; type: ResolvedTypeRef }[], generics: string[]): string[] => {
  const genericsStr = generics.length > 0 ? `<${generics.join(", ")}>` : "";
  if (fields.length === 0) {
    return [`public sealed record ${name}${genericsStr}();`];
  }
  const params = fields.map((f) => `${mapTdToCs(f.type)} ${f.name}`).join(", ");
  return [`public sealed record ${name}${genericsStr}(${params});`];
};

const emitUnion = (
  name: string,
  variants: readonly { name: string; fields: readonly { name: string; type: ResolvedTypeRef }[] }[],
  generics: string[]
): string[] => {
  const genericsStr = generics.length > 0 ? `<${generics.join(", ")}>` : "";
  const allEmpty = variants.every((v) => v.fields.length === 0);
  if (allEmpty && generics.length === 0) {
    // Plain enum: compact, familiar.
    const lines = [`public enum ${name}`, "{"];
    lines.push(variants.map((v) => `    ${v.name}`).join(",\n"));
    lines.push("}");
    return lines;
  }
  // Closed hierarchy: abstract record + nested sealed records.
  const lines = [`public abstract record ${name}${genericsStr}`, "{"];
  lines.push(`    private ${name}() { }`, "");
  variants.forEach((v, idx) => {
    if (v.fields.length === 0) {
      lines.push(`    public sealed record ${v.name} : ${name}${genericsStr};`);
    } else {
      const params = v.fields.map((f) => `${mapTdToCs(f.type)} ${f.name}`).join(", ");
      lines.push(`    public sealed record ${v.name}(${params}) : ${name}${genericsStr};`);
    }
    if (idx < variants.length - 1) {
      lines.push("");
    }
  });
  lines.push("}");
  return lines;
};

const emitAlias = (name: string, target: ResolvedTypeRef): string => {
  // `using Email = string;` style. System.String-prefixed primitives read
  // cleaner unqualified, so emit the mapped C# name directly.
  return `using ${name} = ${mapTdToCs(target)};`;
};

const toCSharp = (model: Model): string => {
  const lines: string[] = ["#nullable enable", ""];

  // Emit decls in their original model order. `using X = Y;` is valid at
  // file scope wherever it appears, so keeping aliases in source order
  // preserves round-trip order at the cost of the more idiomatic
  // "usings-at-top" layout.
  for (const d of model.decls) {
    if (d.kind === "record") {
      lines.push(...emitRecord(d.name, d.fields, d.generics), "");
    } else if (d.kind === "union") {
      lines.push(...emitUnion(d.name, d.variants, d.generics), "");
    } else {
      lines.push(emitAlias(d.name, d.target), "");
    }
  }

  return lines.join("\n");
};

export const csharp: Converter = {
  language: "csharp",
  fromSource: fromCSharp,
  toSource: toCSharp,
};
