// [WEB-HIGHLIGHT-JS] Minimal regex-based JS highlighter for the hooks editor.
// Mirrors the pattern used by the typediagram highlighter: earlier rules win
// on overlapping matches. Returns HTML wrapped in <span class="hl-*">.

import { type Rule, runHighlight, initHighlightOverlay } from "./highlight-engine.js";

const RULES: readonly Rule[] = [
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
  // regex literals — simple heuristic, requires leading /, no spaces, trailing /flags.
  // Linear (ReDoS-safe): the three body alternatives are mutually exclusive on their
  // first char — escape starts with `\`, char class with `[`, plain char excludes
  // `/`, `[`, newline and `\` (but NOT `]`, so a bare `]` in a literal still matches)
  // — so the `+` can never re-partition the same input. The class-inner also consumes
  // escapes so `[\]]` stays one span. Matches the prior behaviour without backtracking.
  { re: /\/(?![\s/*])(?:\\.|\[(?:\\.|[^\]\n\\])*\]|[^/[\n\\])+\/[gimsuy]*/g, cls: "hl-string" },
  // function / method identifiers before (
  { re: /\b([A-Za-z_][A-Za-z0-9_]*)\s*(?=\()/g, cls: "hl-field", group: 1 },
  // property after . — basic
  { re: /\.([A-Za-z_][A-Za-z0-9_]*)\b/g, cls: "hl-field", group: 1 },
  // capitalized identifiers — treated as types/classes
  { re: /\b([A-Z][A-Za-z0-9_]*)\b/g, cls: "hl-type" },
  // punctuation
  { re: /[{}()[\];,.:?=<>+\-*/!&|^~%]/g, cls: "hl-punct" },
];

// At equal start, longer span wins — comments/strings fully swallow any
// single-char punctuation rules that would otherwise sort first and leak.
export const highlightJs = (source: string): string => runHighlight(source, RULES, true);

export const initJsHighlight = (textarea: HTMLTextAreaElement, backdrop: HTMLElement) =>
  initHighlightOverlay(textarea, backdrop, () => highlightJs(textarea.value), true);
