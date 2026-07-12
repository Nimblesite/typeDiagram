// [CONV-PARSE-TYPEREF] Parse a type reference string like "Map<String, List<Int>>" into a ResolvedTypeRef.
import type { ResolvedTypeRef } from "../model/types.js";

/** Parse a type string into a ResolvedTypeRef tree. Resolution is left as "external" — the ModelBuilder resolves it. */
export const parseTypeRef = (raw: string): ResolvedTypeRef => {
  const s = raw.trim();
  const angleBracket = s.indexOf("<");
  const name = angleBracket === -1 ? s : s.slice(0, angleBracket);
  const args = angleBracket === -1 ? [] : splitGenericArgs(s.slice(angleBracket + 1, s.lastIndexOf(">")));
  return { name, args: args.map(parseTypeRef), resolution: { kind: "external" } };
};

/** Convert parsed `{ name, type }` field strings into model type references. */
export const resolveFieldTypes = (fields: readonly { name: string; type: string }[]) =>
  fields.map((field) => ({ name: field.name, type: parseTypeRef(field.type) }));

/** Split "A, B<C, D>, E" respecting nested angle brackets. */
export const splitGenericArgs = (s: string): string[] => {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charAt(i);
    depth += c === "<" ? 1 : c === ">" ? -1 : 0;
    if (c === "," && depth === 0) {
      parts.push(s.slice(start, i).trim());
      start = i + 1;
    }
  }
  const last = s.slice(start).trim();
  return last.length > 0 ? [...parts, last] : parts;
};

/** Emit a ResolvedTypeRef back to a type string like "Map<String, Int>". */
export const printTypeRef = (t: ResolvedTypeRef): string =>
  t.args.length === 0 ? t.name : `${t.name}<${t.args.map(printTypeRef).join(", ")}>`;

/**
 * [MODEL-SCALARS] Map a ref's name through a TD→language table, but never
 * remap a declared decl: a user-declared `alias Uuid = String` must keep its
 * own name in emitted source rather than become the builtin scalar's target.
 */
export const mapBuiltinName = (t: ResolvedTypeRef, table: Record<string, string>): string =>
  t.resolution.kind === "declared" ? t.name : (table[t.name] ?? t.name);

/** True when `t` is the builtin `Option<...>`. */
export const isOption = (t: ResolvedTypeRef): boolean => t.name === "Option";

/** True when `t` is the builtin `List<...>`. */
export const isList = (t: ResolvedTypeRef): boolean => t.name === "List";

/** True when `t` is the builtin `Map<...>`. */
export const isMap = (t: ResolvedTypeRef): boolean => t.name === "Map";
