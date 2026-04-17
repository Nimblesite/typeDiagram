import type { EdgeRoute, LaidOutGraph, NodeBox, NodeRow } from "../layout/types.js";
import type { SafeSvg } from "./svg-tag.js";
import type { Theme } from "./theme.js";

export interface BaseCtx {
  readonly theme: Theme;
  readonly fontSize: number;
  readonly padding: number;
  readonly graph: LaidOutGraph;
}

export type DefsCtx = BaseCtx;

export interface BackgroundCtx extends BaseCtx {
  readonly width: number;
  readonly height: number;
}

export interface NodeHeaderInfo {
  readonly text: string;
  readonly height: number;
  readonly fill: string;
}

export interface NodeBadgeInfo {
  readonly y: number;
  readonly height: number;
  readonly fontSize: number;
}

export interface NodeCtx extends BaseCtx {
  readonly node: NodeBox;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly accent: string;
  readonly isUnion: boolean;
  readonly header: NodeHeaderInfo;
  readonly badge?: NodeBadgeInfo;
}

export interface RowCtx extends BaseCtx {
  readonly node: NodeBox;
  readonly row: NodeRow;
  readonly rowIndex: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly isUnionVariant: boolean;
  readonly textX: number;
  readonly textY: number;
}

export interface EdgeCtx extends BaseCtx {
  readonly edge: EdgeRoute;
  readonly points: ReadonlyArray<{ readonly x: number; readonly y: number }>;
  readonly midpoint: { readonly x: number; readonly y: number };
  readonly sourceNode: NodeBox;
  readonly targetNode: NodeBox;
  readonly stroke: string;
  readonly strokeWidth: number;
  readonly dashArray?: string;
}

export interface PostCtx extends BaseCtx {
  readonly width: number;
  readonly height: number;
  readonly svg: SafeSvg;
}

export type HookPhase = "defs" | "background" | "node" | "row" | "edge" | "post";

export interface HookError {
  readonly phase: HookPhase;
  readonly error: unknown;
  readonly nodeId?: string;
  readonly edgeId?: string;
}

/**
 * Optional error sink for hook failures. If omitted, throws from hooks are silently
 * swallowed and the default output is used for that phase. Consumers wanting logs
 * pass their own pino/console reporter here.
 */
export type HookErrorReporter = (err: HookError) => void;

export interface RenderHooks {
  readonly defs?: (ctx: DefsCtx) => SafeSvg | undefined;
  readonly background?: (ctx: BackgroundCtx) => SafeSvg | undefined;
  readonly node?: (ctx: NodeCtx, defaultSvg: SafeSvg) => SafeSvg | undefined;
  readonly row?: (ctx: RowCtx, defaultSvg: SafeSvg) => SafeSvg | undefined;
  readonly edge?: (ctx: EdgeCtx, defaultSvg: SafeSvg) => SafeSvg | undefined;
  readonly post?: (ctx: PostCtx) => SafeSvg;
  readonly onError?: HookErrorReporter;
}

/**
 * [HOOK-SAFETY-ERRORS] Invoke a hook, trap throws, report via onError, fall back to `fallback`.
 * Returns the hook's value when it returns a SafeSvg; returns `fallback` when the hook returns
 * undefined or throws.
 */
export function invokeHook<T>(
  fn: ((arg: T, def: SafeSvg) => SafeSvg | undefined) | undefined,
  arg: T,
  defaultSvg: SafeSvg,
  phase: HookPhase,
  report: HookErrorReporter | undefined,
  locator?: { nodeId?: string; edgeId?: string }
): { svg: SafeSvg; invoked: boolean; overridden: boolean } {
  if (fn === undefined) {
    return { svg: defaultSvg, invoked: false, overridden: false };
  }
  const out = tryCall(() => fn(arg, defaultSvg), phase, report, locator);
  if (out === undefined) {
    return { svg: defaultSvg, invoked: true, overridden: false };
  }
  return { svg: out, invoked: true, overridden: true };
}

/** Variant for zero-default hooks (defs, background, post). */
export function invokeSimpleHook<T>(
  fn: ((arg: T) => SafeSvg | undefined) | undefined,
  arg: T,
  phase: HookPhase,
  report: HookErrorReporter | undefined
): SafeSvg | undefined {
  if (fn === undefined) {
    return undefined;
  }
  return tryCall(() => fn(arg), phase, report);
}

function tryCall(
  fn: () => SafeSvg | undefined,
  phase: HookPhase,
  report: HookErrorReporter | undefined,
  locator?: { nodeId?: string; edgeId?: string }
): SafeSvg | undefined {
  try {
    return fn();
  } catch (error) {
    report?.({ phase, error, ...(locator ?? {}) });
    return undefined;
  }
}
