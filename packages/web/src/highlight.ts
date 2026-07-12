// [WEB-HIGHLIGHT] Regex-based syntax highlighter for typeDiagram.
// Mirrors the TextMate grammar scopes from packages/vscode/syntaxes/typediagram.tmLanguage.json.
// Returns HTML with <span class="hl-*"> wrapping tokens.

import { type Rule, runHighlight, initHighlightOverlay } from "./highlight-engine.js";

// Order matters: earlier rules win on overlapping matches.
const RULES: readonly Rule[] = [
  { re: /#.*$/gm, cls: "hl-comment" },
  { re: /\b(type|union|alias|typeDiagram)\b/g, cls: "hl-keyword" },
  { re: /\b(Bool|Int|Float|String|Bytes|Unit|DateTime|Uuid|Decimal|List|Map|Option)\b/g, cls: "hl-builtin" },
  { re: /\b([a-z_][A-Za-z0-9_]*)\s*(?=:)/g, cls: "hl-field", group: 1 },
  { re: /\b([A-Z][A-Za-z0-9_]*)\b/g, cls: "hl-type" },
  { re: /[<>{}:,=]/g, cls: "hl-punct" },
];

/** Highlight typeDiagram source, returning HTML with span.hl-* tokens. */
export const highlight = (source: string): string => runHighlight(source, RULES);

/** Wire the highlight overlay: sync textarea content to the backdrop pre>code. */
export const initHighlight = (textarea: HTMLTextAreaElement, backdrop: HTMLElement) =>
  initHighlightOverlay(textarea, backdrop, () => highlight(textarea.value), true);
