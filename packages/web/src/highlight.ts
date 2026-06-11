// [WEB-HIGHLIGHT] Regex-based syntax highlighter for typeDiagram.
// Mirrors the TextMate grammar scopes from packages/vscode/syntaxes/typediagram.tmLanguage.json.
// Returns HTML with <span class="hl-*"> wrapping tokens.

const escHtml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Order matters: earlier rules win on overlapping matches.
const RULES: ReadonlyArray<{ re: RegExp; cls: string; group?: number }> = [
  { re: /#.*$/gm, cls: "hl-comment" },
  { re: /\b(type|union|alias|typeDiagram)\b/g, cls: "hl-keyword" },
  { re: /\b(Bool|Int|Float|String|Bytes|Unit|DateTime|Uuid|Decimal|List|Map|Option)\b/g, cls: "hl-builtin" },
  { re: /\b([a-z_][A-Za-z0-9_]*)\s*(?=:)/g, cls: "hl-field", group: 1 },
  { re: /\b([A-Z][A-Za-z0-9_]*)\b/g, cls: "hl-type" },
  { re: /[<>{}:,=]/g, cls: "hl-punct" },
];

type Span = { start: number; end: number; cls: string };

/** Highlight typeDiagram source, returning HTML with span.hl-* tokens. */
export const highlight = (source: string): string => {
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

  // Sort by start position; remove overlapping spans (earlier rule wins).
  spans.sort((a, b) => a.start - b.start || a.end - b.end);
  const kept: Span[] = [];
  let cursor = 0;
  for (const s of spans) {
    if (s.start >= cursor) {
      kept.push(s);
      cursor = s.end;
    }
  }

  // Build HTML
  let out = "";
  let pos = 0;
  for (const s of kept) {
    out += s.start > pos ? escHtml(source.slice(pos, s.start)) : "";
    out += `<span class="${s.cls}">${escHtml(source.slice(s.start, s.end))}</span>`;
    pos = s.end;
  }
  out += pos < source.length ? escHtml(source.slice(pos)) : "";

  // Trailing newline ensures the backdrop height matches the textarea
  return out.endsWith("\n") ? out + " " : out + "\n ";
};

/** Wire the highlight overlay: sync textarea content to the backdrop pre>code. */
export const initHighlight = (textarea: HTMLTextAreaElement, backdrop: HTMLElement) => {
  const code = backdrop.querySelector("code");
  if (!code) {
    return;
  }

  const sync = () => {
    code.innerHTML = highlight(textarea.value);
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
