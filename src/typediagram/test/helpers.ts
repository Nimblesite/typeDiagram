// [TEST-HELPERS] Shared test utilities for the core suites (model, parser,
// markdown, tdbin). Consolidates the Result-unwrap, TD->Model setup, decl
// counting, and diagnostic-severity shapes that would otherwise be inlined in
// every test case.
import type { Diagnostic } from "../src/parser/index.js";
import { parse } from "../src/parser/index.js";
import { buildModel } from "../src/model/index.js";
import type { Model } from "../src/model/types.js";

/** Unwrap a `Result`, throwing with the serialized error when it is `err`. */
export function unwrap<T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!r.ok) {
    throw new Error(`expected ok, got: ${JSON.stringify(r.error)}`);
  }
  return r.value;
}

/** Parse TD text and build a resolved Model, unwrapping both fallible steps. */
export function modelFromTd(td: string): Model {
  return unwrap(buildModel(unwrap(parse(td))));
}

/** Count declarations by kind, e.g. `{ record: 2, union: 2, alias: 1 }`. */
export function declCounts(decls: readonly { readonly kind: string }[]): Record<string, number> {
  return decls.reduce<Record<string, number>>((acc, d) => {
    acc[d.kind] = (acc[d.kind] ?? 0) + 1;
    return acc;
  }, {});
}

/** Find a named field on a named union variant. */
export function findVariantField<Field extends { readonly name: string }>(
  variants: readonly { readonly name: string; readonly fields: readonly Field[] }[],
  variantName: string,
  fieldName: string
) {
  return variants.find((variant) => variant.name === variantName)?.fields.find((field) => field.name === fieldName);
}

/** Whether any diagnostic in the bag has `severity: "error"`. */
export function hasError(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((d) => d.severity === "error");
}

/** Count rendered SVG opening tags in markdown output. */
export function svgCount(markdown: string) {
  return markdown.split("<svg").length - 1;
}
