// [TDBIN-UNION-STRUCT] Struct-form (`Circle { radius: Float }`) and
// multi-field tuple (`Pair(Int, String)`) union variants carry their payload
// exactly like a single-child variant: discriminant in data word 0, pointer
// slot 0 → a struct laid out by the normal [TDBIN-REC-ALLOC] rules. The Rust,
// TypeScript and manifest/hash code all plan that struct through ONE synthetic
// record per variant, so the three agree on the layout by construction while
// the user-facing ADT (and its JSON shape) stays untouched.
import {
  isTupleVariantFields,
  type ResolvedDecl,
  type ResolvedRecord,
  type ResolvedUnion,
  type ResolvedVariant,
} from "../model/types.js";

/** Name of the synthetic payload record for `variant` of `union`. */
export const variantPayloadName = (union: ResolvedUnion, variant: ResolvedVariant): string =>
  `${union.name}${variant.name}TdbinPayload`;

/** True when the variant's payload is several fields rather than one tuple value. */
export const isInlineVariant = (variant: ResolvedVariant): boolean =>
  variant.fields.length > 1 || (variant.fields.length === 1 && !isTupleVariantFields(variant.fields));

/** True when the variant uses tuple syntax (`_0`, `_1`, …). */
export const isTupleVariant = (variant: ResolvedVariant): boolean => isTupleVariantFields(variant.fields);

/** Payload-record field name: struct-form keeps the variant's field name;
 *  tuple position `i` becomes `v{i}` (`_0` is not a lint-clean Rust binding). */
export const payloadFieldName = (variant: ResolvedVariant, index: number): string =>
  isTupleVariant(variant) ? `v${String(index)}` : (variant.fields[index]?.name ?? `v${String(index)}`);

const payloadRecords = (union: ResolvedUnion): ResolvedRecord[] =>
  union.variants.filter(isInlineVariant).map((variant) => ({
    kind: "record",
    name: variantPayloadName(union, variant),
    generics: [],
    fields: variant.fields.map((field, index) => ({ name: payloadFieldName(variant, index), type: field.type })),
  }));

/** Every synthetic payload record the model's monomorphic unions need. */
export const variantRecords = (decls: readonly ResolvedDecl[]): ResolvedRecord[] =>
  decls.flatMap((d) => (d.kind === "union" && d.generics.length === 0 ? payloadRecords(d) : []));

/** `decls` plus its synthetic payload records (idempotent), for layout planning and manifests. */
export const withVariantRecords = (decls: readonly ResolvedDecl[]): ResolvedDecl[] => {
  const names = new Set(decls.map((d) => d.name));
  return [...decls, ...variantRecords(decls).filter((r) => !names.has(r.name))];
};
