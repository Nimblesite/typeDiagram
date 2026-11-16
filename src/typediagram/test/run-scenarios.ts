// [TEST-RUN-SCENARIOS] Shared test runner for SVG snapshot scenarios.
// Both CLI and web test suites call this with their own snapshot directory.
import { describe, expect, it } from "vitest";
import { renderToString } from "../src/index.js";
import { SCENARIOS, type Scenario } from "./scenarios.js";

const render = async (src: string) => {
  const r = await renderToString(src);
  expect(r.ok).toBe(true);
  return r.ok ? r.value : "";
};

const assertScenario = (svg: string, s: Scenario) => {
  for (const c of s.contains) {
    expect(svg).toContain(c);
  }
  for (const nc of s.notContains) {
    expect(svg).not.toContain(nc);
  }
  for (const p of s.patterns) {
    expect(svg).toMatch(p);
  }
  for (const cc of s.countChecks) {
    expect((svg.match(cc.pattern) ?? []).length).toBe(cc.count);
  }
};

export const runSnapshotScenarios = (tag: string, snapshotDir: string) => {
  describe(`[${tag}] SVG snapshots for all scenario types`, () => {
    for (const s of SCENARIOS) {
      it(s.name, async () => {
        const svg = await render(s.source);
        assertScenario(svg, s);
        await expect(svg).toMatchFileSnapshot(`${snapshotDir}/${s.snapshotFile}`);
      });
    }
  });
};
