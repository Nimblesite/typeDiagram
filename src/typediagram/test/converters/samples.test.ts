// [CONV-SAMPLE-TEST] Integration: converter page samples must parse, print, and re-parse.
import { describe, expect, it } from "vitest";
import { typescript, python, rust, go, csharp } from "../../src/converters/index.js";
import { parse } from "../../src/parser/index.js";
import { buildModel } from "../../src/model/index.js";
import { printSource } from "../../src/model/print.js";
import { unwrap } from "./helpers.js";

const TS_SAMPLE = `export interface ChatRequest {
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
`;

const RUST_SAMPLE = `pub struct ChatRequest {
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
`;

const PYTHON_SAMPLE = `from dataclasses import dataclass

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
`;

const GO_SAMPLE = `type ChatRequest struct {
\tMessage     string
\tSessionID   string
\tToolResults []ToolResult
}

type ChatTurnInput struct {
\tConfig      AgentConfig
\tUserMessage string
\tToolResults []ToolResult
\tSessionID   string
}

type ToolResult struct {
\tToolCallID string
\tName       string
\tContent    string
\tOk         bool
}

type TextPart struct {
\tText string
}

type UriPart struct {
\tUrl       string
\tKind      UriKind
\tMediaType *string
}

type ContentItem interface {
\tText
\tUri
\tScalar
}

type UriKind interface {
\tImage
\tAudio
\tVideo
\tDocument
\tWeb
\tApi
}
`;

const CSHARP_SAMPLE = `public record ChatRequest(
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
`;

const EXPECTED_TYPES = ["ChatRequest", "ChatTurnInput", "ToolResult", "TextPart", "UriPart"];

const assertSampleConverts = (name: string, converter: typeof typescript, source: string, expectedTypes: string[]) => {
  it(`[CONV-SAMPLE-${name.toUpperCase()}] parses all types, prints valid TD, and re-parses`, () => {
    // Parse
    const model = unwrap(converter.fromSource(source));
    for (const typeName of expectedTypes) {
      expect(
        model.decls.find((d) => d.name === typeName),
        `expected type ${typeName} in ${name} model`
      ).toBeDefined();
    }

    // Print to typeDiagram and re-parse
    const tdSource = printSource(model);
    const reParsed = parse(tdSource);
    expect(reParsed.ok, `typeDiagram re-parse failed:\n${tdSource}`).toBe(true);

    // Re-parsed model builds without errors
    const reModel = buildModel(unwrap(reParsed));
    expect(reModel.ok, `model build failed from:\n${tdSource}`).toBe(true);
  });
};

describe("[CONV-SAMPLE] Converter page samples parse into valid typeDiagram", () => {
  assertSampleConverts("typescript", typescript, TS_SAMPLE, [...EXPECTED_TYPES, "ContentItem", "UriKind"]);
  assertSampleConverts("rust", rust, RUST_SAMPLE, [...EXPECTED_TYPES, "ContentItem", "UriKind"]);
  assertSampleConverts("python", python, PYTHON_SAMPLE, EXPECTED_TYPES);
  assertSampleConverts("go", go, GO_SAMPLE, [...EXPECTED_TYPES, "ContentItem", "UriKind"]);
  assertSampleConverts("csharp", csharp, CSHARP_SAMPLE, [...EXPECTED_TYPES, "ContentItem", "UriKind"]);
});
