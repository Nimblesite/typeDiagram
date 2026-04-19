// [WEB-CONV-HIGHLIGHT] Regex-based syntax highlighting for converter input languages.
// Returns HTML with <span class="hl-*"> tokens, reusing the same CSS classes
// as the typeDiagram highlighter so no extra CSS is needed.

const escHtml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

type Rule = { re: RegExp; cls: string; group?: number };

const TYPESCRIPT_RULES: readonly Rule[] = [
  { re: /\/\/.*$/gm, cls: "hl-comment" },
  { re: /\/\*[\s\S]*?\*\//gm, cls: "hl-comment" },
  { re: /\b(interface|type|enum|export|import|const|let|extends|implements|class|readonly)\b/g, cls: "hl-keyword" },
  { re: /\b(string|number|boolean|void|null|undefined|never|any|unknown|bigint)\b/g, cls: "hl-builtin" },
  { re: /\b([a-z_][A-Za-z0-9_]*)\s*(?=[?:])/g, cls: "hl-field", group: 1 },
  { re: /\b([A-Z][A-Za-z0-9_]*)\b/g, cls: "hl-type" },
  { re: /[<>{}:;,=|&?]/g, cls: "hl-punct" },
];

const RUST_RULES: readonly Rule[] = [
  { re: /\/\/.*$/gm, cls: "hl-comment" },
  { re: /\/\*[\s\S]*?\*\//gm, cls: "hl-comment" },
  { re: /\b(struct|enum|type|pub|fn|impl|trait|use|mod|crate|self|super|let|mut|const|where)\b/g, cls: "hl-keyword" },
  {
    re: /\b(bool|i8|i16|i32|i64|i128|u8|u16|u32|u64|u128|f32|f64|usize|isize|str|String|Vec|HashMap|Option|Result|Box)\b/g,
    cls: "hl-builtin",
  },
  { re: /\b([a-z_][A-Za-z0-9_]*)\s*(?=:)/g, cls: "hl-field", group: 1 },
  { re: /\b([A-Z][A-Za-z0-9_]*)\b/g, cls: "hl-type" },
  { re: /[<>{}:;,=|&]/g, cls: "hl-punct" },
];

const PYTHON_RULES: readonly Rule[] = [
  { re: /#.*$/gm, cls: "hl-comment" },
  { re: /"""[\s\S]*?"""/gm, cls: "hl-comment" },
  {
    re: /\b(class|def|from|import|return|pass|if|else|elif|with|as|raise|yield|lambda|async|await)\b/g,
    cls: "hl-keyword",
  },
  { re: /@\w+/g, cls: "hl-keyword" },
  {
    re: /\b(bool|int|float|str|list|dict|tuple|set|None|True|False|Optional|List|Dict|Tuple|Set|Union)\b/g,
    cls: "hl-builtin",
  },
  { re: /\b([a-z_][A-Za-z0-9_]*)\s*(?=:)/g, cls: "hl-field", group: 1 },
  { re: /\b([A-Z][A-Za-z0-9_]*)\b/g, cls: "hl-type" },
  { re: /[<>{}:;,=|()[\]]/g, cls: "hl-punct" },
];

const GO_RULES: readonly Rule[] = [
  { re: /\/\/.*$/gm, cls: "hl-comment" },
  { re: /\/\*[\s\S]*?\*\//gm, cls: "hl-comment" },
  {
    re: /\b(package|import|type|struct|interface|func|var|const|map|chan|go|defer|return|range|for|if|else|switch|case)\b/g,
    cls: "hl-keyword",
  },
  {
    re: /\b(bool|int|int8|int16|int32|int64|uint|uint8|uint16|uint32|uint64|float32|float64|string|byte|rune|error|any)\b/g,
    cls: "hl-builtin",
  },
  { re: /\b([A-Z][A-Za-z0-9_]*)\s+/g, cls: "hl-field", group: 1 },
  { re: /\b([A-Z][A-Za-z0-9_]*)\b/g, cls: "hl-type" },
  { re: /[<>{}:;,=|*&[\]]/g, cls: "hl-punct" },
];

const CSHARP_RULES: readonly Rule[] = [
  { re: /\/\/.*$/gm, cls: "hl-comment" },
  { re: /\/\*[\s\S]*?\*\//gm, cls: "hl-comment" },
  {
    re: /\b(class|record|struct|enum|interface|public|private|protected|internal|static|readonly|sealed|abstract|virtual|override|new|namespace|using|get|set|init)\b/g,
    cls: "hl-keyword",
  },
  { re: /\b(bool|int|long|float|double|decimal|string|char|byte|void|object|dynamic|var)\b/g, cls: "hl-builtin" },
  { re: /\b([A-Z][A-Za-z0-9_]*)\b/g, cls: "hl-type" },
  { re: /[<>{}:;,=|?()[\]]/g, cls: "hl-punct" },
];

const FSHARP_RULES: readonly Rule[] = [
  { re: /\/\/.*$/gm, cls: "hl-comment" },
  { re: /\(\*[\s\S]*?\*\)/gm, cls: "hl-comment" },
  {
    re: /\b(type|let|mutable|module|open|of|match|with|and|rec|if|then|else|member|static|abstract|override|interface|inherit)\b/g,
    cls: "hl-keyword",
  },
  {
    re: /\b(bool|int|int64|float|double|decimal|string|unit|byte|char|option|list|seq|Map|Set|Result)\b/g,
    cls: "hl-builtin",
  },
  { re: /\b([a-z_][A-Za-z0-9_]*)\s*(?=:)/g, cls: "hl-field", group: 1 },
  { re: /\b([A-Z][A-Za-z0-9_]*)\b/g, cls: "hl-type" },
  { re: /[<>{}:;,=|*()[\]]/g, cls: "hl-punct" },
];

const DART_RULES: readonly Rule[] = [
  { re: /\/\/.*$/gm, cls: "hl-comment" },
  { re: /\/\*[\s\S]*?\*\//gm, cls: "hl-comment" },
  {
    re: /\b(class|sealed|final|abstract|extends|implements|with|enum|typedef|const|late|static|var|void|new|factory|this|super|return|if|else|switch|case|default|import|library|part|of)\b/g,
    cls: "hl-keyword",
  },
  {
    re: /\b(bool|int|double|num|String|List|Map|Set|Object|dynamic|Null|Never)\b/g,
    cls: "hl-builtin",
  },
  { re: /\b([a-z_][A-Za-z0-9_]*)\s*(?=;)/g, cls: "hl-field", group: 1 },
  { re: /\b([A-Z][A-Za-z0-9_]*)\b/g, cls: "hl-type" },
  { re: /[<>{}:;,=|?()[\]]/g, cls: "hl-punct" },
];

const PROTOBUF_RULES: readonly Rule[] = [
  { re: /\/\/.*$/gm, cls: "hl-comment" },
  { re: /\/\*[\s\S]*?\*\//gm, cls: "hl-comment" },
  {
    re: /\b(syntax|message|enum|oneof|service|rpc|returns|package|import|option|reserved|repeated|optional|required|map|group)\b/g,
    cls: "hl-keyword",
  },
  {
    re: /\b(bool|int32|int64|uint32|uint64|sint32|sint64|fixed32|fixed64|sfixed32|sfixed64|float|double|string|bytes)\b/g,
    cls: "hl-builtin",
  },
  { re: /\b([a-z_][A-Za-z0-9_]*)\s*=\s*\d+/g, cls: "hl-field", group: 1 },
  { re: /\b([A-Z][A-Za-z0-9_]*)\b/g, cls: "hl-type" },
  { re: /[<>{}:;,=()[\]]/g, cls: "hl-punct" },
];

type SupportedLang = "typescript" | "rust" | "python" | "go" | "csharp" | "fsharp" | "dart" | "protobuf";

const LANG_RULES: Record<SupportedLang, readonly Rule[]> = {
  typescript: TYPESCRIPT_RULES,
  rust: RUST_RULES,
  python: PYTHON_RULES,
  go: GO_RULES,
  csharp: CSHARP_RULES,
  fsharp: FSHARP_RULES,
  dart: DART_RULES,
  protobuf: PROTOBUF_RULES,
};

type Span = { start: number; end: number; cls: string };

export const highlightLang = (source: string, lang: SupportedLang): string => {
  const rules = LANG_RULES[lang];
  const spans: Span[] = [];

  for (const rule of rules) {
    rule.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rule.re.exec(source)) !== null) {
      const groupText = rule.group !== undefined ? m[rule.group] : undefined;
      const matchText = groupText ?? m[0];
      const offset = groupText !== undefined ? m.index + m[0].indexOf(matchText) : m.index;
      spans.push({ start: offset, end: offset + matchText.length, cls: rule.cls });
    }
  }

  spans.sort((a, b) => a.start - b.start || a.end - b.end);
  const kept: Span[] = [];
  let cursor = 0;
  for (const s of spans) {
    if (s.start >= cursor) {
      kept.push(s);
      cursor = s.end;
    }
  }

  let out = "";
  let pos = 0;
  for (const s of kept) {
    out += s.start > pos ? escHtml(source.slice(pos, s.start)) : "";
    out += `<span class="${s.cls}">${escHtml(source.slice(s.start, s.end))}</span>`;
    pos = s.end;
  }
  out += pos < source.length ? escHtml(source.slice(pos)) : "";

  return out.endsWith("\n") ? out + " " : out + "\n ";
};

export const initLangHighlight = (
  textarea: HTMLTextAreaElement,
  backdrop: HTMLElement,
  getLang: () => SupportedLang
) => {
  const code = backdrop.querySelector("code");
  if (!code) {
    return;
  }

  const sync = () => {
    code.innerHTML = highlightLang(textarea.value, getLang());
    backdrop.scrollTop = textarea.scrollTop;
    backdrop.scrollLeft = textarea.scrollLeft;
  };

  textarea.addEventListener("input", sync);
  textarea.addEventListener("scroll", () => {
    backdrop.scrollTop = textarea.scrollTop;
    backdrop.scrollLeft = textarea.scrollLeft;
  });

  return sync;
};
