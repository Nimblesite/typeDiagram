// [WEB-EVAL-HOOKS-TEST] User JS -> RenderHooks compilation, including the
// critical "hooks are optional" path (empty input -> no hooks at all).
import { describe, expect, it } from "vitest";
import { renderToString, raw } from "typediagram-core";
import { evalHooks } from "../src/eval-hooks.js";

const SRC = `typeDiagram
  type User { id: UUID, email: String, name: String }
  union Shape { Circle { radius: Float } Square { side: Float } }
`;

describe("[WEB-EVAL-HOOKS] evalHooks", () => {
  it("empty string returns ok with NO hooks — render path is unaffected", () => {
    const r = evalHooks("");
    expect(r.ok).toBe(true);
    expect(r.hooks).toBeUndefined();
    expect(r.error).toBeUndefined();
  });

  it("whitespace-only string returns ok with NO hooks", () => {
    expect(evalHooks("   \n  \n").hooks).toBeUndefined();
  });

  it("comments-only code returns ok with NO hooks (preserves the optional invariant)", () => {
    // Even though the body runs and `const hooks = {}` is returned, the
    // evaluator must treat zero-property hooks as "no hooks" so that the
    // renderer receives no `hooks` option at all — identical to empty input.
    const r = evalHooks("// just a comment\n");
    expect(r.ok).toBe(true);
    expect(r.hooks).toBeUndefined();
  });

  it("assigning a node hook produces a callable RenderHooks.node", () => {
    const r = evalHooks(`hooks.node = (ctx, def) => svg\`<g data-x="\${ctx.node.declName}">\${def}</g>\`;`);
    expect(r.ok).toBe(true);
    expect(typeof r.hooks?.node).toBe("function");
  });

  it("produces hooks usable by renderToString — output contains hook-injected attr", async () => {
    const r = evalHooks(`hooks.node = (ctx, def) => svg\`<g data-custom="yes">\${def}</g>\`;`);
    expect(r.ok).toBe(true);
    const out = await renderToString(SRC, { hooks: r.hooks });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.value).toContain(`data-custom="yes"`);
    }
  });

  it("return-style code is also accepted", () => {
    const r = evalHooks(`return { defs: () => svg\`<filter id="x"/>\` };`);
    expect(r.ok).toBe(true);
    expect(typeof r.hooks?.defs).toBe("function");
  });

  it("syntax errors are caught and surfaced via { ok: false, error }", () => {
    const r = evalHooks(`hooks.node = ###;`);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/SyntaxError|Unexpected/);
    expect(r.hooks).toBeUndefined();
  });

  it("runtime throws inside the body are caught", () => {
    const r = evalHooks(`throw new Error("boom")`);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("boom");
  });

  it("user code that re-returns undefined explicitly is treated as 'no hooks'", () => {
    // The user writes a `return undefined;` before any hook assignments.
    const r = evalHooks("return undefined;");
    expect(r.ok).toBe(true);
    expect(r.hooks).toBeUndefined();
  });

  it("non-Error throws are stringified into `error`", () => {
    const r = evalHooks(`throw "just a string";`);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("just a string");
  });

  it("svg tag works inside user code for escaping interpolated strings", () => {
    const r = evalHooks(`hooks.node = (ctx, def) => svg\`<g data-x="\${"<script>"}">\${def}</g>\`;`);
    expect(r.ok).toBe(true);
    const fakeCtx = { node: { declName: "X" } } as unknown as Parameters<
      NonNullable<NonNullable<typeof r.hooks>["node"]>
    >[0];
    // Use the real `raw` helper so the SafeSvg brand matches what svg`` expects.
    const def = raw("");
    const out = r.hooks?.node?.(fakeCtx, def);
    expect(out?.value).not.toContain("<script>");
    expect(out?.value).toContain("&lt;script&gt;");
  });

  it("default render (NO hooks passed) ≡ render with evalHooks('').hooks", async () => {
    const base = await renderToString(SRC);
    const withEvalEmpty = await renderToString(SRC, { hooks: evalHooks("").hooks });
    expect(base.ok && withEvalEmpty.ok).toBe(true);
    if (base.ok && withEvalEmpty.ok) {
      expect(withEvalEmpty.value).toBe(base.value);
    }
  });
});
