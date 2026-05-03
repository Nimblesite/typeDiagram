export const PRIMITIVES: ReadonlySet<string> = new Set(["Bool", "Int", "Float", "String", "Bytes", "Unit"]);

export interface Model {
  decls: ResolvedDecl[];
  edges: Edge[];
  externals: string[];
}

export type ResolvedDecl = ResolvedRecord | ResolvedUnion | ResolvedAlias;

export interface ResolvedRecord {
  kind: "record";
  name: string;
  generics: string[];
  fields: ResolvedField[];
}

export interface ResolvedUnion {
  kind: "union";
  name: string;
  generics: string[];
  variants: ResolvedVariant[];
}

export interface ResolvedAlias {
  kind: "alias";
  name: string;
  generics: string[];
  target: ResolvedTypeRef;
}

export interface ResolvedField {
  name: string;
  type: ResolvedTypeRef;
}

export interface ResolvedVariant {
  name: string;
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

export type EdgeKind = "field" | "variantPayload" | "genericArg";

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
