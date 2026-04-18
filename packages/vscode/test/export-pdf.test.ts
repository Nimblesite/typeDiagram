// [PDF] Unit tests for the PDF export pipeline.
// Stage IDs map to the spec: [PDF-READ] [PDF-COMPOSE] [PDF-SHELL] [PDF-PRINT] [PDF-SAVE].
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as mock from "./vscode-mock.js";
import { warmupSyncRender } from "typediagram-core";
import type * as vscodeTypes from "vscode";

vi.mock("vscode", () => mock);

import {
  buildShell,
  composeHtml,
  exportPdf,
  extractSvgs,
  readMarkdown,
  reinjectSvgs,
  renderHtmlToPdf,
  siblingPdfPath,
  writeNextToSource,
  type ExportPdfDeps,
  type WebviewPanelLike,
} from "../src/export-pdf.js";

const PDF_MAGIC = "%PDF-";

interface TestDepsOverrides {
  pdfBuffer?: Uint8Array;
  readFileContent?: string;
  readFileThrows?: Error;
  writeFileThrows?: Error;
  skipLoadMessage?: boolean;
  noPrintToPdf?: boolean;
}

function makeDeps(overrides: TestDepsOverrides = {}): {
  deps: ExportPdfDeps;
  spies: {
    readFile: ReturnType<typeof vi.fn>;
    writeFile: ReturnType<typeof vi.fn>;
    printToPDF: ReturnType<typeof vi.fn>;
    createWebviewPanel: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
    showInformationMessage: ReturnType<typeof vi.fn>;
    showErrorMessage: ReturnType<typeof vi.fn>;
    openExternal: ReturnType<typeof vi.fn>;
    executeCommand: ReturnType<typeof vi.fn>;
    uriWithPath: ReturnType<typeof vi.fn>;
  };
} {
  const pdfBuffer =
    overrides.pdfBuffer ?? new TextEncoder().encode(`${PDF_MAGIC}1.7\n${"x".repeat(2048)}\n% /Pattern m l re\n%%EOF\n`);
  const readContent = overrides.readFileContent ?? "# hello\n\n```typediagram\ntype X { a: Int }\n```\n";

  const readFile = vi.fn(() => {
    if (overrides.readFileThrows) {
      return Promise.reject(overrides.readFileThrows);
    }
    return Promise.resolve(new TextEncoder().encode(readContent));
  });
  const writeFile = vi.fn(() => {
    if (overrides.writeFileThrows) {
      return Promise.reject(overrides.writeFileThrows);
    }
    return Promise.resolve();
  });
  const printToPDF = vi.fn(() => Promise.resolve(pdfBuffer));
  const dispose = vi.fn();
  const panel: WebviewPanelLike = {
    webview: {
      html: "",
      printToPDF: overrides.noPrintToPdf === true ? undefined : printToPDF,
      onDidReceiveMessage: (handler) => {
        if (overrides.skipLoadMessage !== true) {
          queueMicrotask(() => {
            handler({ kind: "td-print-ready" });
          });
        }
        return { dispose: vi.fn() };
      },
    },
    dispose,
  };
  const createWebviewPanel = vi.fn(() => panel);
  const showInformationMessage = vi.fn(() => Promise.resolve(undefined));
  const showErrorMessage = vi.fn();
  const openExternal = vi.fn(() => Promise.resolve(true));
  const executeCommand = vi.fn(() => Promise.resolve(undefined));
  const uriWithPath = vi.fn((_base: { path: string; toString: () => string }, newPath: string) => ({
    path: newPath,
    scheme: "file",
    toString: () => `file://${newPath}`,
  }));

  return {
    deps: {
      readFile: readFile as unknown as ExportPdfDeps["readFile"],
      writeFile: writeFile as unknown as ExportPdfDeps["writeFile"],
      createWebviewPanel: createWebviewPanel as unknown as ExportPdfDeps["createWebviewPanel"],
      uriWithPath: uriWithPath as unknown as ExportPdfDeps["uriWithPath"],
      showInformationMessage: showInformationMessage as unknown as ExportPdfDeps["showInformationMessage"],
      showErrorMessage,
      openExternal: openExternal as unknown as ExportPdfDeps["openExternal"],
      executeCommand: executeCommand as unknown as ExportPdfDeps["executeCommand"],
    },
    spies: {
      readFile,
      writeFile,
      printToPDF,
      createWebviewPanel,
      dispose,
      showInformationMessage,
      showErrorMessage,
      openExternal,
      executeCommand,
      uriWithPath,
    },
  };
}

const SAMPLE_URI = {
  path: "/repo/packages/vscode/examples/spec.md",
  scheme: "file",
  toString: () => "file:///repo/packages/vscode/examples/spec.md",
} as unknown as vscodeTypes.Uri;

// ---------------------------------------------------------------------------
// [PDF-COMPOSE] sentinel swap
// ---------------------------------------------------------------------------

describe("[PDF-COMPOSE] extractSvgs / reinjectSvgs", () => {
  it("replaces every <svg> block with a sentinel and collects them in order", () => {
    const md = "prose\n\n<svg>one</svg>\n\nmore\n\n<svg>two</svg>\n\nend";
    const { skeleton, svgs } = extractSvgs(md);
    expect(skeleton).not.toContain("<svg");
    expect(skeleton).toContain("\uE000TDSVG0\uE001");
    expect(skeleton).toContain("\uE000TDSVG1\uE001");
    expect(svgs).toEqual(["<svg>one</svg>", "<svg>two</svg>"]);
  });

  it("round-trips: reinjectSvgs(extractSvgs(x).skeleton, svgs) === x", () => {
    const md = "a\n<svg>a</svg>\nb\n<svg foo='bar'>multi\nline</svg>\nc";
    const { skeleton, svgs } = extractSvgs(md);
    expect(reinjectSvgs(skeleton, svgs)).toBe(md);
  });

  it("matches multiline SVGs with attributes", () => {
    const md = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
<rect/>
</svg>`;
    const { svgs } = extractSvgs(md);
    expect(svgs).toHaveLength(1);
    expect(svgs[0]).toContain("<rect/>");
  });

  it("reinjectSvgs throws on unmatched sentinel index", () => {
    expect(() => reinjectSvgs("\uE000TDSVG5\uE001", [])).toThrow(/unmatched sentinel/);
  });

  it("does NOT leak the sentinel token into the final output", () => {
    const md = "<svg>x</svg>";
    const { skeleton, svgs } = extractSvgs(md);
    const out = reinjectSvgs(skeleton, svgs);
    expect(out).not.toContain("\uE000");
    expect(out).not.toContain("TDSVG");
  });
});

// ---------------------------------------------------------------------------
// [PDF-SHELL]
// ---------------------------------------------------------------------------

describe("[PDF-SHELL] buildShell", () => {
  it("produces a self-contained HTML doc with @page A4 20mm", () => {
    const html = buildShell("my doc", "<p>hi</p>");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain("@page { size: A4; margin: 20mm; }");
    expect(html).toContain("<p>hi</p>");
    expect(html).toContain("<title>my doc</title>");
  });

  it("references NO external stylesheets, scripts, or fonts", () => {
    const html = buildShell("t", "<p>x</p>");
    expect(html).not.toMatch(/<link[^>]+href=["']https?:/);
    expect(html).not.toMatch(/<script[^>]+src=["']https?:/);
    expect(html).not.toMatch(/@import\s+url\(https?:/);
    expect(html).not.toMatch(/@font-face[^}]*src:\s*url\(https?:/);
  });

  it("escapes the title so a malicious filename can't break out", () => {
    const html = buildShell("</title><script>alert(1)</script>", "<p/>");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;/title&gt;");
  });

  it("uses a system font stack — no bundled font files", () => {
    const html = buildShell("t", "");
    expect(html).toMatch(/font-family:\s*-apple-system/);
    expect(html).toMatch(/Helvetica/);
    expect(html).toMatch(/Courier New|ui-monospace/);
    // No font URL references
    expect(html).not.toMatch(/font-file|\.woff|\.ttf|\.otf/i);
  });

  it("includes the load-handshake script that posts td-print-ready", () => {
    const html = buildShell("t", "");
    expect(html).toContain("acquireVsCodeApi");
    expect(html).toContain("td-print-ready");
  });
});

// ---------------------------------------------------------------------------
// [PDF-COMPOSE] full composition
// ---------------------------------------------------------------------------

describe("[PDF-COMPOSE] composeHtml", () => {
  beforeAll(async () => {
    await warmupSyncRender();
  });

  it("passes through markdown with zero typediagram fences", () => {
    const { html, fenceCount } = composeHtml("# hi\n\nparagraph\n", { theme: "light", title: "t" });
    expect(fenceCount).toBe(0);
    expect(html).toContain("<h1>hi</h1>");
    expect(html).toContain("<p>paragraph</p>");
    expect(html).not.toContain("<svg");
  });

  it("inlines an SVG for each typediagram fence (no html-escaping of the SVG)", () => {
    const md = "intro\n\n```typediagram\ntype X { a: Int }\n```\n\nouttro\n";
    const { html, fenceCount } = composeHtml(md, { theme: "light", title: "t" });
    expect(fenceCount).toBe(1);
    expect(html).toContain("<svg");
    expect(html).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(html).not.toContain("&lt;svg");
    expect(html).not.toContain("```typediagram");
    expect(html).toContain("intro");
    expect(html).toContain("outtro");
  });

  it("handles multiple fences independently, in order", () => {
    const md = "```typediagram\ntype A { x: Int }\n```\n\n```typediagram\ntype B { y: Int }\n```";
    const { html, fenceCount } = composeHtml(md, { theme: "light", title: "t" });
    expect(fenceCount).toBe(2);
    const svgCount = (html.match(/<svg\b/g) ?? []).length;
    expect(svgCount).toBe(2);
  });

  it("does NOT leak sentinel tokens into the composed HTML", () => {
    const md = "```typediagram\ntype X { a: Int }\n```";
    const { html } = composeHtml(md, { theme: "light", title: "t" });
    expect(html).not.toContain("\uE000");
    expect(html).not.toContain("TDSVG");
  });

  it("produces different output for light vs dark when a fence is present", () => {
    const md = "```typediagram\ntype X { a: Int }\n```";
    const lightHtml = composeHtml(md, { theme: "light", title: "t" }).html;
    const darkHtml = composeHtml(md, { theme: "dark", title: "t" }).html;
    expect(lightHtml).not.toBe(darkHtml);
  });

  it("surfaces diagnostics for a bad fence and still returns an html string", () => {
    const md = "```typediagram\ntype X { @bad }\n```";
    const result = composeHtml(md, { theme: "light", title: "t" });
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(typeof result.html).toBe("string");
    expect(result.html.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// [PDF-READ]
// ---------------------------------------------------------------------------

describe("[PDF-READ] readMarkdown", () => {
  it("reads bytes and decodes UTF-8", async () => {
    const { deps, spies } = makeDeps({ readFileContent: "# héllo ✨\n" });
    const src = await readMarkdown(SAMPLE_URI, deps);
    expect(src).toBe("# héllo ✨\n");
    expect(spies.readFile).toHaveBeenCalledWith(SAMPLE_URI);
  });

  it("rejects when the file cannot be read", async () => {
    const { deps } = makeDeps({ readFileThrows: new Error("ENOENT") });
    await expect(readMarkdown(SAMPLE_URI, deps)).rejects.toThrow(/ENOENT/);
  });
});

// ---------------------------------------------------------------------------
// [PDF-PRINT]
// ---------------------------------------------------------------------------

describe("[PDF-PRINT] renderHtmlToPdf", () => {
  it("creates a webview, awaits load, calls printToPDF, disposes panel", async () => {
    const { deps, spies } = makeDeps();
    const buf = await renderHtmlToPdf(buildShell("t", "<p>hi</p>"), deps);
    const prefix = new TextDecoder().decode(buf.slice(0, 5));
    expect(prefix).toBe(PDF_MAGIC);
    expect(spies.createWebviewPanel).toHaveBeenCalledTimes(1);
    expect(spies.printToPDF).toHaveBeenCalledTimes(1);
    expect(spies.dispose).toHaveBeenCalledTimes(1);
    expect(spies.printToPDF.mock.calls[0]?.[0]).toMatchObject({ pageSize: "A4", printBackground: true });
  });

  it("sets the webview html to the composed shell", async () => {
    const { deps } = makeDeps();
    const html = buildShell("t", "<p>hi</p>");
    await renderHtmlToPdf(html, deps);
    // Panel was disposed after the print — we need to capture the assignment before that.
    // Test via a fresh panel instance that records its html setter invocations.
    let capturedHtml = "";
    const capturingPanel: WebviewPanelLike = {
      webview: {
        set html(v: string) {
          capturedHtml = v;
        },
        get html() {
          return capturedHtml;
        },
        printToPDF: () => Promise.resolve(new TextEncoder().encode(PDF_MAGIC + "1.7\n")),
        onDidReceiveMessage: (h) => {
          queueMicrotask(() => {
            h({});
          });
          return { dispose: vi.fn() };
        },
      },
      dispose: vi.fn(),
    };
    const capturingDeps: Pick<ExportPdfDeps, "createWebviewPanel"> = {
      createWebviewPanel: () => capturingPanel,
    };
    await renderHtmlToPdf(html, capturingDeps);
    expect(capturedHtml).toBe(html);
  });

  it("rejects with a clear message if printToPDF is unavailable", async () => {
    const { deps } = makeDeps({ noPrintToPdf: true });
    await expect(renderHtmlToPdf("<html/>", deps)).rejects.toThrow(/printToPDF is not available/);
  });

  it("rejects if the webview never signals loaded (timeout)", async () => {
    vi.useFakeTimers();
    const { deps } = makeDeps({ skipLoadMessage: true });
    const p = renderHtmlToPdf("<html/>", deps);
    vi.advanceTimersByTime(15_100);
    await expect(p).rejects.toThrow(/webview load timeout/);
    vi.useRealTimers();
  });

  it("disposes the panel even when printToPDF fails", async () => {
    const { deps, spies } = makeDeps();
    spies.printToPDF.mockRejectedValueOnce(new Error("chrome crashed"));
    await expect(renderHtmlToPdf("<html/>", deps)).rejects.toThrow(/chrome crashed/);
    expect(spies.dispose).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// [PDF-SAVE]
// ---------------------------------------------------------------------------

describe("[PDF-SAVE] siblingPdfPath + writeNextToSource", () => {
  it("maps foo.md → foo.pdf", () => {
    expect(siblingPdfPath("/a/b/foo.md")).toBe("/a/b/foo.pdf");
  });

  it("maps foo.MARKDOWN → foo.pdf (case-insensitive)", () => {
    expect(siblingPdfPath("/a/b/foo.MARKDOWN")).toBe("/a/b/foo.pdf");
  });

  it("maps notes.txt → notes.txt.pdf (no markdown extension)", () => {
    expect(siblingPdfPath("/a/notes.txt")).toBe("/a/notes.txt.pdf");
  });

  it("preserves subdirectory structure", () => {
    expect(siblingPdfPath("/a/b/c/deep.md")).toBe("/a/b/c/deep.pdf");
  });

  it("writes the buffer to the sibling URI and returns it", async () => {
    const { deps, spies } = makeDeps();
    const buf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
    const result = await writeNextToSource(buf, SAMPLE_URI, deps);
    expect(result.path).toBe("/repo/packages/vscode/examples/spec.pdf");
    expect(spies.writeFile).toHaveBeenCalledTimes(1);
    expect(spies.writeFile.mock.calls[0]?.[1]).toBe(buf);
  });

  it("NEVER calls showSaveDialog", () => {
    const deps = makeDeps().deps as unknown as Record<string, unknown>;
    expect("showSaveDialog" in deps).toBe(false);
  });

  it("overwrites an existing PDF without prompting (single writeFile call)", async () => {
    const { deps, spies } = makeDeps();
    await writeNextToSource(new Uint8Array([0x25]), SAMPLE_URI, deps);
    await writeNextToSource(new Uint8Array([0x25]), SAMPLE_URI, deps);
    expect(spies.writeFile).toHaveBeenCalledTimes(2);
    expect(spies.showInformationMessage).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Composer (top-level exportPdf)
// ---------------------------------------------------------------------------

describe("exportPdf composer", () => {
  beforeAll(async () => {
    await warmupSyncRender();
  });

  beforeEach(() => {
    mock.mockOutputChannel.appendLine.mockClear();
  });

  it("runs read → compose → print → save in order and notifies", async () => {
    const { deps, spies } = makeDeps();
    await exportPdf(SAMPLE_URI, { theme: "light" }, deps);
    expect(spies.readFile).toHaveBeenCalledTimes(1);
    expect(spies.createWebviewPanel).toHaveBeenCalledTimes(1);
    expect(spies.printToPDF).toHaveBeenCalledTimes(1);
    expect(spies.writeFile).toHaveBeenCalledTimes(1);
    const writtenUri = spies.writeFile.mock.calls[0]?.[0] as { path: string };
    expect(writtenUri.path).toBe("/repo/packages/vscode/examples/spec.pdf");
    const writtenBuf = spies.writeFile.mock.calls[0]?.[1] as Uint8Array;
    expect(new TextDecoder().decode(writtenBuf.slice(0, 5))).toBe(PDF_MAGIC);
    await new Promise((r) => setTimeout(r, 0));
    expect(spies.showInformationMessage).toHaveBeenCalledTimes(1);
  });

  it("logs every stage in order with scope=export-pdf", async () => {
    const { deps } = makeDeps();
    await exportPdf(SAMPLE_URI, { theme: "light" }, deps);
    const lines = mock.mockOutputChannel.appendLine.mock.calls.map((c) => c[0] as string);
    const scoped = lines.filter((l) => l.includes('"scope":"export-pdf"'));
    expect(scoped.length).toBeGreaterThanOrEqual(4);
    const findIdx = (needle: string): number => scoped.findIndex((l) => l.includes(needle));
    const invoked = findIdx("export-pdf invoked");
    const composed = findIdx("composed HTML");
    const rendered = findIdx("rendered PDF");
    const saved = findIdx("saved PDF");
    expect(invoked).toBeGreaterThanOrEqual(0);
    expect(composed).toBeGreaterThan(invoked);
    expect(rendered).toBeGreaterThan(composed);
    expect(saved).toBeGreaterThan(rendered);
  });

  it("surfaces errors via showErrorMessage and logs them", async () => {
    const { deps, spies } = makeDeps({ readFileThrows: new Error("boom") });
    await exportPdf(SAMPLE_URI, { theme: "light" }, deps);
    expect(spies.showErrorMessage).toHaveBeenCalledTimes(1);
    const msg = spies.showErrorMessage.mock.calls[0]?.[0] as string;
    expect(msg).toContain("boom");
    const lines = mock.mockOutputChannel.appendLine.mock.calls.map((c) => c[0] as string);
    expect(lines.some((l) => l.includes("export-pdf failed"))).toBe(true);
  });

  it("serialises concurrent invocations on the same URI (per-uri lock)", async () => {
    const { deps, spies } = makeDeps();
    const a = exportPdf(SAMPLE_URI, { theme: "light" }, deps);
    const b = exportPdf(SAMPLE_URI, { theme: "light" }, deps);
    await Promise.all([a, b]);
    expect(spies.writeFile).toHaveBeenCalledTimes(1);
    const lines = mock.mockOutputChannel.appendLine.mock.calls.map((c) => c[0] as string);
    expect(lines.some((l) => l.includes("export-pdf already in progress"))).toBe(true);
  });

  it("surfaces diagnostics and still writes a PDF when a fence fails to render", async () => {
    const { deps, spies } = makeDeps({
      readFileContent: "# hi\n\n```typediagram\ntype X { @bad }\n```\n",
    });
    await exportPdf(SAMPLE_URI, { theme: "light" }, deps);
    expect(spies.writeFile).toHaveBeenCalledTimes(1);
    const lines = mock.mockOutputChannel.appendLine.mock.calls.map((c) => c[0] as string);
    expect(
      lines.some((l) => l.includes("composed HTML") && l.includes('"diagnostics":') && !l.includes('"diagnostics":0'))
    ).toBe(true);
  });

  it("Open PDF action triggers openExternal on the saved URI", async () => {
    const { deps, spies } = makeDeps();
    spies.showInformationMessage.mockImplementationOnce(() => Promise.resolve("Open PDF"));
    await exportPdf(SAMPLE_URI, { theme: "light" }, deps);
    await new Promise((r) => setTimeout(r, 0));
    expect(spies.openExternal).toHaveBeenCalledTimes(1);
  });

  it("Reveal action triggers revealFileInOS command", async () => {
    const { deps, spies } = makeDeps();
    spies.showInformationMessage.mockImplementationOnce(() => Promise.resolve("Reveal in File Explorer"));
    await exportPdf(SAMPLE_URI, { theme: "light" }, deps);
    await new Promise((r) => setTimeout(r, 0));
    expect(spies.executeCommand).toHaveBeenCalledWith("revealFileInOS", expect.anything());
  });

  it("logs an error when the notification promise rejects", async () => {
    const { deps, spies } = makeDeps();
    spies.showInformationMessage.mockImplementationOnce(() => Promise.reject(new Error("notif boom")));
    await exportPdf(SAMPLE_URI, { theme: "light" }, deps);
    await new Promise((r) => setTimeout(r, 10));
    const lines = mock.mockOutputChannel.appendLine.mock.calls.map((c) => c[0] as string);
    expect(lines.some((l) => l.includes("notification failed"))).toBe(true);
  });
});
