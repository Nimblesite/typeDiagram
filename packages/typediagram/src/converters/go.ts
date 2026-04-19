// [CONV-GO] Go <-> typeDiagram bidirectional converter.
//
// Discriminated-union encoding: interface + marker method per variant struct.
// Variant struct names are qualified with the union name (e.g.
// `ToolResultContentScalar`) to avoid top-level collisions. Field names are
// kept as-is (lowercase) since Go struct fields must be exported for JSON
// but we prioritise round-trip fidelity over idiomatic Go.
//
// Option<T> <-> *T.  Generics use Go 1.18+ type parameters (`[T any]`).
import type { Diagnostic } from "../parser/diagnostics.js";
import { type Result, err } from "../result.js";
import type { Model, ResolvedTypeRef } from "../model/types.js";
import { ModelBuilder, record, union, alias } from "../model/builder.js";
import type { Converter } from "./types.js";
import { parseTypeRef } from "./parse-typeref.js";

// ── Type mapping ──

const TD_TO_GO: Record<string, string> = {
  Bool: "bool",
  Int: "int64",
  Float: "float64",
  String: "string",
  Bytes: "[]byte",
  Unit: "struct{}",
};

const GO_TO_TD: Record<string, string> = {
  bool: "Bool",
  int: "Int",
  int8: "Int",
  int16: "Int",
  int32: "Int",
  int64: "Int",
  uint: "Int",
  uint8: "Int",
  uint16: "Int",
  uint32: "Int",
  uint64: "Int",
  float32: "Float",
  float64: "Float",
  string: "String",
  byte: "Int",
  rune: "Int",
};

// ── From Go ──

const STRUCT_HEAD_RE = /type\s+(\w+)(?:\[([^\]]+)\])?\s+struct\s*\{/g;
const IFACE_HEAD_RE = /type\s+(\w+)(?:\[([^\]]+)\])?\s+interface\s*\{/g;
const TYPE_ALIAS_RE = /type\s+(\w+)(?:\[([^\]]+)\])?\s+=?\s*([^\s{]+(?:\[[^\]]+\])?)\s*$/gm;
const FIELD_RE = /(\w+)\s+(.+)/;

// Marker-method pattern: `func (<Variant>[T]) is<Union>() {}`
const MARKER_METHOD_RE = /func\s+\((\w+)(?:\[[^\]]+\])?\)\s+is(\w+)\(\)\s*\{\s*\}/g;

const extractBalancedBody = (source: string, startIdx: number, open: string, close: string): string | null => {
  if (source.charAt(startIdx) !== open) {
    return null;
  }
  let depth = 1;
  for (let i = startIdx + 1; i < source.length; i++) {
    const c = source.charAt(i);
    if (c === open) {
      depth += 1;
    } else if (c === close) {
      depth -= 1;
      if (depth === 0) {
        return source.slice(startIdx + 1, i);
      }
    }
  }
  return null;
};

const mapGoType = (t: string): string => {
  const cleaned = t.trim().replace(/\s*`[^`]*`$/, "");
  if (cleaned.startsWith("[]")) {
    return `List<${mapGoType(cleaned.slice(2))}>`;
  }
  if (cleaned.startsWith("*")) {
    return `Option<${mapGoType(cleaned.slice(1))}>`;
  }
  if (cleaned.startsWith("map[")) {
    // Find the matching `]` at bracket depth 0.
    let depth = 1;
    let closeIdx = -1;
    for (let i = 4; i < cleaned.length; i++) {
      const c = cleaned.charAt(i);
      if (c === "[") {
        depth += 1;
      } else if (c === "]") {
        depth -= 1;
        if (depth === 0) {
          closeIdx = i;
          break;
        }
      }
    }
    if (closeIdx === -1) {
      return cleaned;
    }
    const key = cleaned.slice(4, closeIdx);
    const val = cleaned.slice(closeIdx + 1);
    return `Map<${mapGoType(key)}, ${mapGoType(val)}>`;
  }
  // Generic instantiation: `Foo[T, U]` -> `Foo<T, U>`
  const bracketIdx = cleaned.indexOf("[");
  if (bracketIdx !== -1 && cleaned.endsWith("]")) {
    const baseName = cleaned.slice(0, bracketIdx);
    const inner = cleaned.slice(bracketIdx + 1, cleaned.length - 1);
    const args = splitGoArgs(inner).map(mapGoType);
    return `${GO_TO_TD[baseName] ?? baseName}<${args.join(", ")}>`;
  }
  return GO_TO_TD[cleaned] ?? cleaned;
};

const splitGoArgs = (s: string): string[] => {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charAt(i);
    if (c === "[") {
      depth += 1;
    } else if (c === "]") {
      depth -= 1;
    } else if (c === "," && depth === 0) {
      parts.push(s.slice(start, i).trim());
      start = i + 1;
    }
  }
  const last = s.slice(start).trim();
  return last.length > 0 ? [...parts, last] : parts;
};

const parseGoFields = (body: string) =>
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
      return { name, type: mapGoType(type.replace(/\s*`[^`]*`$/, "").trim()) };
    })
    .filter((f): f is { name: string; type: string } => f !== null);

// Parse generic parameters like `T any, U comparable` -> ["T", "U"].
const parseGenericParams = (s: string | undefined): string[] =>
  s === undefined
    ? []
    : s
        .split(",")
        .map((g) => g.trim())
        .map((g) => {
          const space = g.indexOf(" ");
          return space === -1 ? g : g.slice(0, space);
        })
        .filter((g) => g.length > 0);

const fromGo = (source: string): Result<Model, Diagnostic[]> => {
  const builder = new ModelBuilder();
  let found = false;

  // First pass: collect all structs, interfaces, aliases, and marker-methods.
  type Struct = { name: string; generics: string[]; body: string; offset: number };
  type Iface = { name: string; generics: string[]; body: string; offset: number };
  const structs: Struct[] = [];
  const ifaces: Iface[] = [];

  STRUCT_HEAD_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = STRUCT_HEAD_RE.exec(source)) !== null) {
    const [full, name, gens] = m;
    if (name === undefined) {
      continue;
    }
    const openIdx = m.index + full.length - 1;
    const body = extractBalancedBody(source, openIdx, "{", "}");
    if (body === null) {
      continue;
    }
    structs.push({ name, generics: parseGenericParams(gens), body, offset: m.index });
  }

  IFACE_HEAD_RE.lastIndex = 0;
  while ((m = IFACE_HEAD_RE.exec(source)) !== null) {
    const [full, name, gens] = m;
    if (name === undefined) {
      continue;
    }
    const openIdx = m.index + full.length - 1;
    const body = extractBalancedBody(source, openIdx, "{", "}");
    if (body === null) {
      continue;
    }
    ifaces.push({ name, generics: parseGenericParams(gens), body, offset: m.index });
  }

  // Second pass: find marker methods `func (X[...]) is<Union>() {}` to link
  // variant structs to their unions.
  // variantToUnion: variantStructName -> unionName
  const variantToUnion = new Map<string, string>();
  // unionToVariants: unionName -> [{structName, offset}] (offset = method offset)
  const unionToVariants = new Map<string, Array<{ structName: string; offset: number }>>();
  MARKER_METHOD_RE.lastIndex = 0;
  while ((m = MARKER_METHOD_RE.exec(source)) !== null) {
    const [, variantStruct, unionName] = m;
    if (variantStruct === undefined || unionName === undefined) {
      continue;
    }
    variantToUnion.set(variantStruct, unionName);
    const list = unionToVariants.get(unionName) ?? [];
    list.push({ structName: variantStruct, offset: m.index });
    unionToVariants.set(unionName, list);
  }

  type PendingDecl =
    | { kind: "record"; name: string; generics: string[]; body: string; offset: number }
    | { kind: "union"; name: string; generics: string[]; offset: number }
    | { kind: "alias"; name: string; target: string; offset: number };
  const pending: PendingDecl[] = [];

  const structsByName = new Map(structs.map((s) => [s.name, s]));
  const ifaceNames = new Set(ifaces.map((i) => i.name));

  for (const s of structs) {
    if (variantToUnion.has(s.name)) {
      // Variant-struct: handled under its union below.
      continue;
    }
    pending.push({ kind: "record", name: s.name, generics: s.generics, body: s.body, offset: s.offset });
  }

  for (const i of ifaces) {
    pending.push({ kind: "union", name: i.name, generics: i.generics, offset: i.offset });
  }

  TYPE_ALIAS_RE.lastIndex = 0;
  while ((m = TYPE_ALIAS_RE.exec(source)) !== null) {
    const [, name, gens, rawTarget] = m;
    if (name === undefined || rawTarget === undefined) {
      continue;
    }
    const target = rawTarget.trim();
    if (structsByName.has(name) || ifaceNames.has(name)) {
      continue;
    }
    if (target === "struct" || target === "interface" || target.length === 0) {
      continue;
    }
    // Ignore `type alias = Generic[foo]` form (no `=`) mistaken matches.
    // Skip if the generics clause looks like a constraint list (contains
    // ` any` etc.) — the regex already handles header detection but be
    // defensive.
    const generics = parseGenericParams(gens);
    pending.push({ kind: "alias", name, target: mapGoTypeWithGenerics(target, generics), offset: m.index });
  }

  pending.sort((a, b) => a.offset - b.offset);

  for (const p of pending) {
    found = true;
    if (p.kind === "record") {
      const fields = parseGoFields(p.body).map((f) => ({ name: f.name, type: parseTypeRef(f.type) }));
      builder.add(record(p.name, fields, p.generics));
      continue;
    }
    if (p.kind === "union") {
      const variantEntries = (unionToVariants.get(p.name) ?? []).slice().sort((a, b) => a.offset - b.offset);
      let variants: Array<{ name: string; fields: Array<{ name: string; type: ReturnType<typeof parseTypeRef> }> }>;
      if (variantEntries.length > 0) {
        // Marker-method pattern.
        variants = variantEntries.map((v) => {
          const cls = structsByName.get(v.structName);
          const variantName = v.structName.startsWith(p.name) ? v.structName.slice(p.name.length) : v.structName;
          if (cls === undefined || cls.body.trim().length === 0) {
            return { name: variantName, fields: [] };
          }
          const fields = parseGoFields(cls.body).map((f) => ({ name: f.name, type: parseTypeRef(f.type) }));
          return { name: variantName, fields };
        });
      } else {
        // Fallback: embedded-type pattern. Iface body is a list of type names,
        // each of which is either a bare variant (unit) or a struct elsewhere.
        const iface = ifaces.find((i) => i.name === p.name);
        const embedded =
          iface === undefined
            ? []
            : iface.body
                .split("\n")
                .map((l) => l.trim())
                .filter((l) => l.length > 0 && !l.startsWith("//"))
                // Strip function-shaped lines like `isShape()` — method
                // declarations, not embedded types.
                .filter((l) => !l.includes("("))
                .filter((l) => /^\w+$/.test(l));
        variants = embedded.map((vname) => {
          const cls = structsByName.get(vname);
          if (cls === undefined || cls.body.trim().length === 0) {
            return { name: vname, fields: [] };
          }
          const fields = parseGoFields(cls.body).map((f) => ({ name: f.name, type: parseTypeRef(f.type) }));
          return { name: vname, fields };
        });
        // Legacy behaviour: empty interface -> one "Unknown" variant.
        if (variants.length === 0) {
          variants.push({ name: "Unknown", fields: [] });
        }
      }
      builder.add(union(p.name, variants, p.generics));
      continue;
    }
    builder.add(alias(p.name, parseTypeRef(p.target)));
  }

  return found
    ? builder.build()
    : err([{ severity: "error", message: "No Go type definitions found", line: 0, col: 0, length: 0 }]);
};

// For type aliases with generics (`type IdList[T any] = []T`), wrapping
// mapGoType with a generics-aware context isn't yet needed for the home
// page example — plain aliases suffice. This is kept as a seam for later.
const mapGoTypeWithGenerics = (t: string, _generics: string[]): string => mapGoType(t);

// ── To Go ──

const mapTdToGo = (t: ResolvedTypeRef): string => {
  const [a0, a1] = t.args;
  if (t.name === "List" && t.args.length === 1 && a0 !== undefined) {
    return `[]${mapTdToGo(a0)}`;
  }
  if (t.name === "Option" && t.args.length === 1 && a0 !== undefined) {
    return `*${mapTdToGo(a0)}`;
  }
  if (t.name === "Map" && t.args.length === 2 && a0 !== undefined && a1 !== undefined) {
    return `map[${mapTdToGo(a0)}]${mapTdToGo(a1)}`;
  }
  const name = TD_TO_GO[t.name] ?? t.name;
  return t.args.length === 0 ? name : `${name}[${t.args.map(mapTdToGo).join(", ")}]`;
};

const goGenericsDecl = (generics: string[]): string =>
  generics.length === 0 ? "" : `[${generics.map((g) => `${g} any`).join(", ")}]`;

const goGenericsInstance = (generics: string[]): string => (generics.length === 0 ? "" : `[${generics.join(", ")}]`);

const variantStructName = (unionName: string, variantName: string): string => `${unionName}${variantName}`;

const toGo = (model: Model): string => {
  const lines: string[] = ["package types", ""];

  for (const d of model.decls) {
    if (d.kind === "record") {
      const gens = goGenericsDecl(d.generics);
      lines.push(`type ${d.name}${gens} struct {`);
      for (const f of d.fields) {
        lines.push(`\t${f.name} ${mapTdToGo(f.type)}`);
      }
      lines.push("}", "");
      continue;
    }
    if (d.kind === "union") {
      const gensDecl = goGenericsDecl(d.generics);
      const gensInst = goGenericsInstance(d.generics);
      lines.push(`type ${d.name}${gensDecl} interface {`, `\tis${d.name}()`, "}", "");
      for (const v of d.variants) {
        const vname = variantStructName(d.name, v.name);
        if (v.fields.length === 0) {
          lines.push(`type ${vname}${gensDecl} struct{}`, "");
        } else {
          lines.push(`type ${vname}${gensDecl} struct {`);
          for (const f of v.fields) {
            lines.push(`\t${f.name} ${mapTdToGo(f.type)}`);
          }
          lines.push("}", "");
        }
        lines.push(`func (${vname}${gensInst}) is${d.name}() {}`, "");
      }
      continue;
    }
    lines.push(`type ${d.name} = ${mapTdToGo(d.target)}`, "");
  }

  return lines.join("\n");
};

export const go: Converter = {
  language: "go",
  fromSource: fromGo,
  toSource: toGo,
};
