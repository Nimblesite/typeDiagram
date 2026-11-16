// [VSCODE-MD-PLUGIN] markdown-it plugin: renders ```typediagram``` fences to inline SVG
// using the core sync renderer. Requires that `warmupSyncRender()` has resolved at least
// once before the plugin is hit. On cold cache miss, emits a placeholder the extension
// replaces via preview refresh after warmup completes.
import { renderToStringSync, isSyncRenderReady } from "typediagram-core";
import { getLogger, type Logger } from "./logger.js";

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

// [MD-PLUGIN-LOGGER] NEVER default to a no-op. If setPluginLogger wasn't called yet
// (e.g. the plugin ran before activate()), lazily resolve via getLogger() which itself
// lazy-creates the Output Channel. Every fence invocation gets logged, always.
let pluginLoggerOverride: Logger | null = null;
export function setPluginLogger(logger: Logger): void {
  pluginLoggerOverride = logger.child({ scope: "md-plugin" });
}
function log(): Logger {
  return pluginLoggerOverride ?? getLogger().child({ scope: "md-plugin" });
}

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
  log().info("plugin installed on markdown-it instance", {
    hadPreviousFence: typeof previousFence === "function",
  });
  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    // markdown-it's fence rule is always invoked with a valid token at idx.
    const token = tokens[idx] as MdToken;
    const info = token.info.trim();
    const matches = LANG_RE.test(info);
    log().debug("fence rule invoked", {
      idx,
      info,
      matches,
      contentLength: token.content.length,
    });
    if (matches) {
      if (!isSyncRenderReady()) {
        log().warn("sync renderer not warm — emitting placeholder", {
          contentPreview: token.content.slice(0, 80),
        });
        return placeholder(token.content);
      }
      const startedAt = Date.now();
      const result = renderToStringSync(token.content);
      const elapsedMs = Date.now() - startedAt;
      if (result.ok) {
        log().info("rendered typediagram fence to SVG", { elapsedMs, svgLength: result.value.length });
        return `<div class="typediagram">${result.value}</div>`;
      }
      const msg = result.error.map((d) => `${String(d.line)}:${String(d.col)} ${d.message}`).join("; ");
      log().error("typediagram render failed", { elapsedMs, msg });
      return errorBlock(msg, token.content);
    }
    if (previousFence) {
      return previousFence(tokens, idx, options, env, self);
    }
    return "";
  };
  return md;
}
