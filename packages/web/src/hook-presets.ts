// [WEB-HOOK-PRESETS] Named RenderHooks preset SOURCE CODE snippets that the
// user sees in the hooks editor. Each preset is just JS the user could have
// written by hand — the whole point is education, not a black box.
//
// Block format (required so chip toggles can splice blocks in/out):
//
//   // --- preset:<id> ---
//   <any JS producing one or more hook properties on `hooks`>
//   // --- /preset:<id> ---
//
// The body mutates a pre-declared `hooks` object. The eval module provides
// `svg`, `raw`, and `hooks` in scope — nothing else.

export type PresetId = "drop-shadow" | "field-color" | "grid-bg" | "classes" | "glow-union";

export interface PresetDef {
  readonly id: PresetId;
  readonly label: string;
  readonly blurb: string;
  readonly source: string;
}

const begin = (id: PresetId): string => `// --- preset:${id} ---`;
const end = (id: PresetId): string => `// --- /preset:${id} ---`;

const dropShadowSrc = `${begin("drop-shadow")}
// Drop shadow behind every node. To COMPOSE with other presets, each hook
// captures any previously-assigned hook and chains into it.
{
  const prevDefs = hooks.defs;
  hooks.defs = (ctx) => {
    const prev = prevDefs ? prevDefs(ctx) : undefined;
    const mine = svg\`<filter id="td-preset-drop" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="1.5" dy="3" stdDeviation="2.5" flood-opacity="0.35"/>
    </filter>\`;
    return prev ? svg\`\${prev}\${mine}\` : mine;
  };
  const prevNode = hooks.node;
  hooks.node = (ctx, def) => {
    const inner = prevNode ? (prevNode(ctx, def) ?? def) : def;
    return svg\`<g filter="url(#td-preset-drop)">\${inner}</g>\`;
  };
}
${end("drop-shadow")}`;

const fieldColorSrc = `${begin("field-color")}
// Color-code rows by field name / type. Chains onto any existing row hook.
{
  const FIELD_COLORS = [
    [/^id\\b|Id\\b/, "#ffd400"],
    [/^email\\b|Email\\b/, "#66ccff"],
    [/^name\\b|Name\\b/, "#a78bfa"],
    [/Bool\\b/, "#4ade80"],
    [/String\\b/, "#f472b6"],
    [/\\bInt\\b|\\bFloat\\b|\\bNumber\\b/, "#38bdf8"],
  ];
  const prevRow = hooks.row;
  hooks.row = (ctx, def) => {
    const base = prevRow ? (prevRow(ctx, def) ?? def) : def;
    for (const [re, color] of FIELD_COLORS) {
      if (re.test(ctx.row.text)) {
        return svg\`\${base}<rect x="\${ctx.x}" y="\${ctx.y}" width="3" height="\${ctx.height}" fill="\${color}"/>\`;
      }
    }
    return prevRow ? base : undefined;
  };
}
${end("field-color")}`;

const gridBgSrc = `${begin("grid-bg")}
// Blueprint-style grid pattern painted under the whole diagram. Chains defs.
{
  const prevDefs = hooks.defs;
  hooks.defs = (ctx) => {
    const prev = prevDefs ? prevDefs(ctx) : undefined;
    const mine = svg\`<pattern id="td-preset-grid" width="20" height="20" patternUnits="userSpaceOnUse">
      <path d="M 20 0 L 0 0 0 20" fill="none" stroke="rgba(142,213,255,0.15)" stroke-width="0.5"/>
    </pattern>\`;
    return prev ? svg\`\${prev}\${mine}\` : mine;
  };
  const prevBg = hooks.background;
  hooks.background = (ctx) => {
    const prev = prevBg ? prevBg(ctx) : undefined;
    const mine = svg\`<rect x="0" y="0" width="\${ctx.width}" height="\${ctx.height}" fill="url(#td-preset-grid)"/>\`;
    return prev ? svg\`\${prev}\${mine}\` : mine;
  };
}
${end("grid-bg")}`;

const classesSrc = `${begin("classes")}
// Add td-kind-* classes and a <style> block. Chains onto any existing node/post hooks.
{
  const prevNode = hooks.node;
  hooks.node = (ctx, def) => {
    const inner = prevNode ? (prevNode(ctx, def) ?? def) : def;
    return svg\`<g class="td-kind-\${ctx.node.declKind}" data-name="\${ctx.node.declName}">\${inner}</g>\`;
  };
  const prevPost = hooks.post;
  hooks.post = (ctx) => {
    const body = prevPost ? prevPost(ctx) : ctx.svg;
    return svg\`\${body}<style>.td-kind-union{filter:brightness(1.05);}.td-kind-alias{opacity:0.92;}</style>\`;
  };
}
${end("classes")}`;

const glowUnionSrc = `${begin("glow-union")}
// Gaussian-blur glow around union nodes only. Conditional via ctx.isUnion.
{
  const prevDefs = hooks.defs;
  hooks.defs = (ctx) => {
    const prev = prevDefs ? prevDefs(ctx) : undefined;
    const mine = svg\`<filter id="td-preset-glow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="2.2" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>\`;
    return prev ? svg\`\${prev}\${mine}\` : mine;
  };
  const prevNode = hooks.node;
  hooks.node = (ctx, def) => {
    const inner = prevNode ? (prevNode(ctx, def) ?? def) : def;
    if (!ctx.isUnion) return prevNode ? inner : undefined;
    return svg\`<g filter="url(#td-preset-glow)">\${inner}</g>\`;
  };
}
${end("glow-union")}`;

export const PRESETS: ReadonlyArray<PresetDef> = [
  { id: "grid-bg", label: "grid", blurb: "blueprint background", source: gridBgSrc },
  { id: "drop-shadow", label: "shadow", blurb: "drop shadow on every node", source: dropShadowSrc },
  { id: "field-color", label: "field color", blurb: "color-code rows by type / name", source: fieldColorSrc },
  { id: "glow-union", label: "union glow", blurb: "bloom around union nodes", source: glowUnionSrc },
  { id: "classes", label: "css classes", blurb: "inject data-* + style rules", source: classesSrc },
];

const blockRe = (id: PresetId): RegExp => {
  const b = `// --- preset:${id} ---`;
  const e = `// --- /preset:${id} ---`;
  const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  return new RegExp(`\\n?${esc(b)}[\\s\\S]*?${esc(e)}\\n?`);
};

/**
 * [WEB-PRESET-HAS] Does `code` already contain this preset's block?
 */
export const codeContainsPreset = (code: string, id: PresetId): boolean => blockRe(id).test(code);

/**
 * [WEB-PRESET-SPLICE] Add or remove a preset block in `code`. Idempotent:
 * adding an already-present preset is a no-op; removing absent one is a no-op.
 * Blocks are appended at the end separated by a blank line.
 */
export const togglePresetInCode = (code: string, id: PresetId, on: boolean): string => {
  const re = blockRe(id);
  const present = re.test(code);
  if (on && !present) {
    const preset = PRESETS.find((p) => p.id === id) as PresetDef;
    const sep = code.trim().length === 0 ? "" : "\n\n";
    return `${code}${sep}${preset.source}\n`;
  }
  if (!on && present) {
    return code
      .replace(re, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trimStart();
  }
  return code;
};

/** Return the ids of all presets whose block is present in `code`. */
export const presetsInCode = (code: string): ReadonlyArray<PresetId> =>
  PRESETS.filter((p) => codeContainsPreset(code, p.id)).map((p) => p.id);
