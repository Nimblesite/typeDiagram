# typeDiagram — Render Hooks Spec

## Context

The SVG renderer ([`packages/typediagram/src/render-svg/render.ts`](../../packages/typediagram/src/render-svg/render.ts)) emits fixed markup: rounded rects, a header strip, row dividers, a `◇` glyph for union variants, orthogonal polylines. Theming is limited to colors via `Theme`. Consumers who want per-field coloring, icons, drop shadows, custom glyphs, pattern fills, conditional classes, or — critically — **absolute positioning** cannot reach into the pipeline. A CSS layer could only restyle what the renderer already emits; it cannot inject `<defs>`, replace geometry, or decide what to draw based on the semantic model (declKind, field name, edge kind).

This spec defines **Render Hooks**: a typed, phase-based extension API that lets JavaScript callbacks inspect the laid-out graph and emit or transform SVG at well-defined points. Hooks are strictly more powerful than CSS: they see the model, receive resolved geometry, and can return arbitrary (safe) SVG.

## Design principles

1. **Semantic input.** Hooks receive `NodeBox`, `EdgeRoute`, `NodeRow` plus computed geometry (absolute x/y with padding baked in, theme, fontSize). No DOM, no selectors — the model itself is the selector.
2. **Typed SVG output only.** Hooks return `SafeSvg` (see [svg-tag.ts](../../packages/typediagram/src/render-svg/svg-tag.ts)), not raw strings. XSS guarantees of the `svg`\`...\` tagged template extend to hook output. Returning `undefined` means "use default".
3. **Override-with-default pattern.** Transform hooks receive the default `SafeSvg` and can wrap, prepend, append, or replace it. 90% of customization is "decorate the default".
4. **Phase-based, not event-based.** Fixed set of phases, each with a precise contract. No catch-all `onRender`.
5. **Pure functions.** Hooks must not mutate inputs, must not retain state between calls, must be deterministic given inputs. Same graph + hooks = byte-identical SVG.
6. **Geometry is sacred.** `NodeBox`/`EdgeRoute`/`NodeRow` are the contract. The layout engine owns geometry; hooks consume it. A hook MAY render a node at a different position (see positioning system below), but MUST NOT mutate the input model.
7. **Early-version latitude.** Hook signatures may change across minor versions pre-1.0. The geometry model is the stable surface.

## Hook phases

Six phases, executed in this order for each `renderSvg` call:

| ID                  | Phase        | When                                        | Input                               | Output                                        |
| ------------------- | ------------ | ------------------------------------------- | ----------------------------------- | --------------------------------------------- |
| `[HOOK-DEFS]`       | `defs`       | Once, before nodes/edges                    | `DefsCtx`                           | `SafeSvg \| undefined` (appended to `<defs>`) |
| `[HOOK-NODE]`       | `node`       | Per node, replaces default `<g>` for node   | `NodeCtx`, `defaultSvg: SafeSvg`    | `SafeSvg \| undefined`                        |
| `[HOOK-ROW]`        | `row`        | Per row within a node (if `node` not used)  | `RowCtx`, `defaultSvg: SafeSvg`     | `SafeSvg \| undefined`                        |
| `[HOOK-EDGE]`       | `edge`       | Per edge, replaces default polyline + label | `EdgeCtx`, `defaultSvg: SafeSvg`    | `SafeSvg \| undefined`                        |
| `[HOOK-BACKGROUND]` | `background` | Once, after `<defs>`, before nodes          | `BackgroundCtx`                     | `SafeSvg \| undefined` (drawn under nodes)    |
| `[HOOK-POST]`       | `post`       | Once, final whole-document transform        | `PostCtx` (includes full `SafeSvg`) | `SafeSvg`                                     |

**Ordering rationale**: `defs` first so subsequent phases can reference gradient/filter/pattern IDs. `background` after `defs` and before nodes so grid backgrounds / watermarks render underneath. `post` last so it can wrap the entire output (e.g. inject `<style>`, add a root `<g transform>`).

**`node` vs `row`**: row hooks always run FIRST, per row. The `def` passed to a `node` hook is the full default node WITH row-hook output baked in. A `node` hook that wraps `def` preserves row effects automatically; a `node` hook that returns a completely new `<g>` discards them — that is the user's explicit choice, visible in their code. Rationale: this makes preset composition work correctly (e.g. a `field-color` row hook and a `drop-shadow` node hook stack without interference), and is what users expect from "decorate the default".

## Context types

All contexts carry `theme: Theme`, `fontSize: number`, `padding: number`, and `graph: LaidOutGraph` (read-only). Geometry fields are **absolute** — padding is already added — so hooks can paste coordinates directly into SVG.

### `[HOOK-CTX-NODE]` `NodeCtx`

```ts
interface NodeCtx extends BaseCtx {
  node: NodeBox; // full layout box, read-only
  x: number; // absolute top-left (node.x + padding)
  y: number;
  width: number; // node.width
  height: number; // node.height
  accent: string; // resolved accent color for declKind
  isUnion: boolean;
  header: {
    text: string;
    height: number; // firstRow.y (or full height if no rows)
    fill: string; // resolved header fill
  };
  badge?: {
    // union "ONE OF" badge geometry, unions only
    y: number;
    height: number;
    fontSize: number;
  };
}
```

### `[HOOK-CTX-ROW]` `RowCtx`

```ts
interface RowCtx extends BaseCtx {
  node: NodeBox; // parent node
  row: NodeRow;
  rowIndex: number;
  x: number; // absolute top-left of the row
  y: number;
  width: number; // node.width
  height: number; // row.height
  isUnionVariant: boolean; // parent is a union
  textX: number; // where default renders the row text
  textY: number; // baseline for row text
}
```

### `[HOOK-CTX-EDGE]` `EdgeCtx`

```ts
interface EdgeCtx extends BaseCtx {
  edge: EdgeRoute;
  points: ReadonlyArray<{ x: number; y: number }>; // absolute, padding-adjusted
  midpoint: { x: number; y: number }; // absolute
  sourceNode: NodeBox; // resolved from sourceNodeId
  targetNode: NodeBox;
  stroke: string; // resolved edge stroke
  strokeWidth: number;
  dashArray?: string; // present for genericArg
}
```

### `[HOOK-CTX-DEFS]` `DefsCtx` / `[HOOK-CTX-BG]` `BackgroundCtx` / `[HOOK-CTX-POST]` `PostCtx`

```ts
interface DefsCtx extends BaseCtx {}
interface BackgroundCtx extends BaseCtx {
  width: number; // total SVG width including padding
  height: number;
}
interface PostCtx extends BaseCtx {
  width: number;
  height: number;
  svg: SafeSvg; // the complete rendered document
}
```

### `[HOOK-CTX-BASE]` `BaseCtx`

```ts
interface BaseCtx {
  theme: Theme;
  fontSize: number;
  padding: number;
  graph: LaidOutGraph; // full graph for cross-referencing
}
```

## `RenderHooks` type

```ts
interface RenderHooks {
  defs?: (ctx: DefsCtx) => SafeSvg | undefined;
  node?: (ctx: NodeCtx, defaultSvg: SafeSvg) => SafeSvg | undefined;
  row?: (ctx: RowCtx, defaultSvg: SafeSvg) => SafeSvg | undefined;
  edge?: (ctx: EdgeCtx, defaultSvg: SafeSvg) => SafeSvg | undefined;
  background?: (ctx: BackgroundCtx) => SafeSvg | undefined;
  post?: (ctx: PostCtx) => SafeSvg;
}
```

### `[HOOK-API]` Public API

`renderSvg` gains an optional `hooks` field:

```ts
interface SvgOpts {
  theme?: ThemeName;
  fontSize?: number;
  padding?: number;
  hooks?: RenderHooks;
}
```

Hooks are exported from [`packages/typediagram/src/render-svg/index.ts`](../../packages/typediagram/src/render-svg/index.ts) alongside `renderSvg`.

## Safety

- `[HOOK-SAFETY-TYPE]` Return type is `SafeSvg`. Consumers MUST go through `svg`\`...\` or `raw(...)`. Plain strings fail the type check.
- `[HOOK-SAFETY-ERRORS]` A hook that throws does NOT crash `renderSvg`. The renderer catches, logs via `pino` at `error` level with `{ phase, nodeId?, edgeId? }`, and falls back to the default output for that phase. The whole pipeline returning `Result<string, RenderError>` is out of scope — hooks are a power user feature and errors surface in logs, not return types.
- `[HOOK-SAFETY-PURE]` Hooks are documented as pure. We don't enforce it at runtime, but determinism tests ([HOOK-TEST-DETERMINISTIC]) run `renderSvg` twice with the same hooks and assert byte-identical output.

## Composition

- `[HOOK-COMPOSE]` Hooks are a single object, not an array. Users who want to combine hook sets write their own composer — we don't ship one in v1. The `defaultSvg` parameter makes the common "decorate default" case trivial without a framework.

## `[HOOK-LAYERS]` Layering — read this before adding features

Three strictly-stacked layers. Each layer knows nothing about the one above it. **Breaking this layering is a review-rejection.**

| Layer       | Name                        | Artifact                                                                           | Location                              | Who depends on it             |
| ----------- | --------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------- | ----------------------------- |
| **Layer 1** | `RenderHooks` — core API    | TypeScript `RenderHooks` interface + phase invocation inside `renderSvg`           | `packages/typediagram/src/render-svg` | everyone                      |
| **Layer 2** | Hook **code** (user JS)     | A string of JavaScript the user writes; compiled to a Layer-1 `RenderHooks` object | `packages/web/src/eval-hooks.ts`      | Layer 3, playground, docs     |
| **Layer 3** | **Presets** — code snippets | Named strings of Layer-2 JS (with `// --- preset:<id> ---` delimiters)             | `packages/web/src/hook-presets.ts`    | the playground's chip UI only |

### Layer 1 — `RenderHooks` (core)

The only layer that talks to the renderer. Phase-based, typed, synchronous, fully optional. A consumer using the TypeScript library directly writes a `RenderHooks` object and passes it to `renderSvg` / `renderToString`. **No other layer exists from the core framework's perspective.** If you're adding a new hook phase or changing context shapes, this is the only layer you touch.

### Layer 2 — user JavaScript (playground and beyond)

The **primary** consumer-facing surface in interactive tools: **the user types plain JavaScript**. `svg`, `raw`, and a pre-declared `hooks` object are in scope; the user assigns functions onto `hooks`. The playground's `evalHooks(code)` compiles this via `new Function("svg", "raw", body)` and hands the resulting `RenderHooks` to Layer 1. Empty input returns `undefined` hooks — identical to passing no hooks at all.

> Presets are NOT the hook API. Presets are NOT a compositional primitive. The hook API is user-authored JavaScript, period. Presets only exist to help the user learn it by pasting example code.

### Layer 3 — presets

Each preset is a **string of Layer-2 source code**, wrapped in sentinel comments:

```
// --- preset:drop-shadow ---
hooks.defs = () => svg`<filter id="td-preset-drop">…</filter>`;
hooks.node = (ctx, def) => svg`<g filter="url(#td-preset-drop)">${def}</g>`;
// --- /preset:drop-shadow ---
```

Nothing about a preset is compiled, composed, or handed to the renderer by the preset module. The **only** thing a preset does is:

- provide a `source` string,
- support being spliced into or out of a larger block of user code via `togglePresetInCode(code, id, on)`.

Clicking a preset button in the playground mutates the hooks editor's textarea — the user **sees the code** and can hand-edit it. Detection (`presetsInCode(code)`) just regex-matches the sentinel comments, nothing more. Overlapping presets that assign the same hook key (e.g. two presets both setting `hooks.node`) **do not auto-compose** — last write wins, exactly as it would in any JS module. This is a deliberate non-feature: the user sees the raw code, so any "magic merge" would be a lie.

If a new preset is added, no other layer changes. If the `RenderHooks` interface changes, preset bodies need to be re-edited in the source string, but neither Layer 2 (eval) nor Layer 3 (splice helpers) have any structural dependency on the preset set.

### Anti-patterns (do NOT do these)

- Exporting preset `RenderHooks` objects directly — that smuggles Layer 3 into Layer 1 and silently duplicates what `evalHooks` should own.
- A `mergePresets(...)` composition utility — composition belongs to the user's code, not a framework. If users want to compose, they concatenate Layer-2 source or write their own wrapper functions.
- Binding chip clicks directly to `renderSvg({ hooks: … })` — chips must always go through the textarea and Layer 2. The textarea is the source of truth.
- Passing `{ hooks: {} }` when the user has no hooks — hooks must be **absent from the options object entirely** when unused (verified by tests on both the core side and the playground side).

## Worked examples

### `[HOOK-EX-FIELD-COLOR]` Per-field color coding

```ts
renderSvg(graph, {
  hooks: {
    row: (ctx, def) => {
      const color = ctx.row.text.startsWith("id:")
        ? "#ffd400"
        : ctx.row.text.startsWith("email:")
          ? "#66ccff"
          : undefined;
      if (color === undefined) return undefined;
      return svg`${def}<rect x="${ctx.x}" y="${ctx.y}" width="3" height="${ctx.height}" fill="${color}"/>`;
    },
  },
});
```

### `[HOOK-EX-DROPSHADOW]` Drop shadows on all nodes

```ts
renderSvg(graph, {
  hooks: {
    defs: () => svg`<filter id="drop"><feDropShadow dx="1" dy="2" stdDeviation="2" flood-opacity="0.25"/></filter>`,
    node: (ctx, def) => svg`<g filter="url(#drop)">${def}</g>`,
  },
});
```

### `[HOOK-EX-GRID]` Grid background

```ts
renderSvg(graph, {
  hooks: {
    defs: () =>
      svg`<pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0 L0 0 0 20" fill="none" stroke="#eee" stroke-width="0.5"/></pattern>`,
    background: (ctx) => svg`<rect width="${ctx.width}" height="${ctx.height}" fill="url(#grid)"/>`,
  },
});
```

### `[HOOK-EX-CLASSES]` Injected CSS classes (for when CSS IS what you want)

```ts
renderSvg(graph, {
  hooks: {
    node: (ctx, def) => svg`<g class="td-node td-${ctx.node.declKind}" data-name="${ctx.node.declName}">${def}</g>`,
    post: (ctx) => svg`${ctx.svg}<style>.td-union { cursor: pointer; }</style>`,
  },
});
```

## Positioning system (future, built on hooks)

A first-class demonstration of hook power: a **decoupled positioning system** for absolute or constraint-based node placement, layered over the type markup.

- `[HOOK-POS-MOTIVATION]` The DSL describes _types and relationships_, not layout. Some diagrams need specific placement: "put `User` top-left, `Order` to its right, group payment types in a cluster." Adding positioning syntax to the DSL violates design principle 3 ("Language-neutral"). A sidecar positioning file (JSON/YAML/TOML) that overrides layout via hooks keeps the DSL pure.
- `[HOOK-POS-MECHANISM]` A positioning layer reads a position map `{ [declName]: { x, y } }` and implements a `node` hook:
  ```ts
  const positioning = (positions: Record<string, { x: number; y: number }>): RenderHooks => ({
    node: (ctx, def) => {
      const p = positions[ctx.node.declName];
      if (p === undefined) return undefined;
      const dx = p.x - ctx.x;
      const dy = p.y - ctx.y;
      return svg`<g transform="translate(${dx} ${dy})">${def}</g>`;
    },
    edge: (ctx, def) => {
      // rewrite edge points relative to overridden source/target positions
      // ... (details in positioning spec, not this one)
      return undefined;
    },
  });
  ```
- `[HOOK-POS-EDGES]` Repositioning nodes requires edge endpoints to follow. The `edge` hook inspects `sourceNode`/`targetNode` via `ctx.graph`, looks up their overridden positions, and emits a polyline from the new source port to the new target port. This is non-trivial — a real positioning system ships its own mini-router or uses straight lines with arrowheads.
- `[HOOK-POS-PROOF]` The positioning system being expressible as pure hooks (no core renderer changes) is the acceptance test for whether the hook API is powerful enough. If positioning needs a core change, the hook API has failed.

The positioning system itself is a separate spec. This spec only guarantees the hook API supports it.

## Non-goals

- No hook for the overall `<svg>` element attributes (width/height/viewBox). Use `post` to rewrap.
- No hooks inside `svg-tag.ts` internals.
- No async hooks. Rendering is synchronous; `renderSvg` returns a `string`.
- No registry, no plugins, no lifecycle. Just functions passed through options.
- No hook for the arrow marker in `<defs>`. Use your own marker via a `defs` hook and point edges at it via an `edge` hook if you need a different arrow.

## Acceptance

`[HOOK-ACCEPT]` The hook API is complete when:

1. All six phases are callable and covered by tests.
2. A sample positioning hook ([HOOK-POS-PROOF]) successfully moves a node to an arbitrary `(x, y)` and the connected edge follows — implemented outside the core framework, using only public API.
3. All worked examples above compile and render without modifying the core renderer.
4. Default output (no hooks) is byte-identical to the pre-hooks renderer output for every test diagram.
