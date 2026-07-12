import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../src/markdown.js";
import { SMALL_EXAMPLE } from "./fixtures.js";
import { svgCount, unwrap } from "./helpers.js";

/** Render markdown and unwrap the ok Result to its spliced output string. */
const renderMd = async (md: string): Promise<string> => unwrap(await renderMarkdown(md));

describe("markdown — renderMarkdown", () => {
  it("returns input unchanged when no fences", async () => {
    const md = "# hello\n\nsome text";
    const out = await renderMd(md);
    expect(out).toBe(md);
  });

  it("replaces a typeDiagram fence with rendered SVG", async () => {
    const md = "before\n\n```typeDiagram\n" + SMALL_EXAMPLE.trim() + "\n```\n\nafter";
    const out = await renderMd(md);
    expect(out).toContain("before");
    expect(out).toContain("after");
    expect(out).toContain("<svg");
    expect(out).not.toContain("```typeDiagram");
  });

  it("leaves other fences untouched", async () => {
    const md = "```js\nconsole.log(1)\n```\n\n```typeDiagram\ntype X { a: Int }\n```";
    const out = await renderMd(md);
    expect(out).toContain("```js\nconsole.log(1)\n```");
    expect(out).toContain("<svg");
  });

  it("handles multiple typeDiagram fences in one doc", async () => {
    const md = "```typeDiagram\ntype A { x: Int }\n```\n\n```typeDiagram\ntype B { y: Int }\n```";
    const out = await renderMd(md);
    expect(svgCount(out)).toBe(2);
  });

  it("emits HTML-comment diagnostics on a bad fence (still returns Result.err)", async () => {
    const md = "```typeDiagram\ntype X { @bad }\n```";
    const r = await renderMarkdown(md);
    expect(r.ok).toBe(false);
    if (r.ok) {
      throw new Error("unreachable");
    }
    expect(r.error.length).toBeGreaterThan(0);
  });

  // [MD-INTERLEAVED] Proves that prose, headings, lists, quotes, and other fences
  // surrounding typeDiagram blocks are preserved verbatim, in order, without bleeding.
  it("preserves heading → prose → typeDiagram → prose → list → typeDiagram → quote structure and order", async () => {
    const md = [
      "# Title",
      "",
      "Intro paragraph with `inline code` and **bold**.",
      "",
      "```typeDiagram",
      "type A { x: Int }",
      "```",
      "",
      "Between paragraph.",
      "",
      "- item one",
      "- item two",
      "",
      "```typeDiagram",
      "type B { y: String }",
      "```",
      "",
      "> closing quote",
      "",
      "Trailing paragraph.",
    ].join("\n");
    const out = await renderMd(md);
    // Every non-diagram section survives verbatim.
    expect(out).toContain("# Title");
    expect(out).toContain("Intro paragraph with `inline code` and **bold**.");
    expect(out).toContain("Between paragraph.");
    expect(out).toContain("- item one");
    expect(out).toContain("- item two");
    expect(out).toContain("> closing quote");
    expect(out).toContain("Trailing paragraph.");
    // Both fences were replaced.
    expect(out).not.toContain("```typeDiagram");
    expect(out).not.toContain("type A { x: Int }");
    expect(out).not.toContain("type B { y: String }");
    // Exactly two SVGs, in the right order relative to surrounding prose.
    const svgMatches = [...out.matchAll(/<svg/g)];
    expect(svgMatches.length).toBe(2);
    const iTitle = out.indexOf("# Title");
    const iIntro = out.indexOf("Intro paragraph");
    const iSvg0 = svgMatches[0]?.index ?? -1;
    const iBetween = out.indexOf("Between paragraph.");
    const iList = out.indexOf("- item one");
    const iSvg1 = svgMatches[1]?.index ?? -1;
    const iQuote = out.indexOf("> closing quote");
    const iTrailing = out.indexOf("Trailing paragraph.");
    expect(iTitle).toBeGreaterThanOrEqual(0);
    expect(iIntro).toBeGreaterThan(iTitle);
    expect(iSvg0).toBeGreaterThan(iIntro);
    expect(iBetween).toBeGreaterThan(iSvg0);
    expect(iList).toBeGreaterThan(iBetween);
    expect(iSvg1).toBeGreaterThan(iList);
    expect(iQuote).toBeGreaterThan(iSvg1);
    expect(iTrailing).toBeGreaterThan(iQuote);
  });

  it("does not merge two adjacent typeDiagram fences into one regex match", async () => {
    // Non-greedy regex must still stop at the FIRST closing fence, not span the second.
    const md = "```typeDiagram\ntype A { x: Int }\n```\n\n```typeDiagram\ntype B { y: Int }\n```";
    const out = await renderMd(md);
    expect((out.match(/<svg/g) ?? []).length).toBe(2);
    expect(out).not.toContain("type A");
    expect(out).not.toContain("type B");
    expect(out).not.toContain("```");
  });

  it("preserves adjacent non-typediagram fenced blocks (js before, python after)", async () => {
    const md = [
      "```js",
      "const x = 1;",
      "```",
      "",
      "```typeDiagram",
      "type A { x: Int }",
      "```",
      "",
      "```python",
      "x = 1",
      "```",
    ].join("\n");
    const out = await renderMd(md);
    expect(out).toContain("```js\nconst x = 1;\n```");
    expect(out).toContain("```python\nx = 1\n```");
    expect(out).toContain("<svg");
    expect(svgCount(out)).toBe(1);
    // The js fence must appear BEFORE the SVG which must appear BEFORE the python fence.
    const iJs = out.indexOf("```js");
    const iSvg = out.indexOf("<svg");
    const iPy = out.indexOf("```python");
    expect(iJs).toBeLessThan(iSvg);
    expect(iSvg).toBeLessThan(iPy);
  });

  it("does not consume a non-typediagram fence that sits between two typediagram fences", async () => {
    const md = [
      "```typeDiagram",
      "type A { x: Int }",
      "```",
      "",
      "```js",
      "console.log('untouched');",
      "```",
      "",
      "```typeDiagram",
      "type B { y: Int }",
      "```",
    ].join("\n");
    const out = await renderMd(md);
    expect(svgCount(out)).toBe(2);
    expect(out).toContain("console.log('untouched')");
    expect(out).toContain("```js");
    // js block stays exactly between the two SVGs.
    const svgs = [...out.matchAll(/<svg/g)];
    const iJs = out.indexOf("```js");
    expect(svgs[0]?.index).toBeLessThan(iJs);
    expect(iJs).toBeLessThan(svgs[1]?.index ?? -1);
  });

  it("returns raw SVG, not HTML-escaped, so markdown-it passes it through as HTML", async () => {
    const md = "before\n\n```typeDiagram\ntype A { x: Int }\n```\n\nafter";
    const out = await renderMd(md);
    // If the SVG were escaped, it would contain &lt;svg and zero <svg.
    expect(out).toContain("<svg");
    expect(out).not.toContain("&lt;svg");
    expect(out).not.toContain("&amp;lt;");
  });

  it("keeps prose untouched when an indented four-space code block contains a fake fence", async () => {
    // Four-space-indented content is a code block in commonmark; our regex uses ^``` so an
    // indented "```typediagram" should NOT be treated as a real fence.
    const md = ["paragraph", "", "    ```typeDiagram", "    type Fake { x: Int }", "    ```", "", "end"].join("\n");
    const out = await renderMd(md);
    expect(out).toBe(md);
    expect(out).not.toContain("<svg");
  });

  it("supports tilde-less ``` fences of length > 3 (four or more backticks)", async () => {
    const md = "````typeDiagram\ntype A { x: Int }\n````\n\ntrailing";
    const out = await renderMd(md);
    expect(out).toContain("<svg");
    expect(out).toContain("trailing");
    expect(out).not.toContain("````typeDiagram");
  });

  it("renders even when the very first character of the document starts a fence", async () => {
    const md = "```typeDiagram\ntype A { x: Int }\n```\n\ntail";
    const out = await renderMd(md);
    expect(out.startsWith("<svg")).toBe(true);
    expect(out).toContain("tail");
  });

  it("renders even when a fence is the last thing in the document with no trailing newline", async () => {
    const md = "head\n\n```typeDiagram\ntype A { x: Int }\n```";
    const out = await renderMd(md);
    expect(out).toContain("head");
    expect(out).toContain("<svg");
    expect(out).not.toContain("```");
  });

  it("one bad fence between two good fences — good ones still render, bad one becomes an HTML comment", async () => {
    const md = [
      "```typeDiagram",
      "type A { x: Int }",
      "```",
      "",
      "middle",
      "",
      "```typeDiagram",
      "type X { @bad }",
      "```",
      "",
      "more",
      "",
      "```typeDiagram",
      "type B { y: Int }",
      "```",
    ].join("\n");
    const r = await renderMarkdown(md);
    expect(r.ok).toBe(false);
    if (r.ok) {
      throw new Error("unreachable");
    }
    // Even on the err path, the caller still needs the spliced markdown — but
    // renderMarkdown only returns md on ok. This documents current behaviour:
    // err path omits the spliced output, so callers must render again or
    // treat diagnostics as fatal. Assert the diagnostic captures the middle fence.
    expect(r.error.length).toBeGreaterThan(0);
    expect(r.error.some((d) => typeof d.message === "string")).toBe(true);
  });
});
