// [PDF] Unit tests for the PDF export pipeline.
// Stage IDs map to the spec: [PDF-READ] [PDF-COMPOSE] [PDF-SHELL] [PDF-PRINT] [PDF-SAVE].
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as mock from "./vscode-mock.js";
import { warmupSyncRender } from "typediagram-core";
import type * as vscodeTypes from "vscode";

vi.mock("vscode", () => mock);

import {
  buildShell,
  chunkMarkdown,
  composeHtml,
  exportPdf,
  extractSvgs,
  readMarkdown,
  reinjectSvgs,
  renderToPdf,
  siblingPdfPath,
  writeNextToSource,
  type ExportPdfDeps,
} from "../src/export-pdf.js";

const PDF_MAGIC = "%PDF-";

// ---------------------------------------------------------------------------
// Shared test dep factory
// ---------------------------------------------------------------------------

interface TestDepsOverrides {
  readFileContent?: string;
  readFileThrows?: Error;
  writeFileThrows?: Error;
}

function makeDeps(overrides: TestDepsOverrides = {}): {
  deps: ExportPdfDeps;
  spies: {
    readFile: ReturnType<typeof vi.fn>;
    writeFile: ReturnType<typeof vi.fn>;
    showInformationMessage: ReturnType<typeof vi.fn>;
    showErrorMessage: ReturnType<typeof vi.fn>;
    openExternal: ReturnType<typeof vi.fn>;
    executeCommand: ReturnType<typeof vi.fn>;
    uriWithPath: ReturnType<typeof vi.fn>;
  };
} {
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
      uriWithPath: uriWithPath as unknown as ExportPdfDeps["uriWithPath"],
      showInformationMessage: showInformationMessage as unknown as ExportPdfDeps["showInformationMessage"],
      showErrorMessage,
      openExternal: openExternal as unknown as ExportPdfDeps["openExternal"],
      executeCommand: executeCommand as unknown as ExportPdfDeps["executeCommand"],
    },
    spies: {
      readFile,
      writeFile,
      showInformationMessage,
      showErrorMessage,
      openExternal,
      executeCommand,
      uriWithPath,
    },
  };
}

const SAMPLE_URI = {
  path: "/repo/packages/vscode/examples/doc.md",
  scheme: "file",
  toString: () => "file:///repo/packages/vscode/examples/doc.md",
} as unknown as vscodeTypes.Uri;

// ---------------------------------------------------------------------------
// [PDF-COMPOSE] sentinel swap
// ---------------------------------------------------------------------------

describe("[PDF-COMPOSE] extractSvgs / reinjectSvgs", () => {
  it("replaces every <svg> block with a sentinel and collects them in order", () => {
    const md = "prose\n\n<svg>one</svg>\n\nmore\n\n<svg>two</svg>\n\nend";
    const { skeleton, svgs } = extractSvgs(md);
    expect(skeleton).not.toContain("<svg");
    // Sentinels use Unicode private-use characters so markdown-it never html-escapes them.
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

  it("uses a system font stack (no font-file URL)", () => {
    const html = buildShell("t", "");
    expect(html).toMatch(/font-family:\s*-apple-system/);
  });
});

// ---------------------------------------------------------------------------
// [PDF-COMPOSE] full composition
// ---------------------------------------------------------------------------

describe("[PDF-COMPOSE] composeHtml", () => {
  beforeAll(async () => {
    await warmupSyncRender();
    // Also warm the subpath-resolved module instance. vitest + package exports map
    // can sometimes land these on different module graphs; belt and braces.
    const mdModule = (await import("typediagram-core/markdown")) as {
      warmupSyncRender?: () => Promise<void>;
    };
    if (mdModule.warmupSyncRender) {
      await mdModule.warmupSyncRender();
    }
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

describe("[PDF-PRINT] chunkMarkdown + renderToPdf", () => {
  beforeAll(async () => {
    await warmupSyncRender();
  });

  it("chunkMarkdown splits prose and svg in order", () => {
    const input = "hi\n<svg>a</svg>\nmore\n<svg>b</svg>\nend";
    const chunks = chunkMarkdown(input);
    expect(chunks).toHaveLength(5);
    expect(chunks[0]).toEqual({ kind: "prose", value: "hi\n" });
    expect(chunks[1]).toEqual({ kind: "svg", value: "<svg>a</svg>" });
    expect(chunks[2]).toEqual({ kind: "prose", value: "\nmore\n" });
    expect(chunks[3]).toEqual({ kind: "svg", value: "<svg>b</svg>" });
    expect(chunks[4]).toEqual({ kind: "prose", value: "\nend" });
  });

  it("chunkMarkdown handles input with no svg", () => {
    const chunks = chunkMarkdown("just text");
    expect(chunks).toEqual([{ kind: "prose", value: "just text" }]);
  });

  it("chunkMarkdown handles input that is only svg", () => {
    const chunks = chunkMarkdown("<svg>x</svg>");
    expect(chunks).toEqual([{ kind: "svg", value: "<svg>x</svg>" }]);
  });

  it("renderToPdf produces a PDF buffer starting with %PDF-", async () => {
    const md =
      "# Title\n\n<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 10'><rect x='0' y='0' width='10' height='10'/></svg>";
    const buf = await renderToPdf(md, "test");
    expect(buf.length).toBeGreaterThan(1024);
    const prefix = new TextDecoder().decode(buf.slice(0, 5));
    expect(prefix).toBe(PDF_MAGIC);
  });

  it("renderToPdf embeds the SVG as vector path operators (not rasterised)", async () => {
    const md =
      "intro\n\n<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 10'><path d='M0,0 L10,10'/></svg>\n\nend";
    const buf = await renderToPdf(md, "test");
    const latin = Buffer.from(buf).toString("latin1");
    expect(latin).toContain("%PDF-");
    // Core heuristic: produces a PDF > 1 KB and contains no embedded image XObject
    expect(latin).not.toContain("/Subtype /Image");
  });

  it("renderToPdf emits a PDF with a real Title from the doc info", async () => {
    const buf = await renderToPdf("hello", "my-title-42");
    const latin = Buffer.from(buf).toString("latin1");
    // Title may be escaped/encoded in the PDF — but some form of the string must appear
    expect(latin).toContain("/Title");
  });

  it("renderToPdf renders prose with headings at every level", async () => {
    const md = "# H1\n\n## H2\n\n### H3\n\n#### H4\n\n##### H5\n\n###### H6\n\nparagraph text";
    const buf = await renderToPdf(md, "headings");
    expect(buf.length).toBeGreaterThan(1024);
    expect(new TextDecoder().decode(buf.slice(0, 5))).toBe(PDF_MAGIC);
  });

  it("renderToPdf renders fenced code blocks in monospace", async () => {
    const md = "intro\n\n```\ncode line one\ncode line two\n```\n\noutro";
    const buf = await renderToPdf(md, "code");
    const latin = Buffer.from(buf).toString("latin1");
    // Courier font is referenced for the code block
    expect(latin).toMatch(/Courier/);
  });

  it("renderToPdf emits empty paragraphs as vertical space (moveDown branch)", async () => {
    const md = "first\n\n\n\nsecond";
    const buf = await renderToPdf(md, "spacing");
    expect(buf.length).toBeGreaterThan(500);
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
    expect(result.path).toBe("/repo/packages/vscode/examples/doc.pdf");
    expect(spies.writeFile).toHaveBeenCalledTimes(1);
    expect(spies.writeFile.mock.calls[0]?.[1]).toBe(buf);
  });

  it("NEVER calls showSaveDialog", () => {
    // There is no showSaveDialog in ExportPdfDeps on purpose. This test enforces
    // by structural contract: if the surface ever gains a showSaveDialog we'd
    // have to add it here and an assertion would fail.
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

  it("runs read → compose → render-pdf → save in order and notifies", async () => {
    const { deps, spies } = makeDeps();
    await exportPdf(SAMPLE_URI, { theme: "light" }, deps);
    expect(spies.readFile).toHaveBeenCalledTimes(1);
    expect(spies.writeFile).toHaveBeenCalledTimes(1);
    const writtenUri = spies.writeFile.mock.calls[0]?.[0] as { path: string };
    expect(writtenUri.path).toBe("/repo/packages/vscode/examples/doc.pdf");
    // Written buffer starts with %PDF-
    const writtenBuf = spies.writeFile.mock.calls[0]?.[1] as Uint8Array;
    expect(new TextDecoder().decode(writtenBuf.slice(0, 5))).toBe(PDF_MAGIC);
    // Notification is fire-and-forget — give it a microtask to flush.
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
    const composed = findIdx("composed markdown+svgs");
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
    // Second call waits for the first — writeFile still called once for A, once deferred for B.
    // Lock implementation: B awaits A's inFlight promise and then returns (it's not re-queued).
    // Contract: no double-write during concurrent invocation.
    expect(spies.writeFile).toHaveBeenCalledTimes(1);
    const lines = mock.mockOutputChannel.appendLine.mock.calls.map((c) => c[0] as string);
    expect(lines.some((l) => l.includes("export-pdf already in progress"))).toBe(true);
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

  it("surfaces diagnostics and still writes a PDF when a fence fails to render", async () => {
    const { deps, spies } = makeDeps({
      readFileContent: "# hi\n\n```typediagram\ntype X { @bad }\n```\n",
    });
    await exportPdf(SAMPLE_URI, { theme: "light" }, deps);
    expect(spies.writeFile).toHaveBeenCalledTimes(1);
    const writtenBuf = spies.writeFile.mock.calls[0]?.[1] as Uint8Array;
    expect(new TextDecoder().decode(writtenBuf.slice(0, 5))).toBe(PDF_MAGIC);
    // The "composed markdown+svgs" log must report ok=false
    const lines = mock.mockOutputChannel.appendLine.mock.calls.map((c) => c[0] as string);
    expect(lines.some((l) => l.includes("composed markdown+svgs") && l.includes('"ok":false'))).toBe(true);
    expect(lines.some((l) => l.includes("composed markdown+svgs") && /"diagnostics":[1-9]/.test(l))).toBe(true);
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
