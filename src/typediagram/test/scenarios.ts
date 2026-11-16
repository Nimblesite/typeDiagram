// [TEST-SCENARIOS] Shared snapshot scenario table for SVG rendering tests.
// Imported by typediagram, cli, and web test suites — same expectations everywhere.
import {
  ALL_EXTERNAL,
  ALL_PRIMITIVES,
  ALIAS_CHAIN,
  CHAT_EXAMPLE,
  DEEP_GENERICS,
  EMPTY_DIAGRAM,
  LONG_NAMES,
  MANY_NODES,
  MIXED_UNION,
  MULTI_GENERICS,
  SELF_REF,
  SINGLE_ALIAS,
  SINGLE_RECORD,
  SINGLE_UNION,
  SMALL_EXAMPLE,
  UNION_REFS_UNION,
} from "./fixtures.js";

export interface Scenario {
  readonly name: string;
  readonly source: string;
  readonly snapshotFile: string;
  readonly contains: readonly string[];
  readonly notContains: readonly string[];
  readonly patterns: readonly RegExp[];
  readonly countChecks: readonly { pattern: RegExp; count: number }[];
}

/**
 * Build a `Scenario`, defaulting every optional expectation list to empty so
 * each row states only the checks it actually cares about. `name`, `source`,
 * and `snapshotFile` are required; the rest override the empty defaults.
 */
const scenario = (
  base: Pick<Scenario, "name" | "source" | "snapshotFile"> & Partial<Omit<Scenario, "name" | "source" | "snapshotFile">>
): Scenario => ({
  contains: [],
  notContains: [],
  patterns: [],
  countChecks: [],
  ...base,
});

export const SCENARIOS: readonly Scenario[] = [
  scenario({
    name: "small spec example",
    source: SMALL_EXAMPLE,
    snapshotFile: "small-example.svg",
    notContains: ["&amp;lt;"],
  }),
  scenario({
    name: "single record",
    source: SINGLE_RECORD,
    snapshotFile: "single-record.svg",
    contains: ["Point", "x: Float"],
  }),
  scenario({
    name: "single union",
    source: SINGLE_UNION,
    snapshotFile: "single-union.svg",
    contains: ["Direction", "North", "West"],
  }),
  scenario({
    name: "single alias",
    source: SINGLE_ALIAS,
    snapshotFile: "single-alias.svg",
    contains: ["UserId"],
  }),
  scenario({
    name: "empty diagram",
    source: EMPTY_DIAGRAM,
    snapshotFile: "empty-diagram.svg",
    notContains: ["NaN"],
    patterns: [/^<svg[\s>]/],
  }),
  scenario({
    name: "self-referential type",
    source: SELF_REF,
    snapshotFile: "self-ref.svg",
    contains: ["TreeNode", "children"],
  }),
  scenario({
    name: "multiple generics (Pair, Either, Result)",
    source: MULTI_GENERICS,
    snapshotFile: "multi-generics.svg",
    contains: ["Pair", "Either", "Result"],
  }),
  scenario({
    name: "deep nested generic references",
    source: DEEP_GENERICS,
    snapshotFile: "deep-generics.svg",
    contains: ["Config", "Rule"],
  }),
  scenario({
    name: "mixed union (payloads + empty variants)",
    source: MIXED_UNION,
    snapshotFile: "mixed-union.svg",
    contains: ["Click", "Focus", "Blur"],
  }),
  scenario({
    name: "all primitive types",
    source: ALL_PRIMITIVES,
    snapshotFile: "all-primitives.svg",
    contains: ["Bool", "Int", "Float", "String", "Bytes", "Unit"],
  }),
  scenario({
    name: "long type and field names",
    source: LONG_NAMES,
    snapshotFile: "long-names.svg",
    contains: ["VeryLongTypeNameThatShouldNotBreakLayout"],
    notContains: ["NaN"],
  }),
  scenario({
    name: "many chained nodes (A->B->...->G)",
    source: MANY_NODES,
    snapshotFile: "many-nodes.svg",
    contains: [
      `data-decl="A"`,
      `data-decl="B"`,
      `data-decl="C"`,
      `data-decl="D"`,
      `data-decl="E"`,
      `data-decl="F"`,
      `data-decl="G"`,
    ],
  }),
  scenario({
    name: "alias chain",
    source: ALIAS_CHAIN,
    snapshotFile: "alias-chain.svg",
    contains: ["Email", "UserEmail", "AdminEmail"],
  }),
  scenario({
    name: "union referencing union",
    source: UNION_REFS_UNION,
    snapshotFile: "union-refs-union.svg",
    contains: ["Outer", "Inner"],
    countChecks: [{ pattern: /data-kind="union"/g, count: 2 }],
  }),
  scenario({
    name: "record with all external type references",
    source: ALL_EXTERNAL,
    snapshotFile: "all-external.svg",
    contains: ["HttpRequest", "URL", "Duration"],
  }),
  scenario({
    name: "chat-model full spec",
    source: CHAT_EXAMPLE,
    snapshotFile: "chat-model-render.test.svg",
    contains: [
      // decl data attributes
      `data-decl="ChatRequest"`,
      `data-decl="ChatTurnInput"`,
      `data-decl="ToolResult"`,
      `data-decl="ToolResultContent"`,
      `data-decl="ContentItem"`,
      `data-decl="TextPart"`,
      `data-decl="UriPart"`,
      `data-decl="UriKind"`,
      `data-decl="Option"`,
      // SVG structure
      "<defs>",
      "<marker ",
      "</defs>",
      'marker-end="url(#td-arrow)"',
      // field names
      "message",
      "session_id",
      "tool_results",
      "config",
      "user_message",
      "tool_call_id",
      "name",
      "content",
      "ok",
      "text",
      "url",
      "kind",
      "media_type",
      // variant names
      "None",
      "Scalar",
      "Dict",
      "List",
      "Text",
      "Uri",
      "Image",
      "Audio",
      "Video",
      "Document",
      "Web",
      "Api",
      "Some",
      // type references
      "String",
      "Bool",
      "AgentConfig",
      "ToolResultContent",
      "ContentItem",
      "TextPart",
      "UriPart",
      "UriKind",
    ],
    notContains: ["&amp;lt;", "&amp;gt;", "&amp;quot;", "&amp;amp;"],
    patterns: [/^<svg[\s>]/, /<\/svg>\s*$/, /<rect /, /<text /, /<line /, /<polyline /],
    countChecks: [
      { pattern: /data-kind="record"/g, count: 5 },
      { pattern: /data-kind="union"/g, count: 4 },
    ],
  }),
];
