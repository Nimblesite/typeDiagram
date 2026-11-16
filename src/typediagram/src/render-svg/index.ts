export { renderSvg } from "./render.js";
export type { SvgOpts } from "./render.js";
export { DARK, LIGHT, getTheme } from "./theme.js";
export type { Theme, ThemeName } from "./theme.js";
export type {
  BaseCtx,
  DefsCtx,
  BackgroundCtx,
  NodeCtx,
  NodeHeaderInfo,
  NodeBadgeInfo,
  RowCtx,
  EdgeCtx,
  PostCtx,
  HookPhase,
  HookError,
  HookErrorReporter,
  RenderHooks,
} from "./hooks.js";
export { svg, raw, escapeAttr, escapeText } from "./svg-tag.js";
export type { SafeSvg } from "./svg-tag.js";
