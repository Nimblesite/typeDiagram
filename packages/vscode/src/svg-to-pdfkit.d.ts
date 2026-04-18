// Upstream `svg-to-pdfkit` ships no types. Minimal declaration matching our usage.
declare module "svg-to-pdfkit" {
  interface SVGtoPDFOptions {
    width?: number;
    height?: number;
    preserveAspectRatio?: string;
    useCSS?: boolean;
    fontCallback?: (family: string, bold: boolean, italic: boolean) => string;
    imageCallback?: (link: string) => string;
    colorCallback?: (color: [number, number, number, number] | null, opacity: number) => [number[], number];
    warningCallback?: (msg: string) => void;
    assumePt?: boolean;
    precision?: number;
  }
  export default function SVGtoPDF(
    doc: PDFKit.PDFDocument,
    svg: string,
    x?: number,
    y?: number,
    options?: SVGtoPDFOptions
  ): PDFKit.PDFDocument;
}
