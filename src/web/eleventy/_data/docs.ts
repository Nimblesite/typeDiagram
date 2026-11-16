// [WEB-DOCS-DATA] Loads markdown from docs/specs and the TypeDoc-generated API reference.
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { resolve, dirname, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { mdToHtml } from "../markedInstance.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = resolve(__dirname, "../../../../docs/specs");
const TYPEDOC_DIR = resolve(__dirname, "../../.typedoc-out");

const toPosix = (p: string): string => p.split(sep).join("/");

// [WEB-DOCS-NAV] `group` nests an entry under a collapsible parent in the docs
// sidebar; entries without a group render at the top level in listed order.
type DocEntry = {
  slug: string;
  label: string;
  title: string;
  html: string;
  isTopLevel: boolean;
  group?: string;
};

const handwritten: ReadonlyArray<{ slug: string; label: string; group?: string }> = [
  { slug: "getting-started", label: "Getting Started" },
  { slug: "language-reference", label: "Language Reference" },
  { slug: "cli", label: "CLI" },
  { slug: "multi-language-pipeline", label: "Multi-Language Pipeline" },
  { slug: "converters", label: "Converters" },
  { slug: "typeshed-conversion", label: "Typeshed Conversion" },
  { slug: "render-hooks", label: "Render Hooks" },
  { slug: "tdbin", label: "TDBIN Binary Codec", group: "TDBIN" },
  { slug: "tdbin-benchmarks", label: "Benchmarks", group: "TDBIN" },
  { slug: "tdbin-wire-format", label: "Wire Format", group: "TDBIN" },
  { slug: "tdbin-rust-api", label: "Rust API", group: "TDBIN" },
  { slug: "tdbin-future-typescript", label: "TypeScript Roadmap", group: "TDBIN" },
  { slug: "tdbin-future-reader", label: "Reader Roadmap", group: "TDBIN" },
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

const docTitle = (label: string, group?: string) =>
  group === undefined || label.startsWith(group) ? label : `${group} ${label}`;

const loadHandwritten = (slug: string, label: string, group?: string): DocEntry => ({
  slug,
  label,
  title: docTitle(label, group),
  isTopLevel: true,
  ...(group === undefined ? {} : { group }),
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

export default [introEntry, ...handwritten.map((d) => loadHandwritten(d.slug, d.label, d.group)), ...loadApiEntries()];
