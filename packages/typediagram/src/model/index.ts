export { buildModel, buildModelPartial } from "./build.js";
export { ModelBuilder, alias, record, ref, resolveResolutions, union } from "./builder.js";
export type { FieldSpec, VariantSpec } from "./builder.js";
export { fromJSON, toJSON, SCHEMA_VERSION } from "./json.js";
export type {
  AliasJson,
  DeclJson,
  FieldJson,
  ModelJson,
  RecordJson,
  TypeRefJson,
  UnionJson,
  VariantJson,
} from "./json.js";
export { printSource } from "./print.js";
export { validate } from "./validate.js";
export {
  PRIMITIVES,
  type Edge,
  type EdgeKind,
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
