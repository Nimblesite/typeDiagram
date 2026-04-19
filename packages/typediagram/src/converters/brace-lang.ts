// [CONV-BRACE-LANG] Helpers shared by brace-based language converters
// (C#, Dart, and similar). Centralises balanced-body extraction, generic-arg
// splitting, and `T?` <-> Option<T> mapping.

/**
 * Given a position of an opening delimiter in `source`, return the contents
 * up to (but not including) the matching closing delimiter, respecting
 * nested pairs. Returns null if the input position isn't `open` or no match.
 */
export const extractBalancedBlock = (
  source: string,
  openIdx: number,
  open: string,
  close: string
): string | null => {
  if (source.charAt(openIdx) !== open) {
    return null;
  }
  let depth = 1;
  for (let i = openIdx + 1; i < source.length; i++) {
    const c = source.charAt(i);
    if (c === open) {
      depth += 1;
    } else if (c === close) {
      depth -= 1;
      if (depth === 0) {
        return source.slice(openIdx + 1, i);
      }
    }
  }
  return null;
};

/**
 * Split a string on top-level commas, respecting angle-bracket depth.
 * Used to parse generic-arg lists like `Map<String, Int>` without tearing the
 * inner comma.
 */
export const splitTopLevelCommas = (s: string): string[] => {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charAt(i);
    if (c === "<") {
      depth += 1;
    } else if (c === ">") {
      depth -= 1;
    } else if (c === "," && depth === 0) {
      parts.push(s.slice(start, i).trim());
      start = i + 1;
    }
  }
  const last = s.slice(start).trim();
  return last.length > 0 ? [...parts, last] : parts;
};

/** Format a generic parameter list as `<A, B>` (or empty string). */
export const formatGenericsDecl = (generics: readonly string[]): string =>
  generics.length === 0 ? "" : `<${generics.join(", ")}>`;

/**
 * If `t` has a trailing `?`, return the inner type; otherwise null.
 * Used by languages where `T?` encodes nullability (C#, Dart).
 */
export const extractTrailingNullable = (t: string): string | null => {
  const trimmed = t.trim();
  return trimmed.endsWith("?") ? trimmed.slice(0, -1).trim() : null;
};

/**
 * Parse a comma-separated generic-parameter list like `T, U extends Foo`
 * into its bare names. Trims trailing `extends`/`implements`/type-hint
 * clauses that follow the parameter name.
 */
export const parseGenericParamList = (s: string | undefined): string[] => {
  if (s === undefined || s.length === 0) {
    return [];
  }
  return s
    .split(",")
    .map((g) => g.trim())
    .map((g) => g.split(/\s+(?:extends|implements|:)\s+/)[0]?.trim() ?? g)
    // `T any`, `T comparable` (Go-style trailing constraint)
    .map((g) => g.split(/\s+/)[0] ?? g)
    .filter((g) => g.length > 0);
};
