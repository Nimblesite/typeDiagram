// [WEB-PLAYGROUND] Editor+preview component with tabbed left pane:
//   source — the typeDiagram DSL
//   hooks  — optional JavaScript the user can write to customize rendering
//
// Hooks are ENTIRELY OPTIONAL. Empty hooks tab => renderer runs on its default
// path with no `hooks` option passed at all.
import { debounce } from "./debounce.js";
import { renderPane } from "./render-pane.js";
import { initSplitter } from "./splitter.js";
import { createViewport, setViewportContent } from "./viewport.js";
import { initHighlight } from "./highlight.js";
import { initEditorZoom } from "./editor-zoom.js";
import { createZoomControls } from "./zoom-controls.js";
import { evalHooks } from "./eval-hooks.js";
import { PRESETS, togglePresetInCode, presetsInCode, type PresetId } from "./hook-presets.js";
import { initJsHighlight } from "./highlight-js.js";

const INITIAL_SOURCE = `typeDiagram

# Chat API request types

type ChatRequest {
  message:      String
  session_id:   String
  tool_results: Option<List<ToolResult>>
}

type ChatTurnInput {
  config:       AgentConfig
  user_message: String
  tool_results: Option<List<ToolResult>>
  session_id:   String
}

type ToolResult {
  tool_call_id: String
  name:         String
  content:      ToolResultContent
  ok:           Bool
}

union ToolResultContent {
  None
  Scalar { value: String }
  Dict   { entries: Map<String, String> }
  List   { items: List<ContentItem> }
}

union ContentItem {
  Text   { value: TextPart }
  Uri    { value: UriPart }
  Scalar { value: String }
}

type TextPart {
  text: String
}

type UriPart {
  url:        String
  kind:       UriKind
  media_type: Option<String>
}

union UriKind {
  Image
  Audio
  Video
  Document
  Web
  Api
}

union Option<T> {
  Some { value: T }
  None
}

alias Email = String
`;

// [WEB-PLAYGROUND-HOOKS-INITIAL] The hooks textarea starts pre-filled with a
// block-commented example the user activates by deleting the two /* … */ markers.
// No hook property is assigned inside the block, so evalHooks produces NO hooks
// out of the box == default render.
const INITIAL_HOOKS = `
//Render hooks — write plain JS. In scope: svg, raw, hooks.
//Docs: /docs/render-hooks.html

//Tap a chip below to PASTE a real example. Or delete the comment markers
//wrapping this block to activate it as a drop-shadow hook.

/*
const prevDefs = hooks.defs;
hooks.defs = (ctx) => {
  const prev = prevDefs ? prevDefs(ctx) : undefined;
  const mine = svg\`<filter id="drop"><feDropShadow dx="10" dy="3" stdDeviation="2.5" flood-opacity="0.35"/></filter>\`;
  return prev ? svg\`\${prev}\${mine}\` : mine;
};
const prevNode = hooks.node;
hooks.node = (ctx, def) => {
  const inner = prevNode ? (prevNode(ctx, def) ?? def) : def;
  return svg\`<g filter="url(#drop)">\${inner}</g>\`;
};
*/
`;

const buildDom = (container: HTMLElement) => {
  container.classList.add("playground");
  container.innerHTML = `
    <section class="pane pane-editor">
      <div class="pane-head pane-tabs">
        <button type="button" class="pane-tab pane-tab--on" data-tab="source">source</button>
        <button type="button" class="pane-tab" data-tab="hooks">hooks <span class="pane-tab-badge" id="hooks-badge" hidden></span></button>
      </div>
      <div class="editor-wrap" data-editor="source">
        <pre class="editor-backdrop" id="backdrop" aria-hidden="true"><code></code></pre>
        <textarea id="editor" spellcheck="false" autocomplete="off"></textarea>
      </div>
      <div class="editor-wrap editor-wrap--hidden" data-editor="hooks">
        <pre class="editor-backdrop" id="hooks-backdrop" aria-hidden="true"><code></code></pre>
        <textarea id="hooks-editor" spellcheck="false" autocomplete="off"></textarea>
        <div class="hooks-toolbar" id="hooks-toolbar"></div>
        <div class="hooks-diag" id="hooks-diag" hidden></div>
      </div>
    </section>
    <div class="splitter" id="splitter"></div>
    <section class="pane pane-preview">
      <div class="pane-head"><label class="pane-label">preview</label></div>
      <div id="preview"></div>
    </section>`;

  // Selectors below are guaranteed to match because they come from our own innerHTML literal.
  const q = (sel: string): Element => container.querySelector(sel) as Element;
  return {
    editor: q("#editor") as HTMLTextAreaElement,
    hooksEditor: q("#hooks-editor") as HTMLTextAreaElement,
    hooksBackdrop: q("#hooks-backdrop") as HTMLElement,
    hooksToolbar: q("#hooks-toolbar") as HTMLElement,
    hooksDiag: q("#hooks-diag") as HTMLElement,
    hooksBadge: q("#hooks-badge") as HTMLElement,
    preview: q("#preview") as HTMLElement,
    splitter: q("#splitter") as HTMLElement,
    backdrop: q("#backdrop") as HTMLElement,
    editorWrap: q('[data-editor="source"]') as HTMLElement,
    hooksWrap: q('[data-editor="hooks"]') as HTMLElement,
    tabs: Array.from(container.querySelectorAll<HTMLButtonElement>(".pane-tab")),
  };
};

const buildPresetButtons = (toolbar: HTMLElement, getCode: () => string, setCode: (next: string) => void) => {
  for (const preset of PRESETS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "hook-chip";
    btn.textContent = preset.label;
    btn.title = preset.blurb;
    btn.dataset.presetId = preset.id;
    btn.setAttribute("aria-pressed", "false");
    btn.addEventListener("click", () => {
      const code = getCode();
      const on = !presetsInCode(code).includes(preset.id);
      setCode(togglePresetInCode(code, preset.id, on));
    });
    toolbar.appendChild(btn);
  }
};

const syncPresetButtons = (toolbar: HTMLElement, code: string) => {
  const active = new Set<PresetId>(presetsInCode(code));
  for (const btn of Array.from(toolbar.querySelectorAll<HTMLButtonElement>(".hook-chip"))) {
    const id = btn.dataset.presetId as PresetId;
    const on = active.has(id);
    btn.classList.toggle("hook-chip--on", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  }
};

const activateTab = (tabId: "source" | "hooks", refs: ReturnType<typeof buildDom>) => {
  for (const t of refs.tabs) {
    const on = t.dataset.tab === tabId;
    t.classList.toggle("pane-tab--on", on);
  }
  refs.editorWrap.classList.toggle("editor-wrap--hidden", tabId !== "source");
  refs.hooksWrap.classList.toggle("editor-wrap--hidden", tabId !== "hooks");
};

const STORAGE_SOURCE_KEY = "td-playground-source";
const STORAGE_HOOKS_KEY = "td-playground-hooks";

export const mountPlayground = (container: HTMLElement) => {
  const refs = buildDom(container);
  const {
    editor,
    hooksEditor,
    hooksBackdrop,
    hooksToolbar,
    hooksDiag,
    hooksBadge,
    preview,
    splitter,
    backdrop,
    editorWrap,
  } = refs;
  initSplitter(container, splitter);
  const vp = createViewport(preview);
  createZoomControls(preview, vp);

  const savedSource = localStorage.getItem(STORAGE_SOURCE_KEY);
  const savedHooks = localStorage.getItem(STORAGE_HOOKS_KEY);
  editor.value = savedSource ?? INITIAL_SOURCE;
  hooksEditor.value = savedHooks ?? INITIAL_HOOKS;
  initHighlight(editor, backdrop);
  initEditorZoom(editorWrap, editor, backdrop);
  initJsHighlight(hooksEditor, hooksBackdrop);

  buildPresetButtons(
    hooksToolbar,
    () => hooksEditor.value,
    (next) => {
      hooksEditor.value = next;
      hooksEditor.dispatchEvent(new Event("input", { bubbles: true }));
      syncPresetButtons(hooksToolbar, next);
      void run();
    }
  );
  syncPresetButtons(hooksToolbar, hooksEditor.value);

  const run = async () => {
    const evaluated = evalHooks(hooksEditor.value);
    if (evaluated.ok) {
      hooksDiag.hidden = true;
      hooksDiag.textContent = "";
    } else {
      hooksDiag.hidden = false;
      hooksDiag.textContent = evaluated.error ?? "";
    }
    const count = evaluated.hooks === undefined ? 0 : Object.keys(evaluated.hooks).length;
    if (count > 0) {
      hooksBadge.hidden = false;
      hooksBadge.textContent = String(count);
    } else {
      hooksBadge.hidden = true;
      hooksBadge.textContent = "";
    }
    const html = await renderPane(editor.value, evaluated.hooks);
    setViewportContent(preview, html);
  };
  const debounced = debounce(() => {
    void run();
  }, 120);

  editor.addEventListener("input", () => {
    localStorage.setItem(STORAGE_SOURCE_KEY, editor.value);
    debounced();
  });
  hooksEditor.addEventListener("input", () => {
    localStorage.setItem(STORAGE_HOOKS_KEY, hooksEditor.value);
    syncPresetButtons(hooksToolbar, hooksEditor.value);
    debounced();
  });
  for (const tab of refs.tabs) {
    tab.addEventListener("click", () => {
      const id = tab.dataset.tab;
      if (id === "source" || id === "hooks") {
        activateTab(id, refs);
      }
    });
  }
  activateTab("source", refs);
  void run();
};
