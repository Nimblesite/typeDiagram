// [VSCODE-MD-PLUGIN] markdown-it plugin: renders ```typediagram``` fences to inline SVG
// using the core sync renderer. Requires that `warmupSyncRender()` has resolved at least
// once before the plugin is hit. On cold cache miss, emits a placeholder the extension
// replaces via preview refresh after warmup completes.
import { renderToStringSync, isSyncRenderReady } from "typediagram-core";

// Minimal markdown-it types so we don't pull the full dep just for signatures.
interface MdToken {
  info: string;
  content: string;
}
interface MdRuleFn {
  (tokens: MdToken[], idx: number, options: unknown, env: unknown, self: unknown): string;
}
interface MdRenderer {
  rules: { fence?: MdRuleFn };
}
export interface MarkdownIt {
  renderer: MdRenderer;
}

const LANG_RE = /^typediagram\b/i;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function placeholder(source: string): string {
  return `<pre class="typediagram-pending" data-typediagram-source="${escapeHtml(source)}"><code>${escapeHtml(source)}</code></pre>`;
}

function errorBlock(message: string, source: string): string {
  return `<pre class="typediagram-error"><code>typediagram error: ${escapeHtml(message)}\n\n${escapeHtml(source)}</code></pre>`;
}

export function typediagramMarkdownItPlugin(md: MarkdownIt): MarkdownIt {
  const previousFence = md.renderer.rules.fence;
  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    if (token && LANG_RE.test(token.info.trim())) {
      if (!isSyncRenderReady()) {
        return placeholder(token.content);
      }
      const result = renderToStringSync(token.content);
      if (result.ok) {
        return `<div class="typediagram">${result.value}</div>`;
      }
      const msg = result.error.map((d) => `${String(d.line)}:${String(d.col)} ${d.message}`).join("; ");
      return errorBlock(msg, token.content);
    }
    if (previousFence) {
      return previousFence(tokens, idx, options, env, self);
    }
    return "";
  };
  return md;
}
