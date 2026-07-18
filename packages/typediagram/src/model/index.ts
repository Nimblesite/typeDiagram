export { buildModel, buildModelPartial } from "./build.js";
export { ModelBuilder, alias, functionDecl, record, ref, resolveResolutions, union } from "./builder.js";
export type { FieldSpec, FunctionSignatureSpec, UnionSpec, VariantSpec } from "./builder.js";
export { fromJSON, toJSON, SCHEMA_VERSION } from "./json.js";
export type {
  AliasJson,
  DeclJson,
  FieldJson,
  FunctionJson,
  FunctionSignatureJson,
  ModelJson,
  RecordJson,
  TypeRefJson,
  UnionJson,
  VariantJson,
} from "./json.js";
export { printSource } from "./print.js";
export { validate, validateForCodegen } from "./validate.js";
export {
  PRIMITIVES,
  BUILTIN_GENERICS,
  modelReferencesType,
  walkDeclRefs,
  type DeclTargeting,
  type Edge,
  type EdgeKind,
  type Model,
  type ResolvedAlias,
  type ResolvedDecl,
  type ResolvedDataDecl,
  type ResolvedField,
  type ResolvedFunction,
  type ResolvedFunctionSignature,
  type ResolvedRecord,
  type ResolvedRefKind,
  type ResolvedTypeRef,
  type ResolvedUnion,
  type ResolvedVariant,
} from "./types.js";
