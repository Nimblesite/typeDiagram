// [WEB-DOCS-DATA] Loads markdown from docs/specs and the TypeDoc-generated API reference.
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { resolve, dirname, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Marked } from "marked";
import Prism from "prismjs";
import loadLanguages from "prismjs/components/index.js";
import { highlight as highlightTd } from "../../src/highlight.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = resolve(__dirname, "../../../../docs/specs");
const TYPEDOC_DIR = resolve(__dirname, "../../.typedoc-out");

const TD_LANGS = new Set(["", "td", "typediagram"]);

// [WEB-PRISM-LANGS] Preload grammars for every language we highlight.
loadLanguages(["typescript", "rust", "yaml", "json", "bash", "python", "go", "csharp", "makefile"]);

// Canonicalise markdown code-fence language identifiers to Prism's keys.
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

const markedInstance = new Marked({ renderer: { code: codeRenderer } });

const toPosix = (p: string): string => p.split(sep).join("/");

// TypeDoc emits relative links ending in .md — rewrite them to .html so the browser can follow.
const rewriteMdLinks = (md: string): string =>
  md.replace(/\]\(([^)]+\.md)(#[^)]*)?\)/g, (_m, path: string, hash?: string) => {
    return `](${path.replace(/\.md$/, ".html")}${hash ?? ""})`;
  });

const mdToHtml = (md: string): string => markedInstance.parse(rewriteMdLinks(md)) as string;

type DocEntry = { slug: string; label: string; title: string; html: string; isTopLevel: boolean };

const handwritten: ReadonlyArray<{ slug: string; label: string }> = [
  { slug: "getting-started", label: "Getting Started" },
  { slug: "language-reference", label: "Language Reference" },
  { slug: "cli", label: "CLI" },
  { slug: "multi-language-pipeline", label: "Multi-Language Pipeline" },
  { slug: "converters", label: "Converters" },
  { slug: "render-hooks", label: "Render Hooks" },
  { slug: "api", label: "Node.js API" },
];

const INTRO_PATH = resolve(__dirname, "../../../../docs/shared/intro.md");
const SHARED_INTRO_MD = readFileSync(INTRO_PATH, "utf-8");

const introEntry: DocEntry = {
  slug: "introduction",
  label: "Introduction",
  title: "Introduction",
  isTopLevel: true,
  html: mdToHtml(`# Introduction\n\n${SHARED_INTRO_MD}`),
};

const loadHandwritten = (slug: string, label: string): DocEntry => ({
  slug,
  label,
  title: label,
  isTopLevel: true,
  html: mdToHtml(readFileSync(resolve(DOCS_DIR, `${slug}.md`), "utf-8")),
});

const walkMd = (dir: string, acc: string[] = []): string[] => {
  if (!existsSync(dir)) {
    return acc;
  }
  for (const name of readdirSync(dir)) {
    const full = resolve(dir, name);
    if (statSync(full).isDirectory()) {
      walkMd(full, acc);
    } else if (name.endsWith(".md")) {
      acc.push(full);
    }
  }
  return acc;
};

const firstHeading = (md: string): string | null => {
  const match = md.match(/^#\s+(.+)$/m);
  return match?.[1] ?? null;
};

const loadApiEntries = (): DocEntry[] => {
  const files = walkMd(TYPEDOC_DIR);
  return files.map((abs) => {
    const rel = toPosix(relative(TYPEDOC_DIR, abs)).replace(/\.md$/, "");
    const md = readFileSync(abs, "utf-8");
    const label = firstHeading(md) ?? rel;
    const isTopLevel = !rel.includes("/") || rel.endsWith("/index");
    return {
      slug: `api/${rel}`,
      label,
      title: `API — ${label}`,
      isTopLevel,
      html: mdToHtml(md),
    };
  });
};

export default [introEntry, ...handwritten.map((d) => loadHandwritten(d.slug, d.label)), ...loadApiEntries()];
