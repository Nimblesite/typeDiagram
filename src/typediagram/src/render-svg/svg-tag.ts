/** XML/HTML attribute escape — the only escape we need for SVG strings. */
export function escapeAttr(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&apos;";
      default:
        return c;
    }
  });
}

export function escapeText(s: string): string {
  return s.replace(/[&<>]/g, (c) => {
    switch (c) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      default:
        return c;
    }
  });
}

const SAFE = Symbol("safe-svg");

/** A string wrapper that bypasses escaping when interpolated into svg``. */
export type SafeSvg = { readonly [SAFE]: true; readonly value: string };

/** Mark a raw SVG string as trusted — won't be escaped in svg``. */
export const raw = (s: string): SafeSvg => ({ [SAFE]: true, value: s });

const isSafe = (v: unknown): v is SafeSvg => typeof v === "object" && v !== null && SAFE in v;

/** Tagged template that escapes interpolated values. Numbers and SafeSvg pass through raw. */
export function svg(strings: TemplateStringsArray, ...values: Array<string | number | SafeSvg>): SafeSvg {
  let out = strings[0] ?? "";
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === undefined) {
      continue;
    }
    out += typeof v === "number" ? String(v) : isSafe(v) ? v.value : escapeAttr(v);
    out += strings[i + 1] ?? "";
  }
  return raw(out);
}
