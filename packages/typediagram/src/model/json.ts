import type { Diagnostic } from "../parser/diagnostics.js";
import { type Result, err, ok } from "../result.js";
import { withDiscriminant } from "../variant.js";
import { resolveResolutions } from "./builder.js";
import type {
  DeclTargeting,
  Model,
  ResolvedAlias,
  ResolvedDecl,
  ResolvedField,
  ResolvedRecord,
  ResolvedTypeRef,
  ResolvedUnion,
  ResolvedVariant,
} from "./types.js";

export const SCHEMA_VERSION = 1;

export interface ModelJson {
  version: number;
  decls: DeclJson[];
}

export type DeclJson = RecordJson | UnionJson | AliasJson;

/** [MODEL-JSON-SHAPE] JSON decls mirror the resolved model minus every `resolution`
 * field: strip it recursively from the type refs and reuse the resolved shapes. */
export type TypeRefJson = Omit<ResolvedTypeRef, "resolution" | "args"> & { args: TypeRefJson[] };
export type FieldJson = Omit<ResolvedField, "type"> & { type: TypeRefJson };
export type VariantJson = Omit<ResolvedVariant, "fields"> & { fields: FieldJson[] };
export type RecordJson = Omit<ResolvedRecord, "fields"> & { fields: FieldJson[] };
export type UnionJson = Omit<ResolvedUnion, "variants"> & { variants: VariantJson[] };
export type AliasJson = Omit<ResolvedAlias, "target"> & { target: TypeRefJson };

export function toJSON(model: Model): ModelJson {
  return {
    version: SCHEMA_VERSION,
    decls: model.decls.map(declToJson),
  };
}

function declToJson(d: ResolvedDecl): DeclJson {
  if (d.kind === "record") {
    return {
      kind: "record",
      name: d.name,
      generics: [...d.generics],
      fields: d.fields.map((f) => ({ name: f.name, type: refToJson(f.type) })),
      ...(d.targeting === undefined ? {} : { targeting: { ...d.targeting } }),
    };
  }
  if (d.kind === "union") {
    return {
      kind: "union",
      name: d.name,
      generics: [...d.generics],
      ...(d.untagged === true ? { untagged: true as const } : {}),
      ...(d.targeting === undefined ? {} : { targeting: { ...d.targeting } }),
      variants: d.variants.map((v) =>
        withDiscriminant<VariantJson>(
          {
            name: v.name,
            fields: v.fields.map((f) => ({ name: f.name, type: refToJson(f.type) })),
          },
          v.discriminant
        )
      ),
    };
  }
  return {
    kind: "alias",
    name: d.name,
    generics: [...d.generics],
    target: refToJson(d.target),
    ...(d.targeting === undefined ? {} : { targeting: { ...d.targeting } }),
  };
}

function refToJson(t: ResolvedTypeRef): TypeRefJson {
  return { name: t.name, args: t.args.map(refToJson) };
}

export function fromJSON(json: unknown): Result<Model, Diagnostic[]> {
  const errs: Diagnostic[] = [];
  const fail = (msg: string): Result<Model, Diagnostic[]> => {
    errs.push({ severity: "error", message: msg, line: 0, col: 0, length: 0 });
    return err(errs);
  };

  if (typeof json !== "object" || json === null) {
    return fail("model JSON must be an object");
  }
  const j = json as Partial<ModelJson>;
  if (j.version !== SCHEMA_VERSION) {
    return fail(`unsupported schema version ${String(j.version)}`);
  }
  if (!Array.isArray(j.decls)) {
    return fail("missing 'decls' array");
  }

  const decls: ResolvedDecl[] = [];
  for (const d of j.decls) {
    const r = declFromJson(d);
    if (!r.ok) {
      return r;
    }
    decls.push(r.value);
  }

  const draft: Model = { decls, edges: [], externals: [] };
  return ok(resolveResolutions(draft));
}

function declFromJson(d: unknown): Result<ResolvedDecl, Diagnostic[]> {
  const errs: Diagnostic[] = [];
  const fail = (msg: string): Result<ResolvedDecl, Diagnostic[]> => {
    errs.push({ severity: "error", message: msg, line: 0, col: 0, length: 0 });
    return err(errs);
  };
  if (typeof d !== "object" || d === null) {
    return fail("decl must be an object");
  }
  const x = d as Partial<RecordJson | UnionJson | AliasJson> & Record<string, unknown>;
  if (typeof x.name !== "string") {
    return fail("decl.name must be a string");
  }
  if (!Array.isArray(x.generics)) {
    return fail("decl.generics must be an array");
  }

  if (x.kind === "record") {
    if (!Array.isArray(x.fields)) {
      return fail("record.fields must be an array");
    }
    const targeting = targetingFromJson(x.targeting);
    if (!targeting.ok) {
      return targeting;
    }
    return ok({
      kind: "record",
      name: x.name,
      generics: x.generics,
      fields: x.fields.map(fieldFromJson),
      ...(targeting.value === undefined ? {} : { targeting: targeting.value }),
    });
  }
  if (x.kind === "union") {
    if (!Array.isArray(x.variants)) {
      return fail("union.variants must be an array");
    }
    const targeting = targetingFromJson(x.targeting);
    if (!targeting.ok) {
      return targeting;
    }
    return ok({
      kind: "union",
      name: x.name,
      generics: x.generics,
      ...(x.untagged === true ? { untagged: true as const } : {}),
      variants: x.variants.map((v) =>
        withDiscriminant<ResolvedVariant>(
          {
            name: v.name,
            fields: v.fields.map(fieldFromJson),
          },
          v.discriminant
        )
      ),
      ...(targeting.value === undefined ? {} : { targeting: targeting.value }),
    });
  }
  if (x.kind === "alias") {
    if (!x.target) {
      return fail("alias.target required");
    }
    const targeting = targetingFromJson(x.targeting);
    if (!targeting.ok) {
      return targeting;
    }
    return ok({
      kind: "alias",
      name: x.name,
      generics: x.generics,
      target: refFromJson(x.target),
      ...(targeting.value === undefined ? {} : { targeting: targeting.value }),
    });
  }
  return fail(`unknown decl kind '${String(x.kind)}'`);
}

function targetingFromJson(value: unknown): Result<DeclTargeting | undefined, Diagnostic[]> {
  if (value === undefined) {
    return ok(undefined);
  }
  const errs: Diagnostic[] = [];
  const fail = (msg: string): Result<DeclTargeting | undefined, Diagnostic[]> => {
    errs.push({ severity: "error", message: msg, line: 0, col: 0, length: 0 });
    return err(errs);
  };
  if (typeof value !== "object" || value === null) {
    return fail("decl.targeting must be an object");
  }
  const targeting = value as { targets?: unknown; skipTargets?: unknown };
  if (targeting.targets !== undefined && !isStringArray(targeting.targets)) {
    return fail("decl.targeting.targets must be an array of strings");
  }
  if (targeting.skipTargets !== undefined && !isStringArray(targeting.skipTargets)) {
    return fail("decl.targeting.skipTargets must be an array of strings");
  }
  return ok({
    ...(targeting.targets === undefined ? {} : { targets: targeting.targets }),
    ...(targeting.skipTargets === undefined ? {} : { skipTargets: targeting.skipTargets }),
  });
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function fieldFromJson(f: FieldJson): { name: string; type: ResolvedTypeRef } {
  return { name: f.name, type: refFromJson(f.type) };
}

function refFromJson(t: TypeRefJson): ResolvedTypeRef {
  return {
    name: t.name,
    args: t.args.map(refFromJson),
    resolution: { kind: "external" }, // resolveResolutions will fix
  };
}
