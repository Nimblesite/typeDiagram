// [WEB-CONV-HIGHLIGHT-TEST] Tests for language-specific syntax highlighting.
import { describe, expect, it, beforeEach } from "vitest";
import { highlightLang, initLangHighlight } from "../src/converter-highlight.js";

describe("[WEB-CONV-HIGHLIGHT] highlightLang()", () => {
  describe("TypeScript", () => {
    it("wraps interface keyword", () => {
      const html = highlightLang("interface Foo {}", "typescript");
      expect(html).toContain('<span class="hl-keyword">interface</span>');
    });

    it("wraps type names", () => {
      const html = highlightLang("interface Foo {}", "typescript");
      expect(html).toContain('<span class="hl-type">Foo</span>');
    });

    it("wraps builtin types", () => {
      const html = highlightLang("name: string", "typescript");
      expect(html).toContain('<span class="hl-builtin">string</span>');
    });

    it("wraps field names before colons", () => {
      const html = highlightLang("  name: string", "typescript");
      expect(html).toContain('<span class="hl-field">name</span>');
    });

    it("wraps single-line comments", () => {
      const html = highlightLang("// hello", "typescript");
      expect(html).toContain('<span class="hl-comment">// hello</span>');
    });
  });

  describe("Rust", () => {
    it("wraps struct keyword", () => {
      const html = highlightLang("pub struct Foo {}", "rust");
      expect(html).toContain('<span class="hl-keyword">struct</span>');
    });

    it("wraps pub keyword", () => {
      const html = highlightLang("pub struct Foo {}", "rust");
      expect(html).toContain('<span class="hl-keyword">pub</span>');
    });

    it("wraps Rust builtins", () => {
      const html = highlightLang("name: String", "rust");
      expect(html).toContain('<span class="hl-builtin">String</span>');
    });
  });

  describe("Python", () => {
    it("wraps class keyword", () => {
      const html = highlightLang("class Foo:", "python");
      expect(html).toContain('<span class="hl-keyword">class</span>');
    });

    it("wraps decorators", () => {
      const html = highlightLang("@dataclass", "python");
      expect(html).toContain('<span class="hl-keyword">@dataclass</span>');
    });

    it("wraps hash comments", () => {
      const html = highlightLang("# comment", "python");
      expect(html).toContain('<span class="hl-comment"># comment</span>');
    });

    it("wraps Python builtins", () => {
      const html = highlightLang("name: str", "python");
      expect(html).toContain('<span class="hl-builtin">str</span>');
    });
  });

  describe("Go", () => {
    it("wraps type keyword", () => {
      const html = highlightLang("type Foo struct {}", "go");
      expect(html).toContain('<span class="hl-keyword">type</span>');
    });

    it("wraps struct keyword", () => {
      const html = highlightLang("type Foo struct {}", "go");
      expect(html).toContain('<span class="hl-keyword">struct</span>');
    });
  });

  describe("C#", () => {
    it("wraps record keyword", () => {
      const html = highlightLang("public record Foo()", "csharp");
      expect(html).toContain('<span class="hl-keyword">record</span>');
    });

    it("wraps C# builtins", () => {
      const html = highlightLang("string name", "csharp");
      expect(html).toContain('<span class="hl-builtin">string</span>');
    });
  });

  describe("F#", () => {
    it("wraps type keyword", () => {
      const html = highlightLang("type Foo = {}", "fsharp");
      expect(html).toContain('<span class="hl-keyword">type</span>');
    });

    it("wraps F# builtins", () => {
      const html = highlightLang("string option list", "fsharp");
      expect(html).toContain('<span class="hl-builtin">string</span>');
      expect(html).toContain('<span class="hl-builtin">option</span>');
      expect(html).toContain('<span class="hl-builtin">list</span>');
    });
  });

  it("escapes HTML entities", () => {
    const html = highlightLang("<script>", "typescript");
    expect(html).toContain("&lt;");
    expect(html).not.toContain("<script>");
  });

  it("appends trailing newline-space", () => {
    const html = highlightLang("x", "typescript");
    expect(html).toMatch(/\n $/);
  });
});

describe("[WEB-CONV-HIGHLIGHT] initLangHighlight()", () => {
  let textarea: HTMLTextAreaElement;
  let backdrop: HTMLElement;

  beforeEach(() => {
    textarea = document.createElement("textarea");
    backdrop = document.createElement("pre");
    backdrop.innerHTML = "<code></code>";
  });

  it("syncs highlighted content to backdrop code element", () => {
    const sync = initLangHighlight(textarea, backdrop, () => "typescript");
    textarea.value = "interface Foo {}";
    sync?.();
    const code = backdrop.querySelector("code");
    expect(code).not.toBeNull();
    if (code === null) {
      return;
    }
    expect(code.innerHTML).toContain("hl-keyword");
  });

  it("re-highlights on input event", () => {
    initLangHighlight(textarea, backdrop, () => "rust");
    textarea.value = "pub struct Bar {}";
    textarea.dispatchEvent(new Event("input"));
    const code = backdrop.querySelector("code");
    expect(code).not.toBeNull();
    if (code === null) {
      return;
    }
    expect(code.innerHTML).toContain("hl-keyword");
  });

  it("returns undefined when no code element exists", () => {
    const emptyBackdrop = document.createElement("pre");
    const result = initLangHighlight(textarea, emptyBackdrop, () => "typescript");
    expect(result).toBeUndefined();
  });

  it("uses the language getter for current lang", () => {
    let lang: "typescript" | "rust" = "typescript";
    const sync = initLangHighlight(textarea, backdrop, () => lang);
    textarea.value = "pub struct Foo {}";

    lang = "rust";
    sync?.();
    const code = backdrop.querySelector("code");
    expect(code).not.toBeNull();
    if (code === null) {
      return;
    }
    expect(code.innerHTML).toContain('<span class="hl-keyword">pub</span>');
  });
});
