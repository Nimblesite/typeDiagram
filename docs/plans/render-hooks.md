# typeDiagram — Render Hooks Plan

Spec: [render-hooks.md](../specs/render-hooks.md). This plan is the implementation call sheet.

## Goal

Add six render hooks (`defs`, `node`, `row`, `edge`, `background`, `post`) to the SVG renderer. Keep default output byte-identical. Prove power by implementing a positioning-hook proof-of-concept in tests. Surface the API in the web playground as a **second editor tab where the user writes plain JavaScript** — optional, always, with a pasteable-preset convenience built strictly on top.

## Layering (read spec [HOOK-LAYERS] first)

| Layer | Concern                                    | Module                                                      | Depends on           |
| ----- | ------------------------------------------ | ----------------------------------------------------------- | -------------------- |
| 1     | `RenderHooks` interface + phase invocation | `packages/typediagram/src/render-svg/hooks.ts`, `render.ts` | nothing              |
| 2     | User JS compiled to Layer 1                | `packages/web/src/eval-hooks.ts`                            | Layer 1 (types only) |
| 3     | Preset snippets (strings) + splice helpers | `packages/web/src/hook-presets.ts`                          | Layer 2 (tests only) |

**Review rejections**:

- Layer 3 exporting a `RenderHooks` object (must be strings).
- Layer 3 importing `svg`/`raw` at runtime (must not).
- Anywhere: passing `{ hooks: {} }` when the user didn't opt in.
- Composition utilities in Layer 3 (`mergePresets`, chip-merging hook assemblers, etc.) — the user's JavaScript IS the composition mechanism.

## Decisions

| Concern                     | Decision                                                                                                | Why                                                                                                                                               |
| --------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Return type                 | `SafeSvg \| undefined` (`SafeSvg` required for `post`)                                                  | Types enforce XSS safety. `undefined` = "use default" is cheaper than a "default" sentinel.                                                       |
| Override pattern            | Transform hooks receive `defaultSvg: SafeSvg` as second arg                                             | "Decorate default" is the 90% case. Removes the need for finer phases.                                                                            |
| Error handling              | Try/catch per hook call; log via `pino` at `error`; fall back to default                                | A bad hook must not corrupt the whole diagram. Consistent with "heavy structured logging" rule.                                                   |
| Ordering                    | `defs` → `background` → per-node (`node` OR `row`s) → per-edge (`edge`) → `post`                        | `defs` must precede ID references; `background` must sit under nodes; `post` must wrap the finished document.                                     |
| `node` vs `row` interaction | Row hooks always run first; node hook `def` includes row output                                         | Required for preset composition — a `node` decorator and a `row` decorator must stack. The user can still fully replace a node by ignoring `def`. |
| Context immutability        | Contexts are plain read-only objects (`readonly` markers on fields); `NodeBox`/`EdgeRoute` pass-through | Freezing at runtime is slow and unnecessary. Type-level readonly is enough for internal discipline.                                               |
| Hook composition            | NO composer utility in v1. Users write their own.                                                       | Composition policies (merge? chain? first-non-undefined-wins?) are taste decisions. Ship the primitive; don't prescribe.                          |
| Async                       | Sync only                                                                                               | `renderSvg` is `string` → `string`. Going async forces every consumer (CLI, VS Code, markdown-it) to await.                                       |

## Affected files

```
packages/typediagram/src/render-svg/
  hooks.ts            NEW   — RenderHooks type, context types, safe invoker helper
  render.ts           EDIT  — thread hooks through renderSvg; invoke at each phase
  index.ts            EDIT  — re-export hook types
packages/typediagram/src/index.ts
                      EDIT  — re-export hook types at framework root
packages/typediagram/test/render-hooks.test.ts
                      NEW   — phase coverage + worked-example + positioning-PoC tests
packages/typediagram/test/render-svg.test.ts
                      EDIT  — add "no hooks → byte-identical to baseline" assertion
docs/specs/render-hooks.md                       (done — this PR)
docs/plans/render-hooks.md                       (done — this PR)
```

## Implementation sketch

### 1. `render-svg/hooks.ts` — types only

```ts
import type { EdgeRoute, LaidOutGraph, NodeBox, NodeRow } from "../layout/types.js";
import type { SafeSvg } from "./svg-tag.js";
import type { Theme } from "./theme.js";

export interface BaseCtx {
  theme: Theme;
  fontSize: number;
  padding: number;
  graph: LaidOutGraph;
}
export interface DefsCtx extends BaseCtx {}
export interface BackgroundCtx extends BaseCtx {
  width: number;
  height: number;
}
export interface NodeCtx extends BaseCtx {
  node: NodeBox;
  x: number;
  y: number;
  width: number;
  height: number;
  accent: string;
  isUnion: boolean;
  header: { text: string; height: number; fill: string };
  badge?: { y: number; height: number; fontSize: number };
}
export interface RowCtx extends BaseCtx {
  node: NodeBox;
  row: NodeRow;
  rowIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  isUnionVariant: boolean;
  textX: number;
  textY: number;
}
export interface EdgeCtx extends BaseCtx {
  edge: EdgeRoute;
  points: ReadonlyArray<{ x: number; y: number }>;
  midpoint: { x: number; y: number };
  sourceNode: NodeBox;
  targetNode: NodeBox;
  stroke: string;
  strokeWidth: number;
  dashArray?: string;
}
export interface PostCtx extends BaseCtx {
  width: number;
  height: number;
  svg: SafeSvg;
}

export interface RenderHooks {
  defs?: (ctx: DefsCtx) => SafeSvg | undefined;
  background?: (ctx: BackgroundCtx) => SafeSvg | undefined;
  node?: (ctx: NodeCtx, defaultSvg: SafeSvg) => SafeSvg | undefined;
  row?: (ctx: RowCtx, defaultSvg: SafeSvg) => SafeSvg | undefined;
  edge?: (ctx: EdgeCtx, defaultSvg: SafeSvg) => SafeSvg | undefined;
  post?: (ctx: PostCtx) => SafeSvg;
}
```

Plus a single small helper that takes a hook fn + ctx + default, runs it in try/catch, logs failures, returns default on throw. Keeps every invocation site one line.

### 2. `render-svg/render.ts` — thread hooks

- Each internal renderer (`renderNode`, `renderRow`, `renderEdge`) returns `SafeSvg` already. Refactor `renderRows` to iterate and call `row` hook per-row (currently it inlines in `.map`).
- Build `ctx` objects locally at each call site — no factory. Pass the same `BaseCtx` fields in.
- Convert `renderNode` to emit a `SafeSvg` representing _just the default node_ before the hook call, so the hook can receive it as `defaultSvg`. Today it returns the `<g>…</g>` — already fine.
- Wrap final output in `post` if present.

### 3. `render-svg/index.ts` — exports

```ts
export { renderSvg } from "./render.js";
export type { SvgOpts } from "./render.js";
export type { RenderHooks, BaseCtx, DefsCtx, NodeCtx, RowCtx, EdgeCtx, BackgroundCtx, PostCtx } from "./hooks.js";
export { DARK, LIGHT, getTheme } from "./theme.js";
export type { Theme, ThemeName } from "./theme.js";
```

Root `packages/typediagram/src/index.ts` re-exports the same.

### 4. Tests — `packages/typediagram/test/render-hooks.test.ts`

Complex diagrams, heavy assertions per CLAUDE.md test rules. One file per concern-cluster is fine; keep them E2E through `renderSvg`:

- `[HOOK-TEST-DEFAULT-IDENTITY]` — render a non-trivial diagram (Option + User + Address) with no hooks, assert byte-identical to the same call on prior code path (snapshot a locked baseline string).
- `[HOOK-TEST-PHASES]` — one test that registers all six hooks, each appending a marker string, assert the final SVG contains each marker in the right order.
- `[HOOK-TEST-DEFS]` — register a `defs` hook adding `<filter id="x">`; assert it appears inside `<defs>…</defs>` and `</defs>` still precedes the first node `<g>`.
- `[HOOK-TEST-NODE-OVERRIDE]` — `node` hook that returns a bare `<g>` with a sentinel attribute; assert the default rect/header/rows are absent for that node, present for others.
- `[HOOK-TEST-NODE-WRAPS-DEFAULT]` — `node` hook that wraps `defaultSvg` in a `<g filter="url(#drop)">`; assert both the filter group and the original rect are present.
- `[HOOK-TEST-ROW-SKIP-WHEN-NODE]` — register both `node` and `row` hooks; assert `row` was not called for the node whose `node` hook fired (use a counter in the hook).
- `[HOOK-TEST-EDGE]` — `edge` hook that replaces the polyline with a straight `<line>`; assert the polyline is gone and the line endpoints match source/target geometry (compute expected from `graph.edges[i].points`).
- `[HOOK-TEST-BACKGROUND]` — background hook adds a grid pattern; assert the rect sits after `</defs>` and before the first node `<g data-decl=`.
- `[HOOK-TEST-POST]` — post hook injects `<style>`; assert it appears before `</svg>`.
- `[HOOK-TEST-THROW-FALLBACK]` — hook that throws; assert SVG still renders with default for that element; assert a `pino` error log was emitted (captured via test logger).
- `[HOOK-TEST-DETERMINISTIC]` — run `renderSvg(graph, {hooks})` twice; `assert.strictEqual` the two outputs.
- `[HOOK-TEST-CTX-GEOMETRY]` — hook captures ctx values; assert `ctx.x === node.x + padding`, `ctx.points[0].x === edge.points[0].x + padding`, `ctx.midpoint` matches `midpoint(points)` with padding.
- `[HOOK-TEST-TYPE-SAFETY]` — compile-time check: a hook returning a plain string fails TypeScript. (Covered by a `.ts-expect-error` snippet in a test-types file, not runtime.)

### 5. Positioning proof-of-concept — same test file

- `[HOOK-TEST-POS-NODE]` — define a 2-node diagram, supply `positions = { User: { x: 500, y: 500 } }`, implement the hook set from [HOOK-POS-MECHANISM] in spec, render, parse the resulting SVG (via simple regex on `transform="translate(`) and assert the `User` group carries a translate whose magnitude matches `500 - (originalX + padding)`.
- `[HOOK-TEST-POS-EDGE]` — same diagram with an edge `User → Address`; supply override positions for both; `edge` hook emits a straight line from overridden source to overridden target; assert the emitted `<line>` endpoints match the expected overridden centers.

Keep the positioning helper in the test file for now — it's a PoC, not shipped code. It proves the API is powerful enough. A real positioning package comes later under its own spec.

## Test coverage

Tests must keep coverage ratcheting up (CLAUDE.md coverage rule). New branches added to `render.ts`: the six invocation sites plus the try/catch-log path. Each is hit by the tests above. Update `coverage-thresholds.json` to the new measured floor once all tests pass.

## Rollout

1. Spec + plan merged (this change).
2. Implementation + tests in one PR. Default output byte-identical ([HOOK-TEST-DEFAULT-IDENTITY]) is the review gate.
3. Positioning system spec (separate doc) + package (separate PR) consumes the hook API. No core change required; if one is required, the hook API is wrong and must be revised before 1.0.

## Non-goals for this PR

- Positioning system itself — only the PoC in tests, to validate the API.
- Hook composition utilities.
- Async hooks.
- VS Code extension / markdown-it integration surfacing hooks — they stay on default rendering until a consumer asks.
- CSS injection helpers — users write their own `post` hook with a `<style>` block (see [HOOK-EX-CLASSES]).

## TODO

- [ ] Create [`packages/typediagram/src/render-svg/hooks.ts`](../../packages/typediagram/src/render-svg/hooks.ts) with all context interfaces and `RenderHooks`.
- [ ] Add the try/catch invoker helper in `hooks.ts` (logs via `pino`, returns default).
- [ ] Thread `hooks?: RenderHooks` through `SvgOpts` in [`render.ts`](../../packages/typediagram/src/render-svg/render.ts).
- [ ] Invoke `defs` hook; append result inside `<defs>`.
- [ ] Invoke `background` hook; emit between `</defs>` and first node.
- [ ] Refactor `renderRows` into per-row iteration that invokes `row` hook when present.
- [ ] Invoke `node` hook; skip `row` hook calls for that node when `node` returns a value.
- [ ] Invoke `edge` hook with computed `EdgeCtx` (midpoint, sourceNode, targetNode resolved from `graph.nodes`).
- [ ] Invoke `post` hook last, wrapping the whole SVG.
- [ ] Build `NodeCtx` including resolved `accent`, `header`, and `badge` (unions only).
- [ ] Build `RowCtx` including `textX`, `textY`, `isUnionVariant`.
- [ ] Build `EdgeCtx` including absolute `points`, `midpoint`, `stroke`, `strokeWidth`, `dashArray`.
- [ ] Export hook types from [`render-svg/index.ts`](../../packages/typediagram/src/render-svg/index.ts) and [`typediagram/src/index.ts`](../../packages/typediagram/src/index.ts).
- [ ] Write [HOOK-TEST-DEFAULT-IDENTITY] baseline snapshot (lock in byte-identical output pre/post change).
- [ ] Write [HOOK-TEST-PHASES] (all six phases fire in order).
- [ ] Write [HOOK-TEST-DEFS], [HOOK-TEST-BACKGROUND], [HOOK-TEST-POST] (singleton-phase tests).
- [ ] Write [HOOK-TEST-NODE-OVERRIDE], [HOOK-TEST-NODE-WRAPS-DEFAULT], [HOOK-TEST-ROW-SKIP-WHEN-NODE].
- [ ] Write [HOOK-TEST-EDGE] with geometry assertions.
- [ ] Write [HOOK-TEST-THROW-FALLBACK] with captured pino logs.
- [ ] Write [HOOK-TEST-DETERMINISTIC].
- [ ] Write [HOOK-TEST-CTX-GEOMETRY] asserting absolute coordinates are padding-adjusted.
- [ ] Write [HOOK-TEST-TYPE-SAFETY] with `// @ts-expect-error` on a plain-string return.
- [ ] Write [HOOK-TEST-POS-NODE] — positioning PoC, node transform translates to override position.
- [ ] Write [HOOK-TEST-POS-EDGE] — positioning PoC, edge endpoints follow overridden positions.
- [ ] Run `make test`; ratchet `coverage-thresholds.json` to new measured floor.
- [ ] Run `make lint` and `make fmt`.
- [ ] Run `make ci` as final gate.

## Web playground integration (Layers 2 + 3)

- [ ] Create [`packages/web/src/eval-hooks.ts`](../../packages/web/src/eval-hooks.ts) (Layer 2): `evalHooks(code)` -> `{ ok, hooks?, error? }`. Empty / whitespace-only input returns `{ ok: true }` with no hooks. Uses `new Function("svg", "raw", body)` with `svg`/`raw` from `typediagram-core`.
- [ ] Create [`packages/web/src/hook-presets.ts`](../../packages/web/src/hook-presets.ts) (Layer 3): `PRESETS` as `ReadonlyArray<{ id, label, blurb, source }>`. `togglePresetInCode(code, id, on)` splices block in/out by sentinel-comment regex. `presetsInCode(code)` returns ids of present blocks. No `RenderHooks` exports.
- [ ] Add tabbed UI to [`playground.ts`](../../packages/web/src/playground.ts): `source` (default) and `hooks`. Hooks tab owns a textarea, a diagnostics block, and a row of preset chips along its bottom.
- [ ] Hooks editor `input` event: re-run `evalHooks`; on success, pass `hooks` into `renderPane`; on failure, show error in diag block and render with NO hooks (default path).
- [ ] Chip click: `togglePresetInCode(editor.value, id, !present)` → set editor value → fire input. Chips re-sync from textarea content on every keystroke.
- [ ] `renderPane(source, hooks?)` accepts optional `RenderHooks`; passes `hooks` only when defined (never `{ hooks: {} }`).
- [ ] [WEB-EVAL-HOOKS-TEST] — empty input => no hooks; comment-only => empty hooks object; valid code => callable hooks; syntax error => surfaced via `error`; XSS escape via svg`` works.
- [ ] [WEB-PRESET-SPLICE] — toggle on/off is idempotent; doesn't disturb hand-written code; multiple presets coexist.
- [ ] [WEB-PLAYGROUND] — empty hooks editor => `renderToString` called WITHOUT a `hooks` option; typing code passes hooks; clearing reverts; chip click mutates textarea; hand-typed block lights up the matching chip.
- [ ] Add minimal CSS for `.pane-tabs`, `.pane-tab`, `.hook-chip`, `.hooks-toolbar`, `.hooks-diag`.
