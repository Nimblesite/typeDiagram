// [WEB-MARKED-SHARED] Marked instance with typeDiagram + Prism code highlighting,
// shared by docs data loader and blog markdown rendering.
import { Marked } from "marked";
import Prism from "prismjs";
import loadLanguages from "prismjs/components/index.js";
import { highlight as highlightTd } from "../src/highlight.js";

const TD_LANGS = new Set(["", "td", "typediagram"]);

loadLanguages(["typescript", "rust", "yaml", "json", "bash", "python", "go", "csharp", "makefile"]);

const LANG_ALIAS: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  javascript: "javascript",
  typescript: "typescript",
  rs: "rust",
  rust: "rust",
  yml: "yaml",
  yaml: "yaml",
  json: "json",
  sh: "bash",
  shell: "bash",
  bash: "bash",
  zsh: "bash",
  py: "python",
  python: "python",
  go: "go",
  cs: "csharp",
  csharp: "csharp",
  make: "makefile",
  makefile: "makefile",
  gitignore: "bash",
};

const escHtml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const prismHighlight = (code: string, prismLang: string): string => {
  const grammar = Prism.languages[prismLang];
  if (grammar === undefined) {
    return escHtml(code);
  }
  return Prism.highlight(code, grammar, prismLang);
};

const codeRenderer = ({ text, lang }: { text: string; lang?: string | null }): string => {
  const key = (lang ?? "").toLowerCase();
  if (TD_LANGS.has(key)) {
    return `<pre class="language-typediagram"><code class="language-typediagram">${highlightTd(text)}</code></pre>`;
  }
  const prismLang = LANG_ALIAS[key];
  if (prismLang === undefined) {
    return `<pre><code>${escHtml(text)}</code></pre>`;
  }
  const cls = `language-${prismLang}`;
  return `<pre class="${cls}"><code class="${cls}">${prismHighlight(text, prismLang)}</code></pre>`;
};

export const markedInstance = new Marked({ renderer: { code: codeRenderer } });

const rewriteMdLinks = (md: string): string =>
  md.replace(/\]\(([^)]+\.md)(#[^)]*)?\)/g, (_m, path: string, hash?: string) => {
    return `](${path.replace(/\.md$/, ".html")}${hash ?? ""})`;
  });

export const mdToHtml = (md: string): string => markedInstance.parse(rewriteMdLinks(md)) as string;

export default { markedInstance, mdToHtml };
