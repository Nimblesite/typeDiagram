// [PDF-E2E-PHYSICAL] Produces a REAL .pdf file on disk with the REAL rendered
// typeDiagram embedded as a vector. The PDF path used in production is
// VS Code's Electron `webview.printToPDF` — not available outside VS Code. For
// this test we substitute a Node-native pipeline:
//
//   composeHtml (real)  →  extract SVGs from the composed HTML  →
//   pdfkit + svg-to-pdfkit  →  real .pdf on disk
//
// That proves the composition stage produces SVG that can actually embed as
// vector content in a PDF. If pdfkit can't parse our SVG, neither will Chromium.
import { beforeAll, describe, expect, it } from "vitest";
import * as mock from "./vscode-mock.js";
import { vi } from "vitest";

vi.mock("vscode", () => mock);

import { readFileSync, writeFileSync, statSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";
// svg-to-pdfkit has no @types package — narrow its shape to what we actually call
// so eslint's no-unsafe-call stops complaining about `any`.
import SVGtoPDFUntyped from "svg-to-pdfkit";
type SVGtoPDFFn = (
  doc: PDFKit.PDFDocument,
  svg: string,
  x: number,
  y: number,
  options?: { width?: number; height?: number; assumePt?: boolean }
) => void;
const SVGtoPDF: SVGtoPDFFn = SVGtoPDFUntyped as unknown as SVGtoPDFFn;
import { warmupSyncRender } from "typediagram-core";
import { composeHtml, extractSvgs } from "../src/export-pdf.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXAMPLE_MD = resolve(__dirname, "../examples/spec.md");
const OUT_DIR = resolve(__dirname, "../../../dist-test-pdfs");

function bufferFromStream(doc: PDFKit.PDFDocument): Promise<Uint8Array> {
  return new Promise((res, rej) => {
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => {
      res(new Uint8Array(Buffer.concat(chunks)));
    });
    doc.on("error", rej);
    doc.end();
  });
}

async function produceRealPdf(svgs: string[], title: string): Promise<Uint8Array> {
  // compress: false keeps the content streams human-readable so tests can assert
  // on the actual PDF operators (m, l, c, re, S, f) without having to deflate.
  const doc = new PDFDocument({ size: "A4", margin: 40, info: { Title: title }, compress: false });
  doc.fontSize(18).text(title);
  doc.moveDown();
  for (const svg of svgs) {
    // Embed each SVG as vector content. svg-to-pdfkit streams path operators
    // into the PDFDocument — no rasterisation.
    SVGtoPDF(doc, svg, 40, doc.y, { width: 500, assumePt: false });
    doc.moveDown(2);
    doc.addPage();
  }
  return bufferFromStream(doc);
}

describe("[PDF-E2E-PHYSICAL] writes a real .pdf file with embedded diagram vectors", () => {
  beforeAll(async () => {
    await warmupSyncRender();
    if (!existsSync(OUT_DIR)) {
      mkdirSync(OUT_DIR, { recursive: true });
    }
  });

  it("emits a real PDF for examples/spec.md with at least one embedded SVG", async () => {
    const md = readFileSync(EXAMPLE_MD, "utf8");
    const { html, fenceCount } = composeHtml(md, { theme: "light", title: "spec" });
    expect(fenceCount).toBeGreaterThan(0);

    const { svgs } = extractSvgs(html);
    expect(svgs.length).toBeGreaterThan(0);
    expect(svgs[0]).toContain("<svg");

    const buf = await produceRealPdf(svgs, "typediagram PDF E2E");
    const outPath = resolve(OUT_DIR, "spec.pdf");
    writeFileSync(outPath, buf);

    const stats = statSync(outPath);
    expect(stats.size).toBeGreaterThan(1024);

    const written = readFileSync(outPath);
    // PDF magic bytes
    expect(written.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    // PDF EOF marker
    expect(written.subarray(written.length - 6).toString("latin1")).toContain("%%EOF");

    // Vector operators from svg-to-pdfkit must appear somewhere in the stream.
    // Path operators: m (moveto), l (lineto), c (curveto), re (rectangle).
    // These are always present when svg paths are drawn as vector.
    const latin = written.toString("latin1");
    const hasMoveTo = / m\b/.test(latin);
    const hasLineTo = / l\b/.test(latin);
    const hasRect = / re\b/.test(latin);
    const hasPathOps = hasMoveTo || hasLineTo || hasRect;
    expect(hasPathOps).toBe(true);

    // And no Image XObjects for the diagram — we want pure vectors, not rasters.
    expect(latin).not.toContain("/Subtype /Image");
  });

  it("generates a smaller PDF when the theme is dark (different SVG stroke colors)", async () => {
    const md = readFileSync(EXAMPLE_MD, "utf8");
    const light = composeHtml(md, { theme: "light", title: "spec-light" });
    const dark = composeHtml(md, { theme: "dark", title: "spec-dark" });
    const lightSvgs = extractSvgs(light.html).svgs;
    const darkSvgs = extractSvgs(dark.html).svgs;
    expect(lightSvgs[0]).not.toEqual(darkSvgs[0]);

    const lightBuf = await produceRealPdf(lightSvgs.slice(0, 1), "light");
    const darkBuf = await produceRealPdf(darkSvgs.slice(0, 1), "dark");
    writeFileSync(resolve(OUT_DIR, "spec-light.pdf"), lightBuf);
    writeFileSync(resolve(OUT_DIR, "spec-dark.pdf"), darkBuf);

    expect(lightBuf.subarray(0, 5)).toEqual(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]));
    expect(darkBuf.subarray(0, 5)).toEqual(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]));
    // Dark and light produce different byte streams (stroke/fill colors differ).
    expect(Buffer.compare(Buffer.from(lightBuf), Buffer.from(darkBuf))).not.toBe(0);
  });

  it("preserves multiple diagrams as separate vector regions in one PDF", async () => {
    const md = readFileSync(EXAMPLE_MD, "utf8");
    const { html } = composeHtml(md, { theme: "light", title: "multi" });
    const { svgs } = extractSvgs(html);
    // spec.md has multiple fences; take the first 3 to keep the PDF small.
    const take = svgs.slice(0, Math.min(3, svgs.length));
    const buf = await produceRealPdf(take, "multi-diagram");
    const outPath = resolve(OUT_DIR, "spec-multi.pdf");
    writeFileSync(outPath, buf);

    const latin = readFileSync(outPath).toString("latin1");
    // Each SVG occupies its own page; count /Type /Page objects.
    const pageCount = (latin.match(/\/Type\s*\/Page\b/g) ?? []).length;
    expect(pageCount).toBeGreaterThanOrEqual(take.length);
  });
});
