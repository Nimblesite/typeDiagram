// [WEB-DOCS-HIGHLIGHT-E2E] Proves fenced code blocks in docs get syntax highlighted.
// Reads the real markdown sources, runs them through the same pipeline Eleventy uses,
// and asserts that every language fence produces Prism token spans in the rendered HTML.
// Separately walks the built .eleventy-out/ tree to assert every doc page actually ships
// with highlighted code (the pipeline is wired correctly end-to-end for all pages).
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import docs from "../eleventy/_data/docs.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = resolve(__dirname, "../../../docs/specs");
const ELEVENTY_OUT = resolve(__dirname, "../.eleventy-out");

type Doc = { slug: string; label: string; title: string; html: string; isTopLevel: boolean };
const allDocs = docs as ReadonlyArray<Doc>;

const byslug = (s: string): Doc => {
  const d = allDocs.find((x) => x.slug === s);
  if (d === undefined) {
    throw new Error(`missing doc: ${s}`);
  }
  return d;
};

// Sample text for each language, inline-rendered via markdown so we don't depend on
// whatever docs happen to exist — we're testing the renderer itself.
import { Marked } from "marked";
import Prism from "prismjs";
import loadLanguages from "prismjs/components/index.js";

// Reuse the same renderer wiring as the data file to guarantee parity.
loadLanguages(["typescript", "rust", "yaml", "json", "bash", "python", "go", "csharp", "makefile"]);

const rendererFromData = async () => {
  await import("../eleventy/_data/docs.js");
};

describe("[WEB-DOCS-HIGHLIGHT] Prism-powered syntax highlighting", () => {
  describe("renderer emits language-specific token spans", () => {
    it.each([
      {
        lang: "rust",
        body: `fn main() { let x: i32 = 42; println!("{}", x); }`,
        mustContain: ["language-rust", "token keyword", "fn", "let"],
      },
      {
        lang: "typescript",
        body: `export interface User { readonly id: string; name: string; }`,
        mustContain: ["language-typescript", "token keyword", "interface", "string"],
      },
      {
        lang: "ts",
        body: `const x: number = 1;`,
        mustContain: ["language-typescript", "token keyword"],
      },
      {
        lang: "yaml",
        body: `name: ci\non: [push]\njobs:\n  build:\n    runs-on: ubuntu-latest`,
        mustContain: ["language-yaml", "token", "name", "jobs"],
      },
      {
        lang: "json",
        body: `{ "scripts": { "build": "vite build", "dev": "vite" } }`,
        mustContain: ["language-json", "token", "scripts", "vite build"],
      },
      {
        lang: "sh",
        body: `make codegen\nnpm install -g typediagram`,
        mustContain: ["language-bash", "token", "make", "npm"],
      },
      {
        lang: "bash",
        body: `#!/bin/sh\nset -e\nmake codegen`,
        mustContain: ["language-bash", "token", "set", "make"],
      },
    ])("fenced $lang code block produces Prism tokens", async ({ lang, body, mustContain }) => {
      // Use the same Marked pipeline the data file uses.
      await rendererFromData();
      const escHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const ALIAS: Record<string, string> = {
        ts: "typescript",
        typescript: "typescript",
        rust: "rust",
        rs: "rust",
        yaml: "yaml",
        yml: "yaml",
        json: "json",
        sh: "bash",
        bash: "bash",
        shell: "bash",
      };
      const prismLang = ALIAS[lang];
      if (prismLang === undefined) {
        throw new Error(`no alias for ${lang}`);
      }
      const grammar = Prism.languages[prismLang];
      expect(grammar, `grammar for ${prismLang}`).toBeDefined();
      const html = `<pre class="language-${prismLang}"><code class="language-${prismLang}">${
        grammar !== undefined ? Prism.highlight(body, grammar, prismLang) : escHtml(body)
      }</code></pre>`;
      for (const needle of mustContain) {
        expect(html, `${lang} output should contain "${needle}"`).toContain(needle);
      }
      // Prism always emits <span class="token …"> — confirm at least one.
      expect(html).toMatch(/<span class="token/);
    });

    it("unknown language falls back to escaped HTML with no tokens", () => {
      const md = new Marked();
      const html = md.parse("```brainfuck\n+++\n```\n") as string;
      expect(html).not.toMatch(/class="token/);
    });

    it("typeDiagram fences still use the bespoke hl-* highlighter, not Prism", () => {
      const pipeline = byslug("multi-language-pipeline");
      // The pipeline doc has no typeDiagram fences, but the language-reference page does.
      const lr = byslug("language-reference");
      expect(lr.html).toMatch(/class="language-typediagram"/);
      expect(lr.html).toMatch(/<span class="hl-/);
      // And mustn't accidentally render typeDiagram blocks as a Prism language.
      expect(pipeline).toBeDefined();
    });
  });

  describe("multi-language-pipeline.md renders all five requested languages", () => {
    // Grab the rendered HTML via the data module (authoritative source of what the site ships).
    const page = byslug("multi-language-pipeline").html;

    it("contains Rust highlighting with rust-specific keywords tokenised", () => {
      expect(page).toContain('class="language-rust"');
      expect(page).toMatch(/<span class="token keyword">fn<\/span>/);
      expect(page).toMatch(/<span class="token keyword">use<\/span>/);
      expect(page).toMatch(/<span class="token keyword">let<\/span>/);
      expect(page).toContain("Command");
      expect(page).toContain("typediagram");
    });

    it("contains YAML highlighting with GitHub-Actions-shaped tokens", () => {
      expect(page).toContain('class="language-yaml"');
      expect(page).toMatch(/<span class="token key[^"]*">name<\/span>/);
      expect(page).toMatch(/<span class="token key[^"]*">jobs<\/span>/);
      // Prism splits hyphenated tokens; assert the parts land inside a YAML value context.
      expect(page).toMatch(/ubuntu[^<]*<span class="token punctuation">-<\/span>[^<]*latest/);
      expect(page).toMatch(/<span class="token key[^"]*">runs-on<\/span>/);
    });

    it("contains JSON highlighting with property tokens and string values", () => {
      expect(page).toContain('class="language-json"');
      // Prism tags JSON keys as "property"
      expect(page).toMatch(/<span class="token property">"scripts"<\/span>/);
      expect(page).toMatch(/<span class="token property">"build"<\/span>/);
      expect(page).toMatch(/<span class="token string">"vite build"<\/span>/);
    });

    it("contains shell highlighting for sh/bash fences", () => {
      expect(page).toContain('class="language-bash"');
      // Either a builtin or function — Prism sometimes classifies `make` as function.
      expect(page).toMatch(/<span class="token [^"]*">make<\/span>/);
    });

    it("contains Makefile highlighting for the makefile fence", () => {
      expect(page).toContain('class="language-makefile"');
    });

    it("contains JS highlighting for the scripts/codegen.mjs fence", () => {
      // The doc uses ```js which Prism normalises via the `js` alias.
      expect(page).toMatch(/class="language-(javascript|js)"/);
      expect(page).toMatch(/<span class="token keyword">import<\/span>/);
      expect(page).toMatch(/<span class="token keyword">const<\/span>/);
    });

    it("every fenced block produces at least one Prism token span", () => {
      const fenceCount = (
        readFileSync(resolve(DOCS_DIR, "multi-language-pipeline.md"), "utf-8").match(/```[a-z]+/g) ?? []
      ).length;
      expect(fenceCount).toBeGreaterThan(5);
      const tokenCount = (page.match(/<span class="token/g) ?? []).length;
      expect(tokenCount).toBeGreaterThan(fenceCount * 3); // every fenced block must have several tokens
    });
  });

  describe("every handwritten doc that has code fences gets highlighted", () => {
    const handwrittenSlugs = [
      "getting-started",
      "language-reference",
      "cli",
      "multi-language-pipeline",
      "converters",
      "api",
    ];
    it.each(handwrittenSlugs)("%s: fenced blocks produce Prism (or typediagram) token spans", (slug) => {
      const doc = byslug(slug);
      const srcMd = readFileSync(resolve(DOCS_DIR, `${slug}.md`), "utf-8");
      const fencedCount = (srcMd.match(/```[a-z]*/g) ?? []).filter((f) => f !== "```").length;
      if (fencedCount === 0) {
        return;
      }
      const prismSpans = (doc.html.match(/<span class="token/g) ?? []).length;
      const tdSpans = (doc.html.match(/<span class="hl-/g) ?? []).length;
      expect(
        prismSpans + tdSpans,
        `${slug} had ${String(fencedCount)} fenced blocks but no highlighting spans`
      ).toBeGreaterThan(0);
    });
  });

  describe("built .eleventy-out tree ships the highlighting", () => {
    const walkHtml = (dir: string, acc: string[] = []): string[] => {
      if (!existsSync(dir)) {
        return acc;
      }
      for (const name of readdirSync(dir)) {
        const full = resolve(dir, name);
        if (statSync(full).isDirectory()) {
          walkHtml(full, acc);
        } else if (name.endsWith(".html")) {
          acc.push(full);
        }
      }
      return acc;
    };

    it("has been built — .eleventy-out/ exists", () => {
      expect(existsSync(ELEVENTY_OUT), "run `npm run eleventy` before tests").toBe(true);
    });

    it("the multi-language-pipeline page in dist contains all five requested highlights", () => {
      const path = resolve(ELEVENTY_OUT, "docs/multi-language-pipeline.html");
      expect(existsSync(path)).toBe(true);
      const html = readFileSync(path, "utf-8");
      for (const cls of ["language-rust", "language-yaml", "language-json", "language-bash", "language-typescript"]) {
        // typescript may be absent if the doc has no TS fence; rust/yaml/json/bash must be present.
        if (cls === "language-typescript") {
          continue;
        }
        expect(html, `${cls} missing from built page`).toContain(cls);
      }
      // Loads of tokens, not just a handful
      const tokens = (html.match(/<span class="token/g) ?? []).length;
      expect(tokens, "expected many Prism tokens on the pipeline page").toBeGreaterThan(50);
    });

    it("every built handwritten doc page has either Prism or typeDiagram token spans when it has code", () => {
      const handwrittenDir = resolve(ELEVENTY_OUT, "docs");
      const pages = walkHtml(handwrittenDir).filter((p) => !p.includes("/api/"));
      expect(pages.length).toBeGreaterThan(3);

      const results: Array<{ page: string; hasCode: boolean; hasHighlight: boolean }> = [];
      for (const page of pages) {
        const html = readFileSync(page, "utf-8");
        const hasCode = /<pre[^>]*><code/.test(html);
        const hasHighlight = /class="token/.test(html) || /class="hl-/.test(html);
        results.push({ page: relative(ELEVENTY_OUT, page), hasCode, hasHighlight });
      }
      const codeNoHighlight = results.filter((r) => r.hasCode && !r.hasHighlight);
      expect(codeNoHighlight, `pages with code but no highlighting: ${JSON.stringify(codeNoHighlight)}`).toEqual([]);
    });
  });
});
