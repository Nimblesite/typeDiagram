// [WEB-CONVERTER] Converter page: paste language source ↔ typeDiagram + SVG.
import { debounce } from "./debounce.js";
import { convertSource, convertFromTd, type SupportedLang } from "./converter-render.js";
import { highlightLang } from "./converter-highlight.js";
import { highlight } from "./highlight.js";
import { initSplitter } from "./splitter.js";
import { createViewport, setViewportContent } from "./viewport.js";
import { initEditorZoom } from "./editor-zoom.js";
import { createZoomControls } from "./zoom-controls.js";

const SAMPLES: Record<SupportedLang, string> = {
  typescript: `export interface ChatRequest {
  message: string;
  session_id: string;
  tool_results: Array<ToolResult>;
}

export interface ChatTurnInput {
  config: AgentConfig;
  user_message: string;
  tool_results: Array<ToolResult>;
  session_id: string;
}

export interface ToolResult {
  tool_call_id: string;
  name: string;
  content: string;
  ok: boolean;
}

export interface TextPart {
  text: string;
}

export interface UriPart {
  url: string;
  kind: UriKind;
  media_type: string;
}

export type ContentItem =
  | { kind: "Text"; value: TextPart }
  | { kind: "Uri"; value: UriPart }
  | { kind: "Scalar"; value: string };

export type UriKind =
  | { kind: "Image" }
  | { kind: "Audio" }
  | { kind: "Video" }
  | { kind: "Document" }
  | { kind: "Web" }
  | { kind: "Api" };
`,
  rust: `pub struct ChatRequest {
    pub message: String,
    pub session_id: String,
    pub tool_results: Option<Vec<ToolResult>>,
}

pub struct ChatTurnInput {
    pub config: AgentConfig,
    pub user_message: String,
    pub tool_results: Option<Vec<ToolResult>>,
    pub session_id: String,
}

pub struct ToolResult {
    pub tool_call_id: String,
    pub name: String,
    pub content: String,
    pub ok: bool,
}

pub struct TextPart {
    pub text: String,
}

pub struct UriPart {
    pub url: String,
    pub kind: UriKind,
    pub media_type: Option<String>,
}

pub enum ContentItem {
    Text { value: TextPart },
    Uri { value: UriPart },
    Scalar { value: String },
}

pub enum UriKind {
    Image,
    Audio,
    Video,
    Document,
    Web,
    Api,
}
`,
  python: `from dataclasses import dataclass

@dataclass
class ChatRequest:
    message: str
    session_id: str
    tool_results: Optional[list[ToolResult]]

@dataclass
class ChatTurnInput:
    config: AgentConfig
    user_message: str
    tool_results: Optional[list[ToolResult]]
    session_id: str

@dataclass
class ToolResult:
    tool_call_id: str
    name: str
    content: str
    ok: bool

@dataclass
class TextPart:
    text: str

@dataclass
class UriPart:
    url: str
    kind: UriKind
    media_type: Optional[str]
`,
  go: `type ChatRequest struct {
	Message     string
	SessionID   string
	ToolResults []ToolResult
}

type ChatTurnInput struct {
	Config      AgentConfig
	UserMessage string
	ToolResults []ToolResult
	SessionID   string
}

type ToolResult struct {
	ToolCallID string
	Name       string
	Content    string
	Ok         bool
}

type TextPart struct {
	Text string
}

type UriPart struct {
	Url       string
	Kind      UriKind
	MediaType *string
}

type ContentItem interface {
	Text
	Uri
	Scalar
}

type UriKind interface {
	Image
	Audio
	Video
	Document
	Web
	Api
}
`,
  csharp: `public record ChatRequest(
    string Message,
    string SessionId,
    List<ToolResult>? ToolResults
);

public record ChatTurnInput(
    AgentConfig Config,
    string UserMessage,
    List<ToolResult>? ToolResults,
    string SessionId
);

public record ToolResult(
    string ToolCallId,
    string Name,
    string Content,
    bool Ok
);

public record TextPart(
    string Text
);

public record UriPart(
    string Url,
    UriKind Kind,
    string? MediaType
);

public enum ContentItem {
    Text,
    Uri,
    Scalar
}

public enum UriKind {
    Image,
    Audio,
    Video,
    Document,
    Web,
    Api
}
`,
  fsharp: `type ChatRequest = {
    message: string
    session_id: string
    tool_results: ToolResult list option
}

type ChatTurnInput = {
    config: AgentConfig
    user_message: string
    tool_results: ToolResult list option
    session_id: string
}

type ToolResult = {
    tool_call_id: string
    name: string
    content: string
    ok: bool
}

type TextPart = {
    text: string
}

type UriPart = {
    url: string
    kind: UriKind
    media_type: string option
}

type ContentItem =
    | Text of value: TextPart
    | Uri of value: UriPart
    | Scalar of value: string

type UriKind =
    | Image
    | Audio
    | Video
    | Document
    | Web
    | Api
`,
};

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

let currentLang: SupportedLang = "typescript";
let flipped = false;

const convStorageKey = (lang: SupportedLang, isFlipped: boolean): string =>
  `td-conv-${lang}-${isFlipped ? "td" : "src"}`;

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

const loadConvEditor = (lang: SupportedLang, isFlipped: boolean): string => {
  const saved = readConvStorage(convStorageKey(lang, isFlipped));
  if (saved !== null) {
    return saved;
  }
  return isFlipped ? TD_SAMPLE : SAMPLES[lang];
};

const buildDom = (container: HTMLElement) => {
  container.innerHTML = `
    <div class="conv-toolbar">
      <div class="conv-lang-tabs" id="lang-tabs">
        ${LANGUAGES.map(
          (l) =>
            `<button class="conv-lang-tab${l === currentLang ? " conv-lang-tab--active" : ""}" data-lang="${l}">${LANG_LABELS[l]}</button>`
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
          <label class="pane-label" id="conv-left-label">source</label>
          <div class="editor-wrap">
            <pre class="editor-backdrop" id="conv-backdrop" aria-hidden="true"><code></code></pre>
            <textarea id="conv-editor" spellcheck="false" autocomplete="off"></textarea>
          </div>
        </div>
        <div class="splitter" id="conv-splitter"></div>
        <div class="conv-col">
          <label class="pane-label" id="conv-right-label">typediagram</label>
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
    code.innerHTML = isFlipped() ? highlight(editor.value) : highlightLang(editor.value, getLang());
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
  } = buildDom(container);

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
    leftLabel.textContent = flipped ? "typediagram" : "source";
    rightLabel.textContent = flipped ? LANG_LABELS[currentLang].toLowerCase() : "typediagram";
    flipBtn.classList.toggle("conv-flip-btn--active", flipped);
  };

  const run = async () => {
    const result = flipped
      ? await convertFromTd(editor.value, currentLang)
      : await convertSource(editor.value, currentLang);

    tdCode.innerHTML = flipped ? highlightLang(result.tdSource, currentLang) : highlight(result.tdSource);
    setViewportContent(preview, result.svgHtml);
  };

  const debounced = debounce(() => {
    void run();
  }, 150);

  editor.value = loadConvEditor(currentLang, flipped);
  syncHighlight?.();
  editor.addEventListener("input", () => {
    writeConvStorage(convStorageKey(currentLang, flipped), editor.value);
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
    editor.value = loadConvEditor(currentLang, flipped);
    updateLabels();
    syncHighlight?.();
    void run();
  });

  flipBtn.addEventListener("click", () => {
    flipped = !flipped;
    editor.value = loadConvEditor(currentLang, flipped);
    updateLabels();
    syncHighlight?.();
    void run();
  });

  void run();
};
