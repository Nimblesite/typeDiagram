// [WEB-CONVERTER] Converter page: typeDiagram ↔ language source + SVG.
import { debounce } from "./debounce.js";
import { convertFromTd, convertSource, type SupportedLang } from "./converter-render.js";
import { highlightLang } from "./converter-highlight.js";
import { highlight } from "./highlight.js";
import { initSplitter } from "./splitter.js";
import { createViewport, setViewportContent } from "./viewport.js";
import { initEditorZoom } from "./editor-zoom.js";
import { createZoomControls } from "./zoom-controls.js";

const TD_SAMPLE = `typeDiagram

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
  content:      String
  ok:           Bool
}

type TextPart {
  text: String
}

type UriPart {
  url:        String
  kind:       UriKind
  media_type: Option<String>
}

union ContentItem {
  Text   { value: TextPart }
  Uri    { value: UriPart }
  Scalar { value: String }
}

union UriKind {
  Image
  Audio
  Video
  Document
  Web
  Api
}
`;

const LANG_LABELS: Record<SupportedLang, string> = {
  typescript: "TypeScript",
  rust: "Rust",
  python: "Python",
  go: "Go",
  csharp: "C#",
  fsharp: "F#",
};

const LANGUAGES: readonly SupportedLang[] = ["typescript", "rust", "python", "go", "csharp", "fsharp"];

const TD_STORAGE_KEY = "td-conv-td";
const LANG_STORAGE_KEY = (lang: SupportedLang): string => `td-conv-lang-${lang}`;

const DEFAULT_LANG: SupportedLang = "typescript";

const readConvStorage = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const writeConvStorage = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // localStorage unavailable or full — silently skip.
  }
};

const loadEditorContent = (lang: SupportedLang, isFlipped: boolean): string => {
  const key = isFlipped ? LANG_STORAGE_KEY(lang) : TD_STORAGE_KEY;
  const saved = readConvStorage(key);
  if (saved !== null) {
    return saved;
  }
  return isFlipped ? "" : TD_SAMPLE;
};

const buildDom = (container: HTMLElement, initialLang: SupportedLang) => {
  container.innerHTML = `
    <div class="conv-toolbar">
      <div class="conv-lang-tabs" id="lang-tabs">
        ${LANGUAGES.map(
          (l) =>
            `<button class="conv-lang-tab${l === initialLang ? " conv-lang-tab--active" : ""}" data-lang="${l}">${LANG_LABELS[l]}</button>`
        ).join("")}
      </div>
      <button class="conv-flip-btn" id="conv-flip" title="Swap direction">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <path d="M6 4l-4 4 4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M2 8h14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          <path d="M14 16l4-4-4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M18 12H4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      </button>
    </div>
    <div class="conv-panels">
      <div class="conv-input-panel">
        <div class="conv-col">
          <label class="pane-label" id="conv-left-label">typediagram</label>
          <div class="editor-wrap">
            <pre class="editor-backdrop" id="conv-backdrop" aria-hidden="true"><code></code></pre>
            <textarea id="conv-editor" spellcheck="false" autocomplete="off"></textarea>
          </div>
        </div>
        <div class="splitter" id="conv-splitter"></div>
        <div class="conv-col">
          <label class="pane-label" id="conv-right-label">typescript</label>
          <div class="conv-td-wrap">
            <pre class="conv-td-output" id="conv-td"><code></code></pre>
          </div>
        </div>
      </div>
      <div class="conv-preview-panel">
        <label class="pane-label">diagram</label>
        <div id="conv-preview" class="conv-preview"></div>
      </div>
    </div>`;

  const q = (sel: string): Element => {
    const el = container.querySelector(sel);
    if (el === null) {
      throw new Error(`[WEB-CONV] missing ${sel}`);
    }
    return el;
  };
  return {
    langTabs: q("#lang-tabs") as HTMLElement,
    editor: q("#conv-editor") as HTMLTextAreaElement,
    backdrop: q("#conv-backdrop") as HTMLElement,
    editorWrap: q(".editor-wrap") as HTMLElement,
    tdOutput: q("#conv-td") as HTMLElement,
    preview: q("#conv-preview") as HTMLElement,
    splitter: q("#conv-splitter") as HTMLElement,
    inputPanel: q(".conv-input-panel") as HTMLElement,
    flipBtn: q("#conv-flip") as HTMLButtonElement,
    leftLabel: q("#conv-left-label") as HTMLElement,
    rightLabel: q("#conv-right-label") as HTMLElement,
  };
};

const syncEditorHighlight = (
  editor: HTMLTextAreaElement,
  backdrop: HTMLElement,
  isFlipped: () => boolean,
  getLang: () => SupportedLang
) => {
  const code = backdrop.querySelector("code");
  if (!code) {
    return;
  }

  const sync = () => {
    code.innerHTML = isFlipped() ? highlightLang(editor.value, getLang()) : highlight(editor.value);
    backdrop.scrollTop = editor.scrollTop;
    backdrop.scrollLeft = editor.scrollLeft;
  };

  editor.addEventListener("scroll", () => {
    backdrop.scrollTop = editor.scrollTop;
    backdrop.scrollLeft = editor.scrollLeft;
  });

  return sync;
};

export const mountConverter = (container: HTMLElement) => {
  let currentLang: SupportedLang = DEFAULT_LANG;
  // flipped = false: TD editor on left, language output on right (default)
  // flipped = true:  language editor on left, TD output on right
  let flipped = false;

  const {
    langTabs,
    editor,
    backdrop,
    editorWrap,
    tdOutput,
    preview,
    splitter,
    inputPanel,
    flipBtn,
    leftLabel,
    rightLabel,
  } = buildDom(container, currentLang);

  initSplitter(inputPanel, splitter);
  const vp = createViewport(preview);
  createZoomControls(preview, vp);
  initEditorZoom(editorWrap, editor, backdrop);

  const syncHighlight = syncEditorHighlight(
    editor,
    backdrop,
    () => flipped,
    () => currentLang
  );

  const tdCode = tdOutput.querySelector("code");
  if (tdCode === null) {
    throw new Error("[WEB-CONV] missing code in tdOutput");
  }

  const updateLabels = () => {
    leftLabel.textContent = flipped ? LANG_LABELS[currentLang].toLowerCase() : "typediagram";
    rightLabel.textContent = flipped ? "typediagram" : LANG_LABELS[currentLang].toLowerCase();
    flipBtn.classList.toggle("conv-flip-btn--active", flipped);
  };

  const run = async () => {
    const result = flipped
      ? await convertSource(editor.value, currentLang)
      : await convertFromTd(editor.value, currentLang);

    tdCode.innerHTML = flipped ? highlight(result.tdSource) : highlightLang(result.tdSource, currentLang);
    setViewportContent(preview, result.svgHtml);
  };

  const debounced = debounce(() => {
    void run();
  }, 150);

  editor.value = loadEditorContent(currentLang, flipped);
  syncHighlight?.();
  updateLabels();
  editor.addEventListener("input", () => {
    const key = flipped ? LANG_STORAGE_KEY(currentLang) : TD_STORAGE_KEY;
    writeConvStorage(key, editor.value);
    debounced();
    syncHighlight?.();
  });

  langTabs.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-lang]");
    if (!btn) {
      return;
    }
    // Safety: data-lang is always set from the LANGUAGES array in buildDom
    const lang = btn.dataset["lang"] as SupportedLang;
    currentLang = lang;
    langTabs.querySelectorAll(".conv-lang-tab").forEach((t) => t.classList.toggle("conv-lang-tab--active", t === btn));
    if (flipped) {
      editor.value = loadEditorContent(currentLang, flipped);
    }
    updateLabels();
    syncHighlight?.();
    void run();
  });

  flipBtn.addEventListener("click", () => {
    flipped = !flipped;
    editor.value = loadEditorContent(currentLang, flipped);
    updateLabels();
    syncHighlight?.();
    void run();
  });

  void run();
};
