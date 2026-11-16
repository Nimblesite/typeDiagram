// [WEB-HIGHLIGHT-TEST] Tests for syntax highlighting in the web editor.
import { describe, expect, it, beforeEach } from "vitest";
import { highlight, initHighlight } from "../src/highlight.js";

describe("[WEB-HIGHLIGHT] highlight()", () => {
  it("wraps keywords in hl-keyword spans", () => {
    const html = highlight("type Foo { }");
    expect(html).toContain('<span class="hl-keyword">type</span>');
  });

  it("wraps type names in hl-type spans", () => {
    const html = highlight("type Foo { }");
    expect(html).toContain('<span class="hl-type">Foo</span>');
  });

  it("wraps builtin types in hl-builtin spans", () => {
    const html = highlight("name: String");
    expect(html).toContain('<span class="hl-builtin">String</span>');
  });

  it("wraps field names in hl-field spans", () => {
    const html = highlight("  name: String");
    expect(html).toContain('<span class="hl-field">name</span>');
  });

  it("wraps comments in hl-comment spans", () => {
    const html = highlight("# hello world");
    expect(html).toContain('<span class="hl-comment"># hello world</span>');
  });

  it("wraps punctuation in hl-punct spans", () => {
    const html = highlight("{ }");
    expect(html).toContain('<span class="hl-punct">{</span>');
  });

  it("escapes HTML entities in source", () => {
    const html = highlight("type A<B> { }");
    expect(html).toContain("&lt;");
    expect(html).toContain("&gt;");
    expect(html).not.toContain("<B>");
  });

  it("highlights typeDiagram header", () => {
    const html = highlight("typeDiagram\n");
    expect(html).toContain('<span class="hl-keyword">typeDiagram</span>');
  });

  it("highlights all keywords: type, union, alias", () => {
    const html = highlight("type A { }\n union B { }\n alias C = String");
    expect(html).toContain('<span class="hl-keyword">type</span>');
    expect(html).toContain('<span class="hl-keyword">union</span>');
    expect(html).toContain('<span class="hl-keyword">alias</span>');
  });

  it("highlights all builtins", () => {
    for (const b of ["Bool", "Int", "Float", "String", "Bytes", "Unit", "List", "Map", "Option"]) {
      const html = highlight(`x: ${b}`);
      expect(html).toContain(`<span class="hl-builtin">${b}</span>`);
    }
  });

  it("appends trailing space for correct textarea height matching", () => {
    const html = highlight("type Foo { }");
    expect(html).toMatch(/\n $/);
  });

  it("handles empty input", () => {
    const html = highlight("");
    expect(html).toBe("\n ");
  });

  it("handles source already ending with newline", () => {
    const html = highlight("type Foo { }\n");
    expect(html).toMatch(/ $/);
  });
});

describe("[WEB-HIGHLIGHT] initHighlight()", () => {
  let textarea: HTMLTextAreaElement;
  let backdrop: HTMLElement;

  beforeEach(() => {
    textarea = document.createElement("textarea");
    backdrop = document.createElement("pre");
    backdrop.innerHTML = "<code></code>";
    document.body.appendChild(textarea);
    document.body.appendChild(backdrop);
  });

  it("populates the code element on init", () => {
    textarea.value = "type Foo { }";
    initHighlight(textarea, backdrop);
    const code = backdrop.querySelector("code");
    expect(code?.innerHTML).toContain('<span class="hl-keyword">type</span>');
  });

  it("updates code on textarea input", () => {
    textarea.value = "";
    initHighlight(textarea, backdrop);
    textarea.value = "union Bar { }";
    textarea.dispatchEvent(new Event("input"));
    const code = backdrop.querySelector("code");
    expect(code?.innerHTML).toContain('<span class="hl-keyword">union</span>');
  });

  it("syncs scroll position", () => {
    initHighlight(textarea, backdrop);
    Object.defineProperty(textarea, "scrollTop", { value: 42, writable: true });
    Object.defineProperty(textarea, "scrollLeft", { value: 10, writable: true });
    textarea.dispatchEvent(new Event("scroll"));
    expect(backdrop.scrollTop).toBe(42);
    expect(backdrop.scrollLeft).toBe(10);
  });

  it("does nothing when code element is missing", () => {
    const emptyBackdrop = document.createElement("pre");
    initHighlight(textarea, emptyBackdrop);
    // No crash
  });
});
