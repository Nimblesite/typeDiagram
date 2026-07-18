// [MODEL-SCALARS] DateTime/Uuid/Decimal are semantic scalars so codegen can map
// them to native date/uuid/decimal types per language (GH issue #38).
export const PRIMITIVES: ReadonlySet<string> = new Set([
  "Bool",
  "Int",
  "Float",
  "String",
  "Bytes",
  "Unit",
  "DateTime",
  "Uuid",
  "Decimal",
]);

/** [MODEL-CODEGEN-UNKNOWN] Builtin names converters understand beyond PRIMITIVES. */
export const BUILTIN_GENERICS: ReadonlySet<string> = new Set(["List", "Map", "Option", "Any"]);

export interface Model {
  decls: ResolvedDecl[];
  edges: Edge[];
  externals: string[];
}

export type ResolvedDecl = ResolvedRecord | ResolvedUnion | ResolvedAlias | ResolvedFunction;
export type ResolvedDataDecl = Exclude<ResolvedDecl, ResolvedFunction>;

export interface DeclTargeting {
  targets?: string[];
  skipTargets?: string[];
}

export interface ResolvedRecord {
  kind: "record";
  name: string;
  generics: string[];
  fields: ResolvedField[];
  targeting?: DeclTargeting;
}

export interface ResolvedUnion {
  kind: "union";
  name: string;
  generics: string[];
  untagged?: true;
  variants: ResolvedVariant[];
  targeting?: DeclTargeting;
}

export interface ResolvedAlias {
  kind: "alias";
  name: string;
  generics: string[];
  target: ResolvedTypeRef;
  targeting?: DeclTargeting;
}

/** [DSL-FUNCTION] A free function; overloads share one diagram node. */
export interface ResolvedFunction {
  kind: "function";
  name: string;
  generics: string[];
  signatures: ResolvedFunctionSignature[];
  targeting?: DeclTargeting;
}

export interface ResolvedFunctionSignature {
  params: ResolvedField[];
  returns: ResolvedTypeRef;
  async?: true;
}

export interface ResolvedField {
  name: string;
  type: ResolvedTypeRef;
}

export interface ResolvedVariant {
  name: string;
  discriminant?: string;
  fields: ResolvedField[];
}

export function isTupleVariantFields(fields: readonly { name: string }[]): boolean {
  return fields.every((field, index) => field.name === `_${String(index)}`);
}

export interface ResolvedTypeRef {
  /** Original name as written, e.g. `List`, `Option`, `T`, `String`, `MyType`. */
  name: string;
  args: ResolvedTypeRef[];
  /** What this name refers to. */
  resolution: ResolvedRefKind;
}

export type ResolvedRefKind =
  | { kind: "declared"; declName: string }
  | { kind: "primitive" }
  | { kind: "typeParam"; owner: string }
  | { kind: "external" };

export type EdgeKind = "field" | "variantPayload" | "genericArg" | "parameter" | "return";

export interface Edge {
  /** Decl that owns the source row. */
  sourceDeclName: string;
  /** Index into `fields` (record) or `variants` (union). -1 means "from the decl header itself". */
  sourceRowIndex: number;
  /** For variant payloads pointing to a nested field, the field index inside that variant; otherwise null. */
  sourceVariantFieldIndex: number | null;
  /** Decl name targeted. Always points to a declared decl (we don't emit edges to externals/primitives). */
  targetDeclName: string;
  /** Display label (field name, variant name, etc.). */
  label: string;
  kind: EdgeKind;
}

export function shouldEmitDeclToTarget(decl: { targeting?: DeclTargeting }, target: string): boolean {
  const whitelist = decl.targeting?.targets;
  if (whitelist !== undefined && whitelist.length > 0 && !whitelist.includes(target)) {
    return false;
  }
  return decl.targeting?.skipTargets?.includes(target) !== true;
}

export function visibleDeclsForTarget<T extends { targeting?: DeclTargeting }>(
  decls: readonly T[],
  target: string
): T[] {
  return decls.filter((decl) => shouldEmitDeclToTarget(decl, target));
}

/** Data-only target emitters intentionally omit free-function service contracts. */
export function visibleDataDeclsForTarget(decls: readonly ResolvedDecl[], target: string): ResolvedDataDecl[] {
  return visibleDeclsForTarget(decls, target).filter((decl): decl is ResolvedDataDecl => decl.kind !== "function");
}

/** Visit every type ref in a decl, recursing into nested generic args. */
export function walkDeclRefs(d: ResolvedDecl, visit: (t: ResolvedTypeRef) => void): void {
  if (d.kind === "record") {
    for (const f of d.fields) {
      walkRef(f.type, visit);
    }
  } else if (d.kind === "union") {
    for (const v of d.variants) {
      for (const f of v.fields) {
        walkRef(f.type, visit);
      }
    }
  } else if (d.kind === "alias") {
    walkRef(d.target, visit);
  } else {
    for (const signature of d.signatures) {
      for (const param of signature.params) {
        walkRef(param.type, visit);
      }
      walkRef(signature.returns, visit);
    }
  }
}

function walkRef(t: ResolvedTypeRef, visit: (t: ResolvedTypeRef) => void): void {
  visit(t);
  for (const a of t.args) {
    walkRef(a, visit);
  }
}

/** True when any ref in any decl (incl. nested generic args) is named `name`. */
export function modelReferencesType(decls: readonly ResolvedDecl[], name: string): boolean {
  let found = false;
  for (const d of decls) {
    walkDeclRefs(d, (t) => {
      found = found || t.name === name;
    });
  }
  return found;
}
