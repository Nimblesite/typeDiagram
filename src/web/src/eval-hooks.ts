// [WEB-EVAL-HOOKS] Compile a user-authored JavaScript string into a RenderHooks
// object. The user writes plain JS with `svg`, `raw`, and a `hooks` object
// already in scope. This is the CORE of the playground's hook feature —
// presets are just convenience buttons that paste example code into the editor.
//
// Contract (documented in the editor's placeholder):
//
//   // `svg`   — tagged-template for safe SVG strings
//   // `raw`   — wrap trusted raw SVG (bypasses escaping)
//   // `hooks` — assign your hook functions here
//
//   hooks.node = (ctx, def) => svg`<g filter="url(#x)">${def}</g>`;
//
// A returned value from the body is also accepted if the user prefers
// `return { node: ... }` style.
import type { RenderHooks } from "typediagram-core";
import { svg, raw } from "typediagram-core";

export interface EvalResult {
  readonly ok: boolean;
  readonly hooks?: RenderHooks;
  readonly error?: string;
}

const TRIM_EMPTY_RE = /^\s*$/;

/**
 * [WEB-EVAL-COMPILE] Run `code` and return the resulting RenderHooks. An empty
 * or whitespace-only string returns `{ ok: true, hooks: undefined }` — hooks
 * remain completely optional, and the renderer falls back to its default path.
 */
export const evalHooks = (code: string): EvalResult => {
  if (TRIM_EMPTY_RE.test(code)) {
    return { ok: true };
  }
  try {
    const body = `"use strict";\nconst hooks = {};\n${code}\n;return hooks;`;
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const fn = new Function("svg", "raw", body) as (s: typeof svg, r: typeof raw) => RenderHooks | undefined;
    const out = fn(svg, raw);
    if (out === undefined) {
      return { ok: true };
    }
    // If the user assigned zero hook properties (e.g. comments-only code), treat
    // it as "no hooks" — the renderer must not see an empty `{ hooks: {} }`.
    if (Object.keys(out).length === 0) {
      return { ok: true };
    }
    return { ok: true, hooks: out };
  } catch (err) {
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    return { ok: false, error: msg };
  }
};
