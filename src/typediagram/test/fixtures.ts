// [TEST-FIXTURES] Canonical typeDiagram source strings for all test scenarios.
// Shared across typediagram, cli, and web test suites.

export const SMALL_EXAMPLE = `typeDiagram

  type User {
    id: UUID
    name: String
    email: Option<Email>
    roles: List<Role>
    address: Address
  }

  type Address {
    line1: String
    city: String
    country: CountryCode
  }

  union Shape {
    Circle   { radius: Float }
    Square   { side: Float }
    Triangle { a: Float, b: Float, c: Float }
  }

  union Option<T> {
    Some { value: T }
    None
  }

  alias Email = String
`;

export const CHAT_EXAMPLE = `typeDiagram

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
`;

export const SINGLE_RECORD = `typeDiagram

  type Point {
    x: Float
    y: Float
  }
`;

export const SINGLE_UNION = `typeDiagram

  union Direction {
    North
    South
    East
    West
  }
`;

export const SINGLE_ALIAS = `typeDiagram

  alias UserId = String
`;

export const EMPTY_DIAGRAM = `typeDiagram
`;

export const SELF_REF = `typeDiagram

  type TreeNode {
    value: String
    children: List<TreeNode>
  }
`;

export const MULTI_GENERICS = `typeDiagram

  type Pair<A, B> {
    first: A
    second: B
  }

  union Either<L, R> {
    Left { value: L }
    Right { value: R }
  }

  union Result<T, E> {
    Ok { value: T }
    Err { error: E }
  }
`;

export const DEEP_GENERICS = `typeDiagram

  type Config {
    rules: Map<String, List<Option<Rule>>>
  }

  type Rule {
    name: String
    priority: Int
  }

  union Option<T> {
    Some { value: T }
    None
  }
`;

export const MIXED_UNION = `typeDiagram

  union Event {
    Click { x: Int, y: Int }
    KeyPress { key: String, modifiers: List<String> }
    Scroll { deltaX: Float, deltaY: Float }
    Focus
    Blur
  }
`;

export const ALL_PRIMITIVES = `typeDiagram

  type AllPrimitives {
    b: Bool
    i: Int
    f: Float
    s: String
    by: Bytes
    u: Unit
  }
`;

export const LONG_NAMES = `typeDiagram

  type VeryLongTypeNameThatShouldNotBreakLayout {
    this_is_an_extremely_long_field_name_that_tests_rendering: String
    short: Int
  }
`;

export const MANY_NODES = `typeDiagram

  type A { x: B }
  type B { x: C }
  type C { x: D }
  type D { x: E }
  type E { x: F }
  type F { x: G }
  type G { x: String }
`;

export const ALIAS_CHAIN = `typeDiagram

  alias Email = String
  alias UserEmail = Email
  alias AdminEmail = UserEmail
`;

export const UNION_REFS_UNION = `typeDiagram

  union Outer {
    Leaf { value: String }
    Nested { inner: Inner }
  }

  union Inner {
    A
    B { data: Int }
    C { label: String, count: Int }
  }
`;

export const ALL_EXTERNAL = `typeDiagram

  type HttpRequest {
    url: URL
    method: HttpMethod
    headers: Map<String, String>
    body: Option<Bytes>
    timeout: Duration
  }
`;
