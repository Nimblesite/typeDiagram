// [WEB-CONV-RENDER] Pipeline: language source ↔ typeDiagram source + SVG.
// Lazy-loads the typediagram module like render-pane.ts.

export type SupportedLang = "typescript" | "python" | "rust" | "go" | "csharp" | "fsharp" | "dart" | "protobuf" | "php";

const getTheme = () =>
  window.matchMedia("(prefers-color-scheme: dark)").matches ? ("dark" as const) : ("light" as const);

export type ConvertResult = {
  tdSource: string;
  svgHtml: string;
};

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Language source → typeDiagram + SVG */
export const convertSource = async (source: string, lang: SupportedLang): Promise<ConvertResult> => {
  const { converters, model: modelLayer, renderToString, parser } = await import("typediagram-core");

  const converterMap = {
    typescript: converters.typescript,
    python: converters.python,
    rust: converters.rust,
    go: converters.go,
    csharp: converters.csharp,
    fsharp: converters.fsharp,
    dart: converters.dart,
    protobuf: converters.protobuf,
    php: converters.php,
  } as const;

  const conv = converterMap[lang];
  const modelResult = conv.fromSource(source);

  if (!modelResult.ok) {
    const text = parser.formatDiagnostics([...modelResult.error]);
    return { tdSource: "", svgHtml: `<pre class="diag">${escapeHtml(text)}</pre>` };
  }

  const tdSource = modelLayer.printSource(modelResult.value);
  const svgResult = await renderToString(tdSource, { theme: getTheme() });

  if (!svgResult.ok) {
    const text = parser.formatDiagnostics([...svgResult.error]);
    return { tdSource, svgHtml: `<pre class="diag">${escapeHtml(text)}</pre>` };
  }

  return { tdSource, svgHtml: svgResult.value };
};

/** typeDiagram source → language source + SVG */
export const convertFromTd = async (tdSource: string, lang: SupportedLang): Promise<ConvertResult> => {
  const { converters, parser, model: modelLayer, renderToString } = await import("typediagram-core");

  const converterMap = {
    typescript: converters.typescript,
    python: converters.python,
    rust: converters.rust,
    go: converters.go,
    csharp: converters.csharp,
    fsharp: converters.fsharp,
    dart: converters.dart,
    protobuf: converters.protobuf,
    php: converters.php,
  } as const;

  const parsed = parser.parse(tdSource);
  if (!parsed.ok) {
    const text = parser.formatDiagnostics([...parsed.error]);
    return { tdSource: "", svgHtml: `<pre class="diag">${escapeHtml(text)}</pre>` };
  }

  const modelResult = modelLayer.buildModel(parsed.value);
  if (!modelResult.ok) {
    const text = parser.formatDiagnostics([...modelResult.error]);
    return { tdSource: "", svgHtml: `<pre class="diag">${escapeHtml(text)}</pre>` };
  }

  // [MODEL-CODEGEN-UNKNOWN] unknown type names block codegen (GH issue #38).
  const codegenDiags = modelLayer.validateForCodegen(modelResult.value, lang);
  if (codegenDiags.length > 0) {
    const text = parser.formatDiagnostics([...codegenDiags]);
    return { tdSource: "", svgHtml: `<pre class="diag">${escapeHtml(text)}</pre>` };
  }

  const langSource = converterMap[lang].toSource(modelResult.value);
  const svgResult = await renderToString(tdSource, { theme: getTheme() });

  if (!svgResult.ok) {
    const text = parser.formatDiagnostics([...svgResult.error]);
    return { tdSource: langSource, svgHtml: `<pre class="diag">${escapeHtml(text)}</pre>` };
  }

  return { tdSource: langSource, svgHtml: svgResult.value };
};
