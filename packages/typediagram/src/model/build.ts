import type { AliasDecl, Declaration, Diagram, Field, RecordDecl, TypeRef, UnionDecl, Variant } from "../parser/ast.js";
import { DiagnosticBag, type Diagnostic } from "../parser/diagnostics.js";
import { type Result, err, ok } from "../result.js";
import { withDiscriminant } from "../variant.js";
import { collectDeclEdges } from "./edges.js";
import {
  PRIMITIVES,
  type Model,
  type ResolvedAlias,
  type ResolvedDecl,
  type ResolvedField,
  type ResolvedRecord,
  type ResolvedRefKind,
  type ResolvedTypeRef,
  type ResolvedUnion,
  type ResolvedVariant,
} from "./types.js";

interface DeclEntry {
  decl: Declaration;
  generics: Set<string>;
  arity: number;
}

export function buildModelPartial(ast: Diagram): { model: Model; diagnostics: Diagnostic[] } {
  const bag = new DiagnosticBag();
  const declMap = new Map<string, DeclEntry>();
  for (const d of ast.decls) {
    if (declMap.has(d.name)) {
      bag.error(`duplicate declaration '${d.name}'`, d.span.line, d.span.col, d.span.length);
      continue;
    }
    declMap.set(d.name, { decl: d, generics: new Set(d.generics), arity: d.generics.length });
  }

  const externals = new Set<string>();
  const decls: ResolvedDecl[] = [];
  for (const d of ast.decls) {
    if (declMap.get(d.name)?.decl !== d) {
      continue;
    } // skip duplicates
    decls.push(resolveDecl(d, declMap, externals, bag));
  }

  const edges = collectDeclEdges(decls);

  const model: Model = {
    decls,
    edges,
    externals: [...externals].sort(),
  };
  return { model, diagnostics: bag.items };
}

export function buildModel(ast: Diagram): Result<Model, Diagnostic[]> {
  const { model, diagnostics } = buildModelPartial(ast);
  const errs = diagnostics.filter((d) => d.severity === "error");
  return errs.length === 0 ? ok(model) : err(diagnostics);
}

function resolveDecl(
  d: Declaration,
  declMap: Map<string, DeclEntry>,
  externals: Set<string>,
  bag: DiagnosticBag
): ResolvedDecl {
  const generics = new Set(d.generics);
  if (d.kind === "record") {
    return resolveRecord(d, declMap, externals, generics, bag);
  }
  if (d.kind === "union") {
    return resolveUnion(d, declMap, externals, generics, bag);
  }
  return resolveAlias(d, declMap, externals, generics, bag);
}

function resolveRecord(
  d: RecordDecl,
  declMap: Map<string, DeclEntry>,
  externals: Set<string>,
  generics: Set<string>,
  bag: DiagnosticBag
): ResolvedRecord {
  return {
    kind: "record",
    name: d.name,
    generics: [...d.generics],
    fields: d.fields.map((f) => resolveField(f, d.name, declMap, externals, generics, bag)),
    ...(d.targeting === undefined ? {} : { targeting: { ...d.targeting } }),
  };
}

function resolveUnion(
  d: UnionDecl,
  declMap: Map<string, DeclEntry>,
  externals: Set<string>,
  generics: Set<string>,
  bag: DiagnosticBag
): ResolvedUnion {
  return {
    kind: "union",
    name: d.name,
    generics: [...d.generics],
    ...(d.untagged === true ? { untagged: true as const } : {}),
    variants: d.variants.map((v) => resolveVariant(v, d.name, declMap, externals, generics, bag)),
    ...(d.targeting === undefined ? {} : { targeting: { ...d.targeting } }),
  };
}

function resolveAlias(
  d: AliasDecl,
  declMap: Map<string, DeclEntry>,
  externals: Set<string>,
  generics: Set<string>,
  bag: DiagnosticBag
): ResolvedAlias {
  return {
    kind: "alias",
    name: d.name,
    generics: [...d.generics],
    target: resolveTypeRef(d.target, d.name, declMap, externals, generics, bag),
    ...(d.targeting === undefined ? {} : { targeting: { ...d.targeting } }),
  };
}

function resolveVariant(
  v: Variant,
  ownerName: string,
  declMap: Map<string, DeclEntry>,
  externals: Set<string>,
  generics: Set<string>,
  bag: DiagnosticBag
): ResolvedVariant {
  return withDiscriminant<ResolvedVariant>(
    {
      name: v.name,
      fields: v.fields.map((f) => resolveField(f, ownerName, declMap, externals, generics, bag)),
    },
    v.discriminant
  );
}

function resolveField(
  f: Field,
  ownerName: string,
  declMap: Map<string, DeclEntry>,
  externals: Set<string>,
  generics: Set<string>,
  bag: DiagnosticBag
): ResolvedField {
  return {
    name: f.name,
    type: resolveTypeRef(f.type, ownerName, declMap, externals, generics, bag),
  };
}

function resolveTypeRef(
  t: TypeRef,
  ownerName: string,
  declMap: Map<string, DeclEntry>,
  externals: Set<string>,
  generics: Set<string>,
  bag: DiagnosticBag
): ResolvedTypeRef {
  // Declared names win over PRIMITIVES so pre-scalar diagrams that declare
  // e.g. `alias Uuid = String` keep their meaning. [MODEL-SCALARS]
  let resolution: ResolvedRefKind;
  const entry = declMap.get(t.name);
  if (generics.has(t.name)) {
    resolution = { kind: "typeParam", owner: ownerName };
  } else if (entry !== undefined) {
    if (t.args.length !== entry.arity) {
      bag.error(
        `type '${t.name}' takes ${String(entry.arity)} type argument(s), got ${String(t.args.length)}`,
        t.span.line,
        t.span.col,
        t.span.length
      );
    }
    resolution = { kind: "declared", declName: t.name };
  } else if (PRIMITIVES.has(t.name)) {
    resolution = { kind: "primitive" };
  } else {
    resolution = { kind: "external" };
    externals.add(t.name);
  }
  return {
    name: t.name,
    args: t.args.map((a) => resolveTypeRef(a, ownerName, declMap, externals, generics, bag)),
    resolution,
  };
}
