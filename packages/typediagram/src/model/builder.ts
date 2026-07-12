import type { Diagnostic } from "../parser/diagnostics.js";
import { type Result, err, ok } from "../result.js";
import { withDiscriminant } from "../variant.js";
import { collectDeclEdges } from "./edges.js";
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
  out.edges = collectDeclEdges(out.decls);
  return out;
}
