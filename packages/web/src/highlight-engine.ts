// [WEB-HIGHLIGHT-ENGINE] Shared regex-driven highlight engine for every hl-* highlighter
// (typeDiagram, converter input languages, and the JS hooks editor). Callers supply an
// ordered rule table; earlier rules win on overlapping matches. Returns HTML with
// <span class="hl-*"> wrapping matched tokens.

/** A single highlight rule: match `re`, tag `group` (or whole match) with CSS class `cls`. */
export type Rule = { re: RegExp; cls: string; group?: number };

type Span = { start: number; end: number; cls: string };

const escHtml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const collectSpans = (source: string, rules: readonly Rule[]): Span[] => {
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
  return spans;
};

const dropOverlaps = (spans: readonly Span[]): Span[] => {
  const kept: Span[] = [];
  let cursor = 0;
  for (const s of spans) {
    const nonOverlapping = s.start >= cursor;
    kept.push(...(nonOverlapping ? [s] : []));
    cursor = nonOverlapping ? s.end : cursor;
  }
  return kept;
};

const renderSpans = (source: string, kept: readonly Span[]): string => {
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

/**
 * Highlight `source` against an ordered `rules` table. When `longerWinsAtEqualStart`
 * is set, spans starting at the same offset sort longest-first so comments/strings
 * swallow shorter punctuation; otherwise shorter-first (the default token order).
 */
export const runHighlight = (source: string, rules: readonly Rule[], longerWinsAtEqualStart = false): string => {
  const spans = collectSpans(source, rules);
  spans.sort((a, b) => a.start - b.start || (longerWinsAtEqualStart ? b.end - a.end : a.end - b.end));
  return renderSpans(source, dropOverlaps(spans));
};

/**
 * Wire a textarea to a backdrop `pre > code` overlay: re-render on input, mirror scroll.
 * `render` produces the highlighted HTML for the current textarea value. When
 * `runInitialSync` is set, syncs once immediately and returns void; otherwise returns
 * the `sync` callback so the caller controls the first render. Returns undefined when
 * the backdrop has no `code` child.
 */
export const initHighlightOverlay = (
  textarea: HTMLTextAreaElement,
  backdrop: HTMLElement,
  render: () => string,
  runInitialSync: boolean
): (() => void) | undefined => {
  const code = backdrop.querySelector("code");
  if (code === null) {
    return undefined;
  }

  const mirrorScroll = () => {
    backdrop.scrollTop = textarea.scrollTop;
    backdrop.scrollLeft = textarea.scrollLeft;
  };

  const sync = () => {
    code.innerHTML = render();
    mirrorScroll();
  };

  textarea.addEventListener("input", sync);
  textarea.addEventListener("scroll", mirrorScroll);

  return runInitialSync ? (sync(), undefined) : sync;
};
