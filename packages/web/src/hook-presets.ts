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
// LOUD coloured glow behind every node — a bright cyan bloom with a big
// offset + full opacity so it pops against a dark background. Chains onto
// any existing defs/node hook.
{
  const prevDefs = hooks.defs;
  hooks.defs = (ctx) => {
    const prev = prevDefs ? prevDefs(ctx) : undefined;
    const mine = svg\`<filter id="td-preset-drop" x="-40%" y="-40%" width="180%" height="180%">
      <feDropShadow dx="8" dy="10" stdDeviation="6" flood-opacity="1" flood-color="#8ed5ff"/>
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
// LOUD field accent: a thick coloured bar along the left edge of every
// matching row. Chains onto any existing row hook.
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
        return svg\`\${base}<rect x="\${ctx.x}" y="\${ctx.y}" width="8" height="\${ctx.height}" fill="\${color}"/>\`;
      }
    }
    return prevRow ? base : undefined;
  };
}
${end("field-color")}`;

const gridBgSrc = `${begin("grid-bg")}
// LOUD blueprint grid: thicker strokes in a saturated blue so the background
// CLEARLY changes the moment this preset is on. Chains defs + background.
{
  const prevDefs = hooks.defs;
  hooks.defs = (ctx) => {
    const prev = prevDefs ? prevDefs(ctx) : undefined;
    const mine = svg\`<pattern id="td-preset-grid" width="24" height="24" patternUnits="userSpaceOnUse">
      <path d="M 24 0 L 0 0 0 24" fill="none" stroke="#38bdf8" stroke-width="1.25" stroke-opacity="0.8"/>
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
// LOUD class-based styling: saturated outlines on every node kind via a
// post-injected <style> block so the effect is undeniable.
{
  const prevNode = hooks.node;
  hooks.node = (ctx, def) => {
    const inner = prevNode ? (prevNode(ctx, def) ?? def) : def;
    return svg\`<g class="td-kind-\${ctx.node.declKind}" data-name="\${ctx.node.declName}">\${inner}</g>\`;
  };
  const prevPost = hooks.post;
  hooks.post = (ctx) => {
    const body = prevPost ? prevPost(ctx) : ctx.svg;
    return svg\`\${body}<style>
      .td-kind-record rect:first-of-type{stroke:#38bdf8 !important;stroke-width:4 !important;}
      .td-kind-union rect:first-of-type{stroke:#ff3bd4 !important;stroke-width:4 !important;filter:brightness(1.3);}
      .td-kind-alias rect:first-of-type{stroke:#4ade80 !important;stroke-width:4 !important;}
    </style>\`;
  };
}
${end("classes")}`;

const glowUnionSrc = `${begin("glow-union")}
// LOUD union glow: a big gaussian bloom in magenta so union nodes clearly
// pop. Conditional via ctx.isUnion so records/aliases are untouched.
{
  const prevDefs = hooks.defs;
  hooks.defs = (ctx) => {
    const prev = prevDefs ? prevDefs(ctx) : undefined;
    const mine = svg\`<filter id="td-preset-glow" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="6" result="b"/>
      <feFlood flood-color="#ff3bd4" flood-opacity="0.9" result="c"/>
      <feComposite in="c" in2="b" operator="in" result="glow"/>
      <feMerge><feMergeNode in="glow"/><feMergeNode in="SourceGraphic"/></feMerge>
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
