// [WEB-CONV-RENDER-TEST] Tests for the converter render pipeline.
import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock typediagram for unit isolation
const mockFromSource = vi.fn();
const mockToSource = vi.fn();
const mockPrintSource = vi.fn();
const mockRenderToString = vi.fn();
const mockFormatDiagnostics = vi.fn();
const mockParse = vi.fn();
const mockBuildModel = vi.fn();
const mockValidateForCodegen = vi.fn();

vi.mock("typediagram-core", () => ({
  converters: {
    typescript: { fromSource: mockFromSource, toSource: mockToSource, language: "typescript" },
    python: { fromSource: mockFromSource, toSource: mockToSource, language: "python" },
    rust: { fromSource: mockFromSource, toSource: mockToSource, language: "rust" },
    go: { fromSource: mockFromSource, toSource: mockToSource, language: "go" },
    csharp: { fromSource: mockFromSource, toSource: mockToSource, language: "csharp" },
    fsharp: { fromSource: mockFromSource, toSource: mockToSource, language: "fsharp" },
  },
  model: { printSource: mockPrintSource, buildModel: mockBuildModel, validateForCodegen: mockValidateForCodegen },
  renderToString: mockRenderToString,
  parser: { formatDiagnostics: mockFormatDiagnostics, parse: mockParse },
}));

import { convertSource, convertFromTd } from "../src/converter-render.js";

const mockSourceModel = (tdSource: string) => {
  const model = { decls: [], edges: [], externals: [] };
  mockFromSource.mockReturnValue({ ok: true, value: model });
  mockPrintSource.mockReturnValue(tdSource);
};

const mockTdModel = () => {
  mockParse.mockReturnValue({ ok: true, value: { decls: [] } });
  mockBuildModel.mockReturnValue({ ok: true, value: { decls: [], edges: [], externals: [] } });
};

describe("[WEB-CONV-RENDER] convertSource()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: dark theme
    Object.defineProperty(window, "matchMedia", {
      value: vi.fn().mockReturnValue({ matches: true }),
      writable: true,
    });
  });

  it("returns tdSource and svgHtml on success", async () => {
    const fakeModel = { decls: [], edges: [], externals: [] };
    mockFromSource.mockReturnValue({ ok: true, value: fakeModel });
    mockPrintSource.mockReturnValue("typeDiagram\n\ntype Foo {\n  x: Int\n}\n");
    mockRenderToString.mockResolvedValue({ ok: true, value: "<svg>diagram</svg>" });

    const result = await convertSource("interface Foo { x: number }", "typescript");

    expect(result.tdSource).toContain("typeDiagram");
    expect(result.svgHtml).toBe("<svg>diagram</svg>");
  });

  it("returns diagnostics HTML when converter fails", async () => {
    mockFromSource.mockReturnValue({ ok: false, error: [{ message: "parse error" }] });
    mockFormatDiagnostics.mockReturnValue("Error: parse error");

    const result = await convertSource("bad input", "typescript");

    expect(result.tdSource).toBe("");
    expect(result.svgHtml).toContain("diag");
    expect(result.svgHtml).toContain("parse error");
  });

  it("returns diagnostics HTML when render fails", async () => {
    mockSourceModel("typeDiagram\n");
    mockRenderToString.mockResolvedValue({ ok: false, error: [{ message: "render error" }] });
    mockFormatDiagnostics.mockReturnValue("Error: render error");

    const result = await convertSource("struct Foo {}", "rust");

    expect(result.tdSource).toContain("typeDiagram");
    expect(result.svgHtml).toContain("render error");
  });

  it("passes dark theme when prefers-color-scheme is dark", async () => {
    mockSourceModel("typeDiagram\n");
    mockRenderToString.mockResolvedValue({ ok: true, value: "<svg/>" });

    await convertSource("x", "typescript");

    expect(mockRenderToString).toHaveBeenCalledWith("typeDiagram\n", { theme: "dark" });
  });

  it("passes light theme when prefers-color-scheme is light", async () => {
    Object.defineProperty(window, "matchMedia", {
      value: vi.fn().mockReturnValue({ matches: false }),
      writable: true,
    });

    mockSourceModel("typeDiagram\n");
    mockRenderToString.mockResolvedValue({ ok: true, value: "<svg/>" });

    await convertSource("x", "go");

    expect(mockRenderToString).toHaveBeenCalledWith("typeDiagram\n", { theme: "light" });
  });

  it("escapes HTML in diagnostics", async () => {
    mockFromSource.mockReturnValue({ ok: false, error: [{ message: "<script>alert('xss')</script>" }] });
    mockFormatDiagnostics.mockReturnValue("<script>alert('xss')</script>");

    const result = await convertSource("bad", "typescript");

    expect(result.svgHtml).toContain("&lt;script&gt;");
    expect(result.svgHtml).not.toContain("<script>");
  });
});

describe("[WEB-CONV-RENDER] convertFromTd()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockValidateForCodegen.mockReturnValue([]);
    Object.defineProperty(window, "matchMedia", {
      value: vi.fn().mockReturnValue({ matches: true }),
      writable: true,
    });
  });

  it("returns diagnostics when codegen validation finds unknown types", async () => {
    mockParse.mockReturnValue({ ok: true, value: { decls: [] } });
    mockBuildModel.mockReturnValue({ ok: true, value: { decls: [], edges: [], externals: ["Timestamp"] } });
    mockValidateForCodegen.mockReturnValue([{ message: "unknown type 'Timestamp'" }]);
    mockFormatDiagnostics.mockReturnValue("Error: unknown type 'Timestamp'");

    const result = await convertFromTd("typeDiagram\n", "python");

    expect(result.tdSource).toBe("");
    expect(result.svgHtml).toContain("unknown type 'Timestamp'");
    expect(mockToSource).not.toHaveBeenCalled();
  });

  it("returns language source and SVG on success", async () => {
    mockTdModel();
    mockToSource.mockReturnValue("export interface Foo {\n  x: number;\n}\n");
    mockRenderToString.mockResolvedValue({ ok: true, value: "<svg>diagram</svg>" });

    const result = await convertFromTd("typeDiagram\n\ntype Foo {\n  x: Int\n}\n", "typescript");

    expect(result.tdSource).toContain("interface Foo");
    expect(result.svgHtml).toBe("<svg>diagram</svg>");
  });

  it("returns diagnostics when parse fails", async () => {
    mockParse.mockReturnValue({ ok: false, error: [{ message: "parse error" }] });
    mockFormatDiagnostics.mockReturnValue("Error: parse error");

    const result = await convertFromTd("bad input", "typescript");

    expect(result.tdSource).toBe("");
    expect(result.svgHtml).toContain("parse error");
  });

  it("returns diagnostics when model build fails", async () => {
    mockParse.mockReturnValue({ ok: true, value: { decls: [] } });
    mockBuildModel.mockReturnValue({ ok: false, error: [{ message: "model error" }] });
    mockFormatDiagnostics.mockReturnValue("Error: model error");

    const result = await convertFromTd("typeDiagram\n", "rust");

    expect(result.tdSource).toBe("");
    expect(result.svgHtml).toContain("model error");
  });

  it("returns language source even when SVG render fails", async () => {
    mockTdModel();
    mockToSource.mockReturnValue("pub struct Foo {}");
    mockRenderToString.mockResolvedValue({ ok: false, error: [{ message: "render error" }] });
    mockFormatDiagnostics.mockReturnValue("Error: render error");

    const result = await convertFromTd("typeDiagram\n", "rust");

    expect(result.tdSource).toBe("pub struct Foo {}");
    expect(result.svgHtml).toContain("render error");
  });
});
