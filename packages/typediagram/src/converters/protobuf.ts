// [CONV-PROTOBUF] Protocol Buffers (proto3) <-> typeDiagram bidirectional
// converter. See https://github.com/Nimblesite/typeDiagram/issues/2.
//
// Encoding:
//   - `type Foo { ... }`           -> `message Foo { ... }`
//   - `union Foo { unit variants }` -> `enum Foo { FOO_UNSPECIFIED=0; ... }`
//   - `union Foo { struct variants }` -> `message Foo { oneof variant { ... } }`
//     with each struct variant emitted as a nested `message`.
//   - `alias Email = String`       -> `// @td-alias: Email = String`
//   - `Option<T>`                  -> `optional T`
//   - `List<T>`                    -> `repeated T`
//   - `Map<K, V>`                  -> `map<K, V>`
//   - Generics (no native proto support) encoded via
//     `// @td-generics: T, U` on the containing message/enum.
//   - Fields whose typeDiagram type can't be expressed natively (e.g.
//     `Option<List<T>>`) carry a `// @td-type: <TD-type>` directive that the
//     parser prefers over the proto field type, guaranteeing round-trip.
import type { Diagnostic } from "../parser/diagnostics.js";
import { type Result, err } from "../result.js";
import { modelReferencesType, type Model, type ResolvedTypeRef, visibleDeclsForTarget } from "../model/types.js";
import { ModelBuilder, record, union, alias } from "../model/builder.js";
import type { Converter } from "./types.js";
import {
  isList,
  isMap,
  isOption,
  mapBuiltinName,
  parseTypeRef,
  printTypeRef,
  resolveFieldTypes,
} from "./parse-typeref.js";
import { extractBalancedBlock } from "./brace-lang.js";
import { emitDecls } from "./emit-decls.js";
import { makeConsumedTracker, orderBySource, scanAll, scanBraceBlocks } from "./scan-decls.js";

// ── Type mapping ──

const TD_TO_PROTO: Record<string, string> = {
  Bool: "bool",
  Int: "int64",
  Float: "double",
  String: "string",
  Bytes: "bytes",
  Unit: "google.protobuf.Empty",
  Any: "google.protobuf.Any",
  DateTime: "google.protobuf.Timestamp",
  Uuid: "string",
  Decimal: "string",
};

const PROTO_TO_TD: Record<string, string> = {
  bool: "Bool",
  int32: "Int",
  int64: "Int",
  uint32: "Int",
  uint64: "Int",
  sint32: "Int",
  sint64: "Int",
  fixed32: "Int",
  fixed64: "Int",
  sfixed32: "Int",
  sfixed64: "Int",
  float: "Float",
  double: "Float",
  string: "String",
  bytes: "Bytes",
  "google.protobuf.Empty": "Unit",
  "google.protobuf.Any": "Any",
  "google.protobuf.Timestamp": "DateTime",
};

// ── From proto ──

const MESSAGE_HEAD_RE = /message\s+(\w+)\s*\{/g;
const ENUM_HEAD_RE = /enum\s+(\w+)\s*\{/g;
const ONEOF_HEAD_RE = /oneof\s+\w+\s*\{/g;
const ALIAS_DIRECTIVE_RE = /\/\/\s*@td-alias:\s*(\w+)\s*=\s*(.+)$/gm;
const GENERICS_DIRECTIVE_RE = /\/\/\s*@td-generics:\s*([^\n]+)/;
const TYPE_DIRECTIVE_LINE_RE = /\/\/\s*@td-type:\s*(.+)$/;

// `optional string foo = 1;` or `repeated Foo bar = 2;` or `map<string, int32> m = 3;` or `Foo f = 4;`
const FIELD_LINE_RE = /^\s*(?:(optional|repeated)\s+)?([\w.<>,\s]+?)\s+(\w+)\s*=\s*\d+\s*;\s*$/;

const mapProtoType = (t: string): string => {
  const trimmed = t.trim();
  // map<K, V>
  const mapMatch = /^map\s*<\s*([^,]+)\s*,\s*(.+)\s*>$/.exec(trimmed);
  if (mapMatch?.[1] !== undefined && mapMatch[2] !== undefined) {
    return `Map<${mapProtoType(mapMatch[1])}, ${mapProtoType(mapMatch[2])}>`;
  }
  return PROTO_TO_TD[trimmed] ?? trimmed;
};

type Field = { name: string; type: string };

/**
 * Parse the contents of a proto `message` body into typeDiagram fields,
 * honouring `// @td-type:` directives for non-expressible types.
 */
const parseMessageFields = (body: string): Field[] => {
  const fields: Field[] = [];
  // Scan line by line so the directive seen immediately before a field can
  // override the proto-level type.
  const rawLines = body.split("\n");
  let pendingTdType: string | null = null;
  for (const rawLine of rawLines) {
    const line = rawLine.trim();
    if (line.length === 0) {
      continue;
    }
    const typeDirMatch = TYPE_DIRECTIVE_LINE_RE.exec(line);
    if (typeDirMatch?.[1] !== undefined) {
      pendingTdType = typeDirMatch[1].trim();
      continue;
    }
    if (line.startsWith("//")) {
      continue;
    }
    // Skip nested message/enum/oneof headers — they're handled by the
    // message-level scan, not as fields of the outer message.
    if (/^(message|enum|oneof)\b/.test(line)) {
      continue;
    }
    // Skip closing braces of nested blocks.
    if (line === "}") {
      continue;
    }
    const fm = FIELD_LINE_RE.exec(line);
    if (fm === null) {
      pendingTdType = null;
      continue;
    }
    const [, label, rawType, name] = fm;
    /* v8 ignore next 4 — regex guarantees both captures */
    if (rawType === undefined || name === undefined) {
      pendingTdType = null;
      continue;
    }
    if (pendingTdType !== null) {
      fields.push({ name, type: pendingTdType });
      pendingTdType = null;
      continue;
    }
    const mapped = mapProtoType(rawType);
    const wrapped = label === "repeated" ? `List<${mapped}>` : label === "optional" ? `Option<${mapped}>` : mapped;
    fields.push({ name, type: wrapped });
  }
  return fields;
};

/** Strip `FOO_` prefix from enum variant names emitted by us. */
const denormaliseEnumVariant = (enumName: string, variant: string): string => {
  const prefix = `${enumName.toUpperCase()}_`;
  if (variant.startsWith(prefix)) {
    return variant.slice(prefix.length);
  }
  return variant;
};

const fromProto = (source: string): Result<Model, Diagnostic[]> => {
  const builder = new ModelBuilder();
  let found = false;

  type PendingDecl =
    | { kind: "message"; name: string; body: string; generics: string[]; offset: number }
    | { kind: "enum"; name: string; body: string; generics: string[]; offset: number }
    | { kind: "alias"; name: string; target: string; offset: number };
  const consumed = makeConsumedTracker();

  // Look back up to ~128 chars for a generics directive that applies to the
  // decl starting at `offset`.
  const genericsBefore = (offset: number): string[] => {
    const windowStart = Math.max(0, offset - 128);
    const window = source.slice(windowStart, offset);
    const m = GENERICS_DIRECTIVE_RE.exec(window);
    if (m?.[1] === undefined) {
      return [];
    }
    return m[1]
      .split(",")
      .map((g) => g.trim())
      .filter((g) => g.length > 0);
  };

  const toBlockDecl =
    (kind: "message" | "enum") =>
    (b: { groups: ReadonlyArray<string | undefined>; body: string; offset: number }): PendingDecl[] => {
      const [name] = b.groups;
      /* v8 ignore next 3 — regex guarantees name is captured */
      return name === undefined
        ? []
        : [{ kind, name, body: b.body, generics: genericsBefore(b.offset), offset: b.offset }];
    };

  const pending: PendingDecl[] = [
    ...scanBraceBlocks(source, MESSAGE_HEAD_RE, { skip: consumed, mark: consumed }).flatMap(toBlockDecl("message")),
    ...scanBraceBlocks(source, ENUM_HEAD_RE, { skip: consumed, mark: consumed }).flatMap(toBlockDecl("enum")),
    ...scanAll(ALIAS_DIRECTIVE_RE, source, (m): PendingDecl | null => {
      const [, name, target] = m;
      /* v8 ignore next 3 — regex guarantees both captures */
      return name === undefined || target === undefined
        ? null
        : { kind: "alias", name, target: target.trim(), offset: m.index };
    }),
  ];

  for (const p of orderBySource(pending)) {
    found = true;
    if (p.kind === "message") {
      // A message with a `oneof variant { ... }` is a union with struct
      // variants (nested messages). A message without `oneof` is a record.
      const hasOneof = /\boneof\s+\w+\s*\{/.test(p.body);
      if (!hasOneof) {
        const fields = resolveFieldTypes(parseMessageFields(p.body));
        builder.add(record(p.name, fields, p.generics));
        continue;
      }

      // Collect nested messages as variant records and the oneof field names
      // to order them. Oneof field name (e.g. `some`) matches a nested
      // message (e.g. `Some`) by case-insensitive comparison.
      const nestedMessages = collectNestedMessages(p.body);
      const oneofVariantNames = collectOneofFieldNames(p.body);
      const variants = oneofVariantNames.map((voName) => {
        const nested = nestedMessages.find((nm) => nm.name.toLowerCase() === voName.toLowerCase());
        if (nested === undefined) {
          // Unit variant expressed as a `google.protobuf.Empty` field in the
          // oneof.
          return { name: capitalise(voName), fields: [] };
        }
        const fields = resolveFieldTypes(parseMessageFields(nested.body));
        return { name: nested.name, fields };
      });
      builder.add(union(p.name, variants, p.generics));
      continue;
    }
    if (p.kind === "enum") {
      const variants = p.body
        .split(/[;\n]/)
        .map((l) => l.replace(/\/\/.*$/, "").trim())
        .filter((l) => l.length > 0)
        .map((l) => {
          // `FOO_UNSPECIFIED = 0;` -> name = "FOO_UNSPECIFIED"
          const [variantName] = l.split("=");
          return (variantName ?? l).trim();
        })
        .filter((name) => name.length > 0)
        // Drop the synthetic zero-value entry we emit.
        .filter((name) => name !== `${p.name.toUpperCase()}_UNSPECIFIED`)
        .map((name) => ({ name: denormaliseEnumVariant(p.name, name), fields: [] }));
      builder.add(union(p.name, variants, p.generics));
      continue;
    }
    builder.add(alias(p.name, parseTypeRef(mapProtoType(p.target))));
  }

  return found
    ? builder.build()
    : err([{ severity: "error", message: "No Protobuf type definitions found", line: 0, col: 0, length: 0 }]);
};

const capitalise = (s: string): string => (s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1));

/** Find all nested `message Foo { ... }` blocks directly inside `body`. */
const collectNestedMessages = (body: string): Array<{ name: string; body: string }> => {
  const out: Array<{ name: string; body: string }> = [];
  const re = /message\s+(\w+)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const [full, name] = m;
    /* v8 ignore next 3 — regex guarantees name is captured */
    if (name === undefined) {
      continue;
    }
    const openIdx = m.index + full.length - 1;
    const inner = extractBalancedBlock(body, openIdx, "{", "}");
    if (inner === null) {
      continue;
    }
    out.push({ name, body: inner });
    // Skip past this block so we don't recurse into its own nested types.
    re.lastIndex = openIdx + inner.length + 2;
  }
  return out;
};

/** Return the variant-field names inside a `oneof variant { ... }` block, in order. */
const collectOneofFieldNames = (body: string): string[] => {
  ONEOF_HEAD_RE.lastIndex = 0;
  const m = ONEOF_HEAD_RE.exec(body);
  if (m === null) {
    return [];
  }
  const openIdx = m.index + m[0].length - 1;
  const inner = extractBalancedBlock(body, openIdx, "{", "}");
  if (inner === null) {
    return [];
  }
  // Each line: `Type name = N;` — we want `name`.
  return inner
    .split(";")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("//"))
    .map((l) => {
      const fm = /^([\w.]+)\s+(\w+)\s*=\s*\d+/.exec(l);
      return fm?.[2] ?? null;
    })
    .filter((n): n is string => n !== null);
};

// ── To proto ──

/**
 * Returns a proto3 expression for the given TD type, or null if the type
 * can't be expressed natively and needs a `@td-type` directive instead.
 */
const isContainer = (t: ResolvedTypeRef): boolean => isList(t) || isMap(t) || isOption(t);

const protoExpressionOf = (t: ResolvedTypeRef): { label: string; type: string } | null => {
  const [a0, a1] = t.args;
  if (isOption(t) && a0 !== undefined && !isContainer(a0)) {
    return { label: "optional", type: mapBuiltinName(a0, TD_TO_PROTO) };
  }
  if (isList(t) && a0 !== undefined && !isContainer(a0)) {
    return { label: "repeated", type: mapBuiltinName(a0, TD_TO_PROTO) };
  }
  if (isMap(t) && a0 !== undefined && a1 !== undefined && a0.args.length === 0 && a1.args.length === 0) {
    const keyName = mapBuiltinName(a0, TD_TO_PROTO);
    const valName = mapBuiltinName(a1, TD_TO_PROTO);
    return { label: "", type: `map<${keyName}, ${valName}>` };
  }
  if (t.args.length === 0) {
    return { label: "", type: mapBuiltinName(t, TD_TO_PROTO) };
  }
  return null;
};

const emitField = (field: { name: string; type: ResolvedTypeRef }, fieldNumber: number, indent: string): string[] => {
  const expr = protoExpressionOf(field.type);
  if (expr === null) {
    // Fall back to a `@td-type` directive with a placeholder repeated/bytes
    // encoding so the field is syntactically valid proto.
    const directive = `${indent}// @td-type: ${printTypeRef(field.type)}`;
    const placeholder = `${indent}repeated bytes ${field.name} = ${String(fieldNumber)};`;
    return [directive, placeholder];
  }
  const labelPart = expr.label.length > 0 ? `${expr.label} ` : "";
  return [`${indent}${labelPart}${expr.type} ${field.name} = ${String(fieldNumber)};`];
};

const emitMessageBody = (fields: readonly { name: string; type: ResolvedTypeRef }[], indent: string): string[] => {
  const lines: string[] = [];
  fields.forEach((f, i) => {
    lines.push(...emitField(f, i + 1, indent));
  });
  return lines;
};

const emitGenericsDirective = (generics: readonly string[], indent: string): string[] =>
  generics.length === 0 ? [] : [`${indent}// @td-generics: ${generics.join(", ")}`];

const emitEnum = (name: string, variants: readonly { name: string }[]): string[] => {
  const upper = name.toUpperCase();
  const lines = [`enum ${name} {`, `  ${upper}_UNSPECIFIED = 0;`];
  variants.forEach((v, i) => {
    lines.push(`  ${upper}_${v.name} = ${String(i + 1)};`);
  });
  lines.push("}");
  return lines;
};

const emitUnion = (
  name: string,
  variants: readonly { name: string; fields: readonly { name: string; type: ResolvedTypeRef }[] }[],
  generics: readonly string[]
): string[] => {
  const allEmpty = variants.every((v) => v.fields.length === 0);
  if (allEmpty && generics.length === 0) {
    return emitEnum(name, variants);
  }
  const lines: string[] = [];
  lines.push(...emitGenericsDirective(generics, ""));
  lines.push(`message ${name} {`);
  // Emit nested messages for each struct variant first, in variant order.
  variants.forEach((v) => {
    if (v.fields.length > 0) {
      lines.push(`  message ${v.name} {`);
      lines.push(...emitMessageBody(v.fields, "    "));
      lines.push("  }");
    }
  });
  lines.push("  oneof variant {");
  variants.forEach((v, i) => {
    const fieldName = v.name.toLowerCase();
    const fieldNumber = i + 1;
    if (v.fields.length === 0) {
      lines.push(`    google.protobuf.Empty ${fieldName} = ${String(fieldNumber)};`);
    } else {
      lines.push(`    ${v.name} ${fieldName} = ${String(fieldNumber)};`);
    }
  });
  lines.push("  }");
  lines.push("}");
  return lines;
};

const emitMessage = (
  name: string,
  fields: readonly { name: string; type: ResolvedTypeRef }[],
  generics: readonly string[]
): string[] => [...emitGenericsDirective(generics, ""), `message ${name} {`, ...emitMessageBody(fields, "  "), "}"];

const protoPrelude = (model: Model): string[] => {
  const lines = ['syntax = "proto3";', ""];
  return modelReferencesType(visibleDeclsForTarget(model.decls, "protobuf"), "DateTime")
    ? [...lines, 'import "google/protobuf/timestamp.proto";', ""]
    : lines;
};

const toProto = (model: Model): string =>
  emitDecls(
    model,
    "protobuf",
    {
      record: (d) => emitMessage(d.name, d.fields, d.generics),
      union: (d) => emitUnion(d.name, d.variants, d.generics),
      // alias — express as a directive since proto has no alias syntax.
      alias: (d) => [`// @td-alias: ${d.name} = ${printTypeRef(d.target)}`],
    },
    { prelude: protoPrelude(model), trimTrailing: true }
  );

export const protobuf: Converter = {
  language: "protobuf",
  fromSource: fromProto,
  toSource: toProto,
};
