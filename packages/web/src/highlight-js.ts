// [WEB-HIGHLIGHT-JS] Minimal regex-based JS highlighter for the hooks editor.
// Mirrors the pattern used by the typediagram highlighter: earlier rules win
// on overlapping matches. Returns HTML wrapped in <span class="hl-*">.
const escHtml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const RULES: ReadonlyArray<{ re: RegExp; cls: string; group?: number }> = [
  // block comments first (multi-line)
  { re: /\/\*[\s\S]*?\*\//g, cls: "hl-comment" },
  // line comments
  { re: /\/\/[^\n]*/g, cls: "hl-comment" },
  // strings & template literals (double, single, backtick)
  { re: /"(?:\\.|[^"\\\n])*"/g, cls: "hl-string" },
  { re: /'(?:\\.|[^'\\\n])*'/g, cls: "hl-string" },
  { re: /`(?:\\.|[^`\\])*`/g, cls: "hl-string" },
  // keywords
  {
    re: /\b(const|let|var|function|return|if|else|for|of|in|while|do|break|continue|switch|case|default|throw|try|catch|finally|new|typeof|instanceof|void|delete|this|true|false|null|undefined|async|await|yield|class|extends|super|import|export|from|as)\b/g,
    cls: "hl-keyword",
  },
  // numbers
  { re: /\b\d+(?:\.\d+)?\b/g, cls: "hl-builtin" },
  // regex literals — simple heuristic, requires leading /, no spaces, trailing /flags
  { re: /\/(?![\s/*])(?:\\.|\[[^\]\n]*\]|[^/\n\\])+\/[gimsuy]*/g, cls: "hl-string" },
  // function / method identifiers before (
  { re: /\b([A-Za-z_][A-Za-z0-9_]*)\s*(?=\()/g, cls: "hl-field", group: 1 },
  // property after . — basic
  { re: /\.([A-Za-z_][A-Za-z0-9_]*)\b/g, cls: "hl-field", group: 1 },
  // capitalized identifiers — treated as types/classes
  { re: /\b([A-Z][A-Za-z0-9_]*)\b/g, cls: "hl-type" },
  // punctuation
  { re: /[{}()[\];,.:?=<>+\-*/!&|^~%]/g, cls: "hl-punct" },
];

type Span = { start: number; end: number; cls: string };

export const highlightJs = (source: string): string => {
  const spans: Span[] = [];
  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rule.re.exec(source)) !== null) {
      const groupText = rule.group !== undefined ? m[rule.group] : undefined;
      const matchText = groupText ?? m[0];
      const offset = groupText !== undefined ? m.index + m[0].indexOf(matchText) : m.index;
      spans.push({ start: offset, end: offset + matchText.length, cls: rule.cls });
    }
  }
  // At equal start, longer span wins — comments/strings fully swallow any
  // single-char punctuation rules that would otherwise sort first and leak.
  spans.sort((a, b) => a.start - b.start || b.end - a.end);
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
  return out.endsWith("\n") ? `${out} ` : `${out}\n `;
};

export const initJsHighlight = (textarea: HTMLTextAreaElement, backdrop: HTMLElement) => {
  const code = backdrop.querySelector("code");
  if (code === null) {
    return;
  }
  const sync = () => {
    code.innerHTML = highlightJs(textarea.value);
    backdrop.scrollTop = textarea.scrollTop;
    backdrop.scrollLeft = textarea.scrollLeft;
  };
  textarea.addEventListener("input", sync);
  textarea.addEventListener("scroll", () => {
    backdrop.scrollTop = textarea.scrollTop;
    backdrop.scrollLeft = textarea.scrollLeft;
  });
  sync();
};
