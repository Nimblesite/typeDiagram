import type { Diagnostic } from "../parser/diagnostics.js";
import { type Result, ok } from "../result.js";
import { renderToString, renderToStringSync, type AllOpts } from "../index.js";

// [MD-FENCE-REGEX] Matches ```typediagram or ```typeDiagram fences (case-insensitive).
const FENCE_RE = /^(```+)\s*typeDiagram\s*\n([\s\S]*?)\n\1\s*$/gim;

interface Fence {
  start: number;
  end: number;
  src: string;
}

// [MD-SHARED] Fence scan is shared by sync + async renderers.
function scanFences(md: string): Fence[] {
  const fences: Fence[] = [];
  for (const m of md.matchAll(FENCE_RE)) {
    const src = m[2];
    if (src === undefined) {
      continue;
    }
    fences.push({ start: m.index, end: m.index + m[0].length, src });
  }
  return fences;
}

function formatErrorComment(errs: Diagnostic[]): string {
  const summary = errs.map((d) => `${String(d.line)}:${String(d.col)} ${d.severity} ${d.message}`).join("\n");
  return `<!-- typediagram error\n${summary}\n-->`;
}

function splice(md: string, fences: Fence[], replacements: string[]): string {
  let out = "";
  let cursor = 0;
  fences.forEach((f, i) => {
    out += md.slice(cursor, f.start);
    const replacement = replacements[i];
    if (replacement !== undefined) {
      out += replacement;
    }
    cursor = f.end;
  });
  out += md.slice(cursor);
  return out;
}

/**
 * Replace every ```typeDiagram fenced block with the rendered SVG inline.
 * Other fences pass through untouched. If a fence fails to render, its diagnostics
 * are surfaced in the Result; the markdown is still returned with the failed
 * fence replaced by an HTML comment containing the formatted diagnostics.
 */
export async function renderMarkdown(md: string, opts: AllOpts = {}): Promise<Result<string, Diagnostic[]>> {
  const fences = scanFences(md);
  if (fences.length === 0) {
    return ok(md);
  }
  const allDiagnostics: Diagnostic[] = [];
  const replacements: string[] = [];
  for (const f of fences) {
    const r = await renderToString(f.src, opts);
    if (r.ok) {
      replacements.push(r.value);
    } else {
      allDiagnostics.push(...r.error);
      replacements.push(formatErrorComment(r.error));
    }
  }
  const out = splice(md, fences, replacements);
  return allDiagnostics.length === 0 ? ok(out) : { ok: false, error: allDiagnostics };
}

/**
 * Synchronous version of renderMarkdown. Caller MUST have awaited `warmupSyncRender()`
 * (or any async render) first. Shares scan + splice + error formatting with the async path.
 */
export function renderMarkdownSync(md: string, opts: AllOpts = {}): Result<string, Diagnostic[]> {
  const fences = scanFences(md);
  if (fences.length === 0) {
    return ok(md);
  }
  const allDiagnostics: Diagnostic[] = [];
  const replacements: string[] = [];
  for (const f of fences) {
    const r = renderToStringSync(f.src, opts);
    if (r.ok) {
      replacements.push(r.value);
    } else {
      allDiagnostics.push(...r.error);
      replacements.push(formatErrorComment(r.error));
    }
  }
  const out = splice(md, fences, replacements);
  return allDiagnostics.length === 0 ? ok(out) : { ok: false, error: allDiagnostics };
}
