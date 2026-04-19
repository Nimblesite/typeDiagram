// [WEB-CONVERTER] Converter page: typeDiagram ↔ language source + SVG.
import { debounce } from "./debounce.js";
import { convertFromTd, convertSource, type SupportedLang } from "./converter-render.js";
import { highlightLang } from "./converter-highlight.js";
import { highlight } from "./highlight.js";
import { initSplitter } from "./splitter.js";
import { createViewport, setViewportContent } from "./viewport.js";
import { initEditorZoom } from "./editor-zoom.js";
import { createZoomControls } from "./zoom-controls.js";
import { HOME_PAGE_SAMPLE } from "typediagram-core";

const TD_SAMPLE = HOME_PAGE_SAMPLE;

const LANG_LABELS: Record<SupportedLang, string> = {
  typescript: "TypeScript",
  rust: "Rust",
  python: "Python",
  go: "Go",
  csharp: "C#",
  fsharp: "F#",
  dart: "Dart",
  protobuf: "Protobuf",
};

const LANGUAGES: readonly SupportedLang[] = [
  "typescript",
  "rust",
  "python",
  "go",
  "csharp",
  "fsharp",
  "dart",
  "protobuf",
];

const DEFAULT_LANG: SupportedLang = "typescript";

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
  // Last-known TD source. Starts as the sample; overwritten whenever the TD
  // side (editor when unflipped, output when flipped) is updated. Used to
  // re-render when the user switches language while in flipped mode.
  let lastTdSource = TD_SAMPLE;

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
    if (flipped) {
      const result = await convertSource(editor.value, currentLang);
      tdCode.innerHTML = highlight(result.tdSource);
      lastTdSource = result.tdSource;
      setViewportContent(preview, result.svgHtml);
      return;
    }
    const result = await convertFromTd(editor.value, currentLang);
    tdCode.innerHTML = highlightLang(result.tdSource, currentLang);
    lastTdSource = editor.value;
    setViewportContent(preview, result.svgHtml);
  };

  const debounced = debounce(() => {
    void run();
  }, 150);

  editor.value = TD_SAMPLE;
  syncHighlight?.();
  updateLabels();
  editor.addEventListener("input", () => {
    debounced();
    syncHighlight?.();
  });

  // Produce language source from the last known TD source (used when
  // switching language while flipped, so the editor always has fresh content).
  const seedLanguageEditor = async () => {
    const result = await convertFromTd(lastTdSource, currentLang);
    editor.value = result.tdSource;
    syncHighlight?.();
    await run();
  };

  langTabs.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-lang]");
    if (!btn) {
      return;
    }
    // Safety: data-lang is always set from the LANGUAGES array in buildDom
    const lang = btn.dataset["lang"] as SupportedLang;
    currentLang = lang;
    langTabs.querySelectorAll(".conv-lang-tab").forEach((t) => t.classList.toggle("conv-lang-tab--active", t === btn));
    updateLabels();
    if (flipped) {
      void seedLanguageEditor();
      return;
    }
    syncHighlight?.();
    void run();
  });

  flipBtn.addEventListener("click", () => {
    flipped = !flipped;
    updateLabels();
    if (flipped) {
      // Flipping to language-editor mode: seed with the generated language
      // source derived from the current TD source.
      void seedLanguageEditor();
      return;
    }
    // Flipping back to TD-editor mode: restore the last known TD source.
    editor.value = lastTdSource;
    syncHighlight?.();
    void run();
  });

  void run();
};
