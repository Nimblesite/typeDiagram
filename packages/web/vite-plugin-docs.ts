// [WEB-DOCS-PLUGIN] Vite plugin that generates /docs/*.html pages from markdown files.
import { readFileSync } from "fs";
import { resolve } from "path";
import { Marked } from "marked";
import type { Plugin, ResolvedConfig } from "vite";
import { highlight } from "./src/highlight.js";

const DOCS_DIR = resolve(__dirname, "../../docs/specs");

// Languages where our typeDiagram highlighter applies
const TD_LANGS = new Set(["", "td", "typediagram"]);

const escHtml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const codeRenderer = ({ text, lang }: { text: string; lang?: string | null }): string => {
  const highlighted = TD_LANGS.has(lang ?? "") ? highlight(text) : escHtml(text);
  return `<pre><code>${highlighted}</code></pre>`;
};

const renderer = { code: codeRenderer };

const markedInstance = new Marked({ renderer });

const DOC_ORDER: ReadonlyArray<{ slug: string; label: string }> = [
  { slug: "getting-started", label: "Getting Started" },
  { slug: "language-reference", label: "Language Reference" },
  { slug: "cli", label: "CLI" },
  { slug: "converters", label: "Converters" },
  { slug: "api", label: "Node.js API" },
];

const docTemplate = (title: string, content: string, nav: string, base: string, cssHref: string) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title} — typeDiagram</title>
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&family=Inter:wght@300;400;500;600&family=Fira+Code:wght@400;500&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="${cssHref}" />
</head>
<body>
  <nav class="nav">
    <div class="nav-inner">
      <a href="${base}" class="nav-logo"><span class="nav-logo-accent">type</span>Diagram</a>
      <input type="checkbox" id="nav-toggle" class="nav-toggle" aria-label="Toggle navigation" />
      <label class="nav-burger" for="nav-toggle" aria-hidden="true"><span></span><span></span><span></span></label>
      <div class="nav-links">
        <a href="${base}#playground">Playground</a>
        <a href="${base}converter.html">Converter</a>
        <a href="${base}docs/">Docs</a>
        <a href="https://github.com/Nimblesite/typeDiagram">GitHub</a>
      </div>
    </div>
  </nav>
  <div class="docs-layout">
    <aside class="docs-sidebar">${nav}</aside>
    <main class="docs-content">${content}</main>
  </div>
</body>
</html>`;

const buildNav = (activeSlug: string, base: string) =>
  `<ul class="docs-nav">${DOC_ORDER.map(
    (d) =>
      `<li><a href="${base}docs/${d.slug}.html" class="${d.slug === activeSlug ? "active" : ""}">${d.label}</a></li>`
  ).join("")}</ul>`;

const renderDoc = (slug: string, base: string, cssHref: string): string | null => {
  const mdPath = resolve(DOCS_DIR, `${slug}.md`);
  try {
    const raw = readFileSync(mdPath, "utf-8");
    const html = markedInstance.parse(raw) as string;
    const title = DOC_ORDER.find((d) => d.slug === slug)?.label ?? slug;
    return docTemplate(title, html, buildNav(slug, base), base, cssHref);
  } catch {
    return null;
  }
};

export const docsPlugin = (): Plugin => {
  let config: ResolvedConfig;

  return {
    name: "vite-plugin-docs",

    configResolved(resolved) {
      config = resolved;
    },

    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? "";
        const match = url.match(/^\/docs\/(\w[\w-]*)\.html/);
        const isIndex = url === "/docs/" || url === "/docs";

        if (match === null && !isIndex) {
          next();
          return;
        }

        const slug = isIndex ? "getting-started" : (match?.[1] ?? "getting-started");
        const html = renderDoc(slug, "/", "/src/styles.css");
        if (html !== null) {
          res.setHeader("Content-Type", "text/html");
          res.end(html);
          return;
        }
        next();
      });
    },

    generateBundle(_, bundle) {
      // Find the emitted CSS asset filename
      const cssAsset = Object.keys(bundle).find((k) => k.endsWith(".css"));
      const base = config.base;
      const cssHref = cssAsset !== undefined ? `${base}${cssAsset}` : `${base}assets/index.css`;

      for (const doc of DOC_ORDER) {
        const html = renderDoc(doc.slug, base, cssHref);
        if (html !== null) {
          this.emitFile({ type: "asset", fileName: `docs/${doc.slug}.html`, source: html });
        }
      }

      // Index
      const indexHtml = renderDoc("getting-started", base, cssHref);
      if (indexHtml !== null) {
        this.emitFile({ type: "asset", fileName: "docs/index.html", source: indexHtml });
      }
    },
  };
};
