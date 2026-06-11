import type { Diagnostic } from "../parser/diagnostics.js";
import { type Result, err, ok } from "../result.js";
import { withDiscriminant } from "../variant.js";
import { validate } from "./validate.js";
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

export interface FieldSpec {
  name: string;
  type: ResolvedTypeRef;
}

export interface VariantSpec {
  name: string;
  discriminant?: string;
  fields?: FieldSpec[];
}

export interface UnionSpec {
  untagged?: boolean;
}

/** Build a TypeRef. Resolution is deferred to validate(). */
export function ref(name: string, args: ResolvedTypeRef[] = []): ResolvedTypeRef {
  return { name, args, resolution: { kind: "external" } };
}

export function record(name: string, fields: FieldSpec[], generics: string[] = []): ResolvedRecord {
  return { kind: "record", name, generics, fields: fields.map(toField) };
}

export function union(name: string, variants: VariantSpec[], generics: string[] = [], spec?: UnionSpec): ResolvedUnion {
  return {
    kind: "union",
    name,
    generics,
    ...(spec?.untagged === true ? { untagged: true as const } : {}),
    variants: variants.map(toVariant),
  };
}

export function alias(name: string, target: ResolvedTypeRef, generics: string[] = []): ResolvedAlias {
  return { kind: "alias", name, generics, target };
}

function toField(f: FieldSpec): ResolvedField {
  return { name: f.name, type: f.type };
}

function toVariant(v: VariantSpec): ResolvedVariant {
  return withDiscriminant<ResolvedVariant>(
    {
      name: v.name,
      fields: (v.fields ?? []).map(toField),
    },
    v.discriminant
  );
}

export class ModelBuilder {
  private readonly decls: ResolvedDecl[] = [];

  add(decl: ResolvedDecl): this {
    this.decls.push(decl);
    return this;
  }

  build(): Result<Model, Diagnostic[]> {
    const draft: Model = {
      decls: this.decls,
      edges: [],
      externals: [],
    };
    const resolved = resolveResolutions(draft);
    const diagnostics = validate(resolved);
    const errs = diagnostics.filter((d) => d.severity === "error");
    return errs.length === 0 ? ok(resolved) : err(diagnostics);
  }

  buildPartial(): { model: Model; diagnostics: Diagnostic[] } {
    const draft: Model = { decls: this.decls, edges: [], externals: [] };
    const resolved = resolveResolutions(draft);
    return { model: resolved, diagnostics: validate(resolved) };
  }
}

/** Walk a programmatically-built Model and fill in `resolution` and `edges` correctly. */
export function resolveResolutions(model: Model): Model {
  const declNames = new Map<string, ResolvedDecl>();
  for (const d of model.decls) {
    declNames.set(d.name, d);
  }

  const externals = new Set<string>();

  const fixRef = (t: ResolvedTypeRef, generics: Set<string>, owner: string): ResolvedTypeRef => {
    // Declared names win over PRIMITIVES — see resolveTypeRef in build.ts. [MODEL-SCALARS]
    let resolution: ResolvedRefKind;
    if (generics.has(t.name)) {
      resolution = { kind: "typeParam", owner };
    } else if (declNames.has(t.name)) {
      resolution = { kind: "declared", declName: t.name };
    } else if (PRIMITIVES.has(t.name)) {
      resolution = { kind: "primitive" };
    } else {
      externals.add(t.name);
      resolution = { kind: "external" };
    }
    return {
      name: t.name,
      args: t.args.map((a) => fixRef(a, generics, owner)),
      resolution,
    };
  };

  const newDecls: ResolvedDecl[] = model.decls.map((d) => {
    const generics = new Set(d.generics);
    if (d.kind === "record") {
      return {
        ...d,
        fields: d.fields.map((f) => ({ name: f.name, type: fixRef(f.type, generics, d.name) })),
      };
    }
    if (d.kind === "union") {
      return {
        ...d,
        variants: d.variants.map((v) =>
          withDiscriminant<ResolvedVariant>(
            {
              name: v.name,
              fields: v.fields.map((f) => ({ name: f.name, type: fixRef(f.type, generics, d.name) })),
            },
            v.discriminant
          )
        ),
      };
    }
    return { ...d, target: fixRef(d.target, generics, d.name) };
  });

  // rebuild edges from the resolved decls
  const out: Model = { decls: newDecls, edges: [], externals: [...externals].sort() };
  out.edges = computeEdges(out);
  return out;
}

function computeEdges(model: Model): Model["edges"] {
  // Defer to build.ts logic to avoid duplication: re-import lazily would create a cycle. Inline minimal version.
  const seen = new Set<string>();
  const edges: Model["edges"] = [];
  const push = (e: Model["edges"][number]): void => {
    const key = `${e.sourceDeclName}|${String(e.sourceRowIndex)}|${String(e.sourceVariantFieldIndex ?? -1)}|${e.targetDeclName}|${e.kind}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    edges.push(e);
  };

  function* walk(t: ResolvedTypeRef): Generator<{ declName: string; isHead: boolean }> {
    if (t.resolution.kind === "declared") {
      yield { declName: t.resolution.declName, isHead: true };
    }
    for (const a of t.args) {
      if (a.resolution.kind === "declared") {
        yield { declName: a.resolution.declName, isHead: false };
      }
      for (const inner of walk(a)) {
        if (inner.isHead) {
          continue;
        }
        yield inner;
      }
    }
  }

  for (const d of model.decls) {
    if (d.kind === "record") {
      d.fields.forEach((f, i) => {
        for (const r of walk(f.type)) {
          push({
            sourceDeclName: d.name,
            sourceRowIndex: i,
            sourceVariantFieldIndex: null,
            targetDeclName: r.declName,
            label: f.name,
            kind: r.isHead ? "field" : "genericArg",
          });
        }
      });
    } else if (d.kind === "union") {
      d.variants.forEach((v, vi) => {
        v.fields.forEach((f, fi) => {
          for (const r of walk(f.type)) {
            push({
              sourceDeclName: d.name,
              sourceRowIndex: vi,
              sourceVariantFieldIndex: fi,
              targetDeclName: r.declName,
              label: `${v.name}.${f.name}`,
              kind: r.isHead ? "variantPayload" : "genericArg",
            });
          }
        });
      });
    } else {
      for (const r of walk(d.target)) {
        push({
          sourceDeclName: d.name,
          sourceRowIndex: -1,
          sourceVariantFieldIndex: null,
          targetDeclName: r.declName,
          label: "",
          kind: r.isHead ? "field" : "genericArg",
        });
      }
    }
  }
  return edges;
}
