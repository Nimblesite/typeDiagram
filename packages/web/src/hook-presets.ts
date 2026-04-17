// [WEB-HOOK-PRESETS] Named RenderHooks presets that demonstrate the power of the
// render hook API. Each preset is a pure function returning a RenderHooks object
// the playground can merge on demand.
import type { RenderHooks } from "typediagram-core";
import { svg } from "typediagram-core";

export type PresetId = "drop-shadow" | "field-color" | "grid-bg" | "classes" | "glow-union";

export interface PresetDef {
  readonly id: PresetId;
  readonly label: string;
  readonly blurb: string;
  readonly hooks: RenderHooks;
}

const dropShadow: RenderHooks = {
  defs: () =>
    svg`<filter id="td-preset-drop" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="1.5" dy="3" stdDeviation="2.5" flood-opacity="0.35"/></filter>`,
  node: (_ctx, def) => svg`<g filter="url(#td-preset-drop)">${def}</g>`,
};

const FIELD_COLORS: ReadonlyArray<readonly [RegExp, string]> = [
  [/^id\b|Id\b/, "#ffd400"],
  [/^email\b|Email\b/, "#66ccff"],
  [/^name\b|Name\b/, "#a78bfa"],
  [/Bool\b/, "#4ade80"],
  [/String\b/, "#f472b6"],
  [/\bInt\b|\bFloat\b|\bNumber\b/, "#38bdf8"],
];

const fieldColor: RenderHooks = {
  row: (ctx, def) => {
    for (const [re, color] of FIELD_COLORS) {
      if (re.test(ctx.row.text)) {
        return svg`${def}<rect x="${ctx.x}" y="${ctx.y}" width="3" height="${ctx.height}" fill="${color}"/>`;
      }
    }
    return undefined;
  },
};

const gridBg: RenderHooks = {
  defs: () =>
    svg`<pattern id="td-preset-grid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M 20 0 L 0 0 0 20" fill="none" stroke="rgba(142,213,255,0.15)" stroke-width="0.5"/></pattern>`,
  background: (ctx) =>
    svg`<rect x="0" y="0" width="${ctx.width}" height="${ctx.height}" fill="url(#td-preset-grid)"/>`,
};

const classes: RenderHooks = {
  node: (ctx, def) =>
    svg`<g class="td-kind-${ctx.node.declKind}" data-name="${ctx.node.declName}">${def}</g>`,
  post: (ctx) =>
    svg`${ctx.svg}<style>.td-kind-union{filter:brightness(1.05);}.td-kind-alias{opacity:0.92;}</style>`,
};

const glowUnion: RenderHooks = {
  defs: () =>
    svg`<filter id="td-preset-glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="2.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`,
  node: (ctx, def) => {
    if (!ctx.isUnion) {
      return undefined;
    }
    return svg`<g filter="url(#td-preset-glow)">${def}</g>`;
  },
};

export const PRESETS: ReadonlyArray<PresetDef> = [
  { id: "grid-bg", label: "grid", blurb: "blueprint background", hooks: gridBg },
  { id: "drop-shadow", label: "shadow", blurb: "drop shadow on every node", hooks: dropShadow },
  { id: "field-color", label: "field color", blurb: "color-code rows by type / name", hooks: fieldColor },
  { id: "glow-union", label: "union glow", blurb: "bloom around union nodes", hooks: glowUnion },
  { id: "classes", label: "css classes", blurb: "inject data-* + style rules", hooks: classes },
];

/**
 * [WEB-HOOK-MERGE] Compose multiple RenderHooks into one. For transform hooks
 * (node, row, edge) each preset's hook is chained — later presets see earlier
 * outputs as `defaultSvg` and can decorate them. For singleton hooks (defs,
 * background, post) outputs are concatenated in preset order.
 */
export const mergePresets = (selected: ReadonlyArray<PresetDef>): RenderHooks => {
  if (selected.length === 0) {
    return {};
  }
  const defs = mergeSingleton(selected.map((p) => p.hooks.defs));
  const background = mergeSingleton(selected.map((p) => p.hooks.background));
  const node = mergeTransform(selected.map((p) => p.hooks.node));
  const row = mergeTransform(selected.map((p) => p.hooks.row));
  const edge = mergeTransform(selected.map((p) => p.hooks.edge));
  const post = mergePost(selected.map((p) => p.hooks.post));
  return {
    ...(defs ? { defs } : {}),
    ...(background ? { background } : {}),
    ...(node ? { node } : {}),
    ...(row ? { row } : {}),
    ...(edge ? { edge } : {}),
    ...(post ? { post } : {}),
  };
};

type SingletonFn<Ctx> = (ctx: Ctx) => ReturnType<NonNullable<RenderHooks["defs"]>>;
type TransformFn<Ctx> = (ctx: Ctx, def: Parameters<NonNullable<RenderHooks["node"]>>[1]) => ReturnType<NonNullable<RenderHooks["node"]>>;

const mergeSingleton = <Ctx>(fns: ReadonlyArray<SingletonFn<Ctx> | undefined>): SingletonFn<Ctx> | undefined => {
  const present = fns.filter((f): f is SingletonFn<Ctx> => f !== undefined);
  if (present.length === 0) {
    return undefined;
  }
  return (ctx) => {
    const parts = present.map((f) => f(ctx)).filter((p): p is NonNullable<ReturnType<SingletonFn<Ctx>>> => p !== undefined);
    if (parts.length === 0) {
      return undefined;
    }
    return parts.reduce((acc, cur) => svg`${acc}${cur}`);
  };
};

const mergeTransform = <Ctx>(
  fns: ReadonlyArray<TransformFn<Ctx> | undefined>
): TransformFn<Ctx> | undefined => {
  const present = fns.filter((f): f is TransformFn<Ctx> => f !== undefined);
  if (present.length === 0) {
    return undefined;
  }
  return (ctx, def) => {
    let current = def;
    let changed = false;
    for (const f of present) {
      const out = f(ctx, current);
      if (out !== undefined) {
        current = out;
        changed = true;
      }
    }
    return changed ? current : undefined;
  };
};

const mergePost = (fns: ReadonlyArray<RenderHooks["post"] | undefined>): RenderHooks["post"] | undefined => {
  const present = fns.filter((f): f is NonNullable<RenderHooks["post"]> => f !== undefined);
  if (present.length === 0) {
    return undefined;
  }
  return (ctx) => {
    let current = ctx.svg;
    for (const f of present) {
      current = f({ ...ctx, svg: current });
    }
    return current;
  };
};
