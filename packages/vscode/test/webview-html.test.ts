// [VSCODE-WEBVIEW-HTML-TEST] Tests for webview HTML generation.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parser } from "typediagram-core";
import { webviewHtml } from "../src/webview-html.js";

describe("[VSCODE-WEBVIEW-HTML] webviewHtml", () => {
  const csp = "https://test.csp";
  const scriptUri = { toString: () => "https://test/main.js" } as never;

  it("produces valid HTML document", () => {
    const html = webviewHtml(csp, scriptUri, "type Foo { x: Int }");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<html");
    expect(html).toContain("</html>");
  });

  it("includes CSP meta tag with provided source", () => {
    const html = webviewHtml(csp, scriptUri, "");
    expect(html).toContain(`script-src ${csp}`);
  });

  it("includes script tag with provided URI", () => {
    const html = webviewHtml(csp, scriptUri, "");
    expect(html).toContain('src="https://test/main.js"');
  });

  it("escapes HTML entities in initial source", () => {
    const html = webviewHtml(csp, scriptUri, '<script>"xss"&</script>');
    expect(html).toContain("&lt;script&gt;&quot;xss&quot;&amp;&lt;/script&gt;");
    expect(html).not.toContain('<script>"xss"');
  });

  it("embeds source in data-source attribute", () => {
    const html = webviewHtml(csp, scriptUri, "type A { x: Int }");
    expect(html).toContain('data-source="type A { x: Int }"');
  });

  it("includes preview and error containers", () => {
    const html = webviewHtml(csp, scriptUri, "");
    expect(html).toContain('id="preview"');
    expect(html).toContain('id="error"');
    expect(html).toContain('aria-label="Visual type editor"');
    expect(html).toContain("width: 100%; height: 100%");
  });

  it("keeps an invalid visual edit recoverable from the error overlay", () => {
    const html = webviewHtml(csp, scriptUri, "typeDiagram\ntype Safe { value: String }");
    expect(html).toContain('id="error-panel"');
    expect(html).toContain('id="restore-valid-source"');
    expect(html).toContain("Undo invalid edit");
    expect(html).toContain('aria-label="Undo invalid edit"');
    expect(html).toContain('id="open-source"');
    expect(html).toContain("Open source");
  });

  it("ships a parseable sample for the visual editor recovery workflow", () => {
    const source = readFileSync(new URL("../examples/sample.td", import.meta.url), "utf8");
    const result = parser.parse(source);
    expect(result.ok).toBe(true);
    expect(result.ok ? result.value.declarations.length : 0).toBeGreaterThan(8);
    expect(source).toContain("union Option<T>");
    expect(source).toContain("alias Email = String");
  });
});
