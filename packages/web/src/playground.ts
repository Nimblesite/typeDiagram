// [WEB-PLAYGROUND] Embeddable editor+preview component.
// Call mountPlayground(container) to drop it anywhere in the page.
import { debounce } from "./debounce.js";
import { renderPane } from "./render-pane.js";
import { initSplitter } from "./splitter.js";
import { createViewport, setViewportContent } from "./viewport.js";
import { initHighlight } from "./highlight.js";
import { initEditorZoom } from "./editor-zoom.js";
import { createZoomControls } from "./zoom-controls.js";
import { createHookChips } from "./hook-chips.js";
import { mergePresets } from "./hook-presets.js";

const INITIAL = `typeDiagram

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

const buildDom = (container: HTMLElement) => {
  container.classList.add("playground");
  container.innerHTML = `
    <section class="pane pane-editor">
      <label for="editor" class="pane-label">source</label>
      <div class="editor-wrap">
        <pre class="editor-backdrop" id="backdrop" aria-hidden="true"><code></code></pre>
        <textarea id="editor" spellcheck="false" autocomplete="off"></textarea>
      </div>
    </section>
    <div class="splitter" id="splitter"></div>
    <section class="pane pane-preview">
      <div class="pane-head">
        <label class="pane-label">preview</label>
        <div class="pane-head-slot" id="chips-slot"></div>
      </div>
      <div id="preview"></div>
    </section>`;

  const q = (sel: string): Element => {
    const el = container.querySelector(sel);
    if (el === null) {
      throw new Error(`[WEB-PLAYGROUND] missing ${sel}`);
    }
    return el;
  };
  return {
    editor: q("#editor") as HTMLTextAreaElement,
    preview: q("#preview") as HTMLElement,
    splitter: q("#splitter") as HTMLElement,
    backdrop: q("#backdrop") as HTMLElement,
    editorWrap: q(".editor-wrap") as HTMLElement,
    chipsSlot: q("#chips-slot") as HTMLElement,
  };
};

export const mountPlayground = (container: HTMLElement) => {
  const { editor, preview, splitter, backdrop, editorWrap, chipsSlot } = buildDom(container);
  initSplitter(container, splitter);
  const vp = createViewport(preview);
  createZoomControls(preview, vp);

  editor.value = INITIAL;
  initHighlight(editor, backdrop);
  initEditorZoom(editorWrap, editor, backdrop);

  let run: () => Promise<void> = async () => {};
  const chips = createHookChips(() => {
    void run();
  });
  chipsSlot.appendChild(chips.container);
  run = async () => {
    const html = await renderPane(editor.value, mergePresets(chips.selected()));
    setViewportContent(preview, html);
  };
  const debounced = debounce(() => {
    void run();
  }, 120);
  editor.addEventListener("input", debounced);
  void run();
};
