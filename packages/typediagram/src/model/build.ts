import type { AliasDecl, Declaration, Diagram, Field, RecordDecl, TypeRef, UnionDecl, Variant } from "../parser/ast.js";
import { DiagnosticBag, type Diagnostic } from "../parser/diagnostics.js";
import { type Result, err, ok } from "../result.js";
import { withDiscriminant } from "../variant.js";
import {
  PRIMITIVES,
  type Edge,
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

  const edges = collectEdges(decls);

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

/** Walk a resolved typeRef and report every declared decl reached, with the first one (the head) flagged. */
function* walkDeclaredRefs(t: ResolvedTypeRef): Generator<{ declName: string; isHead: boolean; isArg: boolean }> {
  if (t.resolution.kind === "declared") {
    yield { declName: t.resolution.declName, isHead: true, isArg: false };
  }
  for (const a of t.args) {
    if (a.resolution.kind === "declared") {
      yield { declName: a.resolution.declName, isHead: false, isArg: true };
    }
    // recurse into deeper args (e.g. List<Option<X>>)
    for (const inner of walkDeclaredRefs(a)) {
      // already yielded the immediate arg above; skip its own head, but yield its arg-children.
      if (inner.isHead) {
        continue;
      }
      yield inner;
    }
  }
}

function collectEdges(decls: ResolvedDecl[]): Edge[] {
  const edges: Edge[] = [];
  const seen = new Set<string>();

  const push = (e: Edge): void => {
    const key = `${e.sourceDeclName}|${String(e.sourceRowIndex)}|${String(e.sourceVariantFieldIndex ?? -1)}|${e.targetDeclName}|${e.kind}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    edges.push(e);
  };

  for (const d of decls) {
    if (d.kind === "record") {
      d.fields.forEach((f, i) => {
        for (const ref of walkDeclaredRefs(f.type)) {
          push({
            sourceDeclName: d.name,
            sourceRowIndex: i,
            sourceVariantFieldIndex: null,
            targetDeclName: ref.declName,
            label: f.name,
            kind: ref.isHead ? "field" : "genericArg",
          });
        }
      });
    } else if (d.kind === "union") {
      d.variants.forEach((v, vi) => {
        v.fields.forEach((f, fi) => {
          for (const ref of walkDeclaredRefs(f.type)) {
            push({
              sourceDeclName: d.name,
              sourceRowIndex: vi,
              sourceVariantFieldIndex: fi,
              targetDeclName: ref.declName,
              label: `${v.name}.${f.name}`,
              kind: ref.isHead ? "variantPayload" : "genericArg",
            });
          }
        });
      });
    } else {
      // alias
      for (const ref of walkDeclaredRefs(d.target)) {
        push({
          sourceDeclName: d.name,
          sourceRowIndex: -1,
          sourceVariantFieldIndex: null,
          targetDeclName: ref.declName,
          label: "",
          kind: ref.isHead ? "field" : "genericArg",
        });
      }
    }
  }
  return edges;
}
