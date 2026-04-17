import type { Diagnostic } from "./parser/diagnostics.js";
import { type Result, andThenAsync, err, ok } from "./result.js";
import { parse as parseSrc } from "./parser/index.js";
import { buildModel } from "./model/index.js";
import { layout, layoutSync, warmupLayout, isLayoutWarm } from "./layout/index.js";
import { renderSvg, type SvgOpts } from "./render-svg/index.js";
import type { LaidOutGraph, LayoutOpts } from "./layout/index.js";
import type { Model } from "./model/index.js";

export interface AllOpts extends SvgOpts, LayoutOpts {}

// [RENDER-SHARED] parse + buildModel is synchronous and shared by sync and async paths.
function parseAndBuild(source: string): Result<Model, Diagnostic[]> {
  const parsed = parseSrc(source);
  if (!parsed.ok) {
    return parsed;
  }
  return buildModel(parsed.value);
}

function toSvg(laid: LaidOutGraph, opts: AllOpts): string {
  return renderSvg(laid, opts);
}

export async function renderToString(source: string, opts: AllOpts = {}): Promise<Result<string, Diagnostic[]>> {
  const model = parseAndBuild(source);
  if (!model.ok) {
    return model;
  }
  const laid = await layout(model.value, opts);
  if (!laid.ok) {
    return laid;
  }
  return ok(toSvg(laid.value, opts));
}

// [RENDER-SYNC] Synchronous renderToString. Caller MUST have awaited `warmupSyncRender()`
// (or any async `renderToString`) at least once before invoking. Uses identical
// parse/buildModel/renderSvg code as the async path; only the layout call differs.
export function renderToStringSync(source: string, opts: AllOpts = {}): Result<string, Diagnostic[]> {
  const model = parseAndBuild(source);
  if (!model.ok) {
    return model;
  }
  const laid = layoutSync(model.value, opts);
  if (!laid.ok) {
    return laid;
  }
  return ok(toSvg(laid.value, opts));
}

export async function warmupSyncRender(): Promise<void> {
  await warmupLayout();
}

export { isLayoutWarm as isSyncRenderReady };

/** Browser-only: parse SVG string into an SVGElement via DOMParser. */
export async function render(source: string, opts: AllOpts = {}): Promise<Result<SVGElement, Diagnostic[]>> {
  const r = await renderToString(source, opts);
  if (!r.ok) {
    return r;
  }
  if (typeof DOMParser === "undefined") {
    return err<Diagnostic[]>([
      {
        severity: "error",
        message: "render() requires a browser DOMParser; use renderToString() in Node",
        line: 0,
        col: 0,
        length: 0,
      },
    ]);
  }
  const doc = new DOMParser().parseFromString(r.value, "image/svg+xml");
  const el = doc.documentElement as unknown as SVGElement;
  return ok(el);
}

// Layer barrels for direct access
export * as parser from "./parser/index.js";
export * as model from "./model/index.js";
export * as layoutLayer from "./layout/index.js";
export * as renderSvgLayer from "./render-svg/index.js";
export * as converters from "./converters/index.js";

// Result type
export type { Result } from "./result.js";
export { ok, err, isOk, isErr, map, mapErr, andThen, andThenAsync, unwrap } from "./result.js";

// Common types most consumers want at the top level
export type { Diagnostic } from "./parser/diagnostics.js";
export type {
  RenderHooks,
  BaseCtx,
  DefsCtx,
  BackgroundCtx,
  NodeCtx,
  RowCtx,
  EdgeCtx,
  PostCtx,
  HookPhase,
  HookError,
  HookErrorReporter,
  SafeSvg,
} from "./render-svg/index.js";
export { svg, raw } from "./render-svg/index.js";

// keep imports from being tree-shaken away in odd configurations
void andThenAsync;
