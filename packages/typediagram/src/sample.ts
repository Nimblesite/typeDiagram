// [SAMPLE-HOME-PAGE] The canonical typeDiagram example used on the home-page
// playground, the converter page, and the lossless round-trip tests. Single
// source of truth — do not fork copies.
export const HOME_PAGE_SAMPLE = `typeDiagram

type ChatRequest {
  message: String
  session_id: String
  tool_results: Option<List<ToolResult>>
}

type ChatTurnInput {
  config: AgentConfig
  user_message: String
  tool_results: Option<List<ToolResult>>
  session_id: String
}

type ToolResult {
  tool_call_id: String
  name: String
  content: ToolResultContent
  ok: Bool
}

type TextPart {
  text: String
}

type UriPart {
  url: String
  kind: UriKind
  media_type: Option<String>
}

union ToolResultContent {
  None
  Scalar { value: String }
  Dict { entries: Map<String, String> }
  List { items: List<ContentItem> }
}

union ContentItem {
  Text { value: TextPart }
  Uri { value: UriPart }
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

union Option<T> {
  Some { value: T }
  None
}

alias Email = String
`;
