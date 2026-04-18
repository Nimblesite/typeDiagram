// [CONV-TS-TEST] TypeScript converter integration tests.
import { describe, expect, it } from "vitest";
import { typescript } from "../../src/converters/index.js";
import { parse } from "../../src/parser/index.js";
import { buildModel } from "../../src/model/index.js";
import { expectLosslessRoundTrip, unwrap } from "./helpers.js";

describe("[CONV-TS-FROM-COMPLEX] complex TypeScript -> typeDiagram", () => {
  it("parses a messy real-world file with interfaces, unions, aliases, and noise", () => {
    const src = `
// Copyright 2024 Acme Corp
import { something } from "somewhere";
import type { OtherThing } from "./other";

/** JSDoc: this function should be ignored entirely */
export async function fetchData(url: string): Promise<Response> {
  return fetch(url);
}

const API_URL = "https://example.com/api";
const MAX_RETRIES = 3;

class Logger {
  private level: string;
  constructor(level: string) { this.level = level; }
  log(msg: string): void { console.log(msg); }
  error(msg: string, err: Error): void { console.error(msg, err); }
}

export interface ChatRequest {
  message: string;
  session_id: string;
  tool_results: Array<ToolResult>;
  metadata: Map<string, string>;
  tags: string[];
  debug: boolean;
  timeout: number;
  payload: Uint8Array;
}

// Random arrow function
const noop = () => {};

export interface ToolResult {
  tool_call_id: string;
  name: string;
  content: string;
  ok: boolean;
  score: number;
}

function helperFunction(x: number, y: number): number {
  return x + y;
}

export interface GenericBox<T> {
  value: T;
  label: string;
}

export interface Pair<A, B> {
  first: A;
  second: B;
}

export type ContentItem =
  | { kind: "Text"; body: string; format: string }
  | { kind: "Image"; url: string; width: number; height: number }
  | { kind: "Code"; source: string; language: string }
  | { kind: "Divider" };

export type Status = "active" | "inactive" | "pending";

export type Shape = Circle | Square | Triangle;

export type Email = string;

export type IdList = Array<string>;

// Another class that should be ignored
class HttpClient {
  get(url: string): Promise<Response> { return fetch(url); }
  post(url: string, body: string): Promise<Response> { return fetch(url); }
}

export interface NullableFields {
  name: string | null;
  email: string | undefined;
  age: number;
}
`;
    const model = unwrap(typescript.fromSource(src));

    // Should NOT have parsed Logger or HttpClient
    expect(model.decls.find((d) => d.name === "Logger")).toBeUndefined();
    expect(model.decls.find((d) => d.name === "HttpClient")).toBeUndefined();

    // ChatRequest — record with 8 fields, type mappings
    const chat = model.decls.find((d) => d.name === "ChatRequest");
    expect(chat?.kind).toBe("record");
    const chatFields = chat?.kind === "record" ? chat.fields : [];
    expect(chatFields).toHaveLength(8);
    expect(chatFields.find((f) => f.name === "message")?.type.name).toBe("String");
    expect(chatFields.find((f) => f.name === "tool_results")?.type.name).toBe("List");
    expect(chatFields.find((f) => f.name === "tool_results")?.type.args[0]?.name).toBe("ToolResult");
    expect(chatFields.find((f) => f.name === "metadata")?.type.name).toBe("Map");
    // string[] syntax does map to List
    expect(chatFields.find((f) => f.name === "tags")?.type.name).toBe("List");
    expect(chatFields.find((f) => f.name === "tags")?.type.args[0]?.name).toBe("String");
    expect(chatFields.find((f) => f.name === "debug")?.type.name).toBe("Bool");
    expect(chatFields.find((f) => f.name === "timeout")?.type.name).toBe("Int");
    expect(chatFields.find((f) => f.name === "payload")?.type.name).toBe("Bytes");

    // ToolResult — record with 5 fields
    const tool = model.decls.find((d) => d.name === "ToolResult");
    expect(tool?.kind).toBe("record");
    expect(tool?.kind === "record" ? tool.fields.length : 0).toBe(5);

    // GenericBox<T> — has generics
    const box = model.decls.find((d) => d.name === "GenericBox");
    expect(box?.kind).toBe("record");
    expect(box?.generics).toContain("T");
    const boxFields = box?.kind === "record" ? box.fields : [];
    expect(boxFields.find((f) => f.name === "value")?.type.name).toBe("T");
    expect(boxFields.find((f) => f.name === "label")?.type.name).toBe("String");

    // Pair<A, B> — two generics
    const pair = model.decls.find((d) => d.name === "Pair");
    expect(pair?.generics).toContain("A");
    expect(pair?.generics).toContain("B");

    // ContentItem — discriminated union with 4 variants, mixed payloads
    const ci = model.decls.find((d) => d.name === "ContentItem");
    expect(ci?.kind).toBe("union");
    const ciVariants = ci?.kind === "union" ? ci.variants : [];
    expect(ciVariants).toHaveLength(4);
    expect(ciVariants[0]?.name).toBe("Text");
    expect(ciVariants[0]?.fields).toHaveLength(2);
    expect(ciVariants[0]?.fields[0]?.name).toBe("body");
    expect(ciVariants[1]?.name).toBe("Image");
    expect(ciVariants[1]?.fields).toHaveLength(3);
    expect(ciVariants[2]?.name).toBe("Code");
    expect(ciVariants[2]?.fields).toHaveLength(2);
    expect(ciVariants[3]?.name).toBe("Divider");
    expect(ciVariants[3]?.fields).toHaveLength(0);

    // Status — string literal union → alias
    expect(model.decls.find((d) => d.name === "Status")?.kind).toBe("alias");

    // Shape — union of type names
    const shape = model.decls.find((d) => d.name === "Shape");
    expect(shape?.kind).toBe("union");
    expect(shape?.kind === "union" ? shape.variants.length : 0).toBe(3);

    // Email — simple alias
    expect(model.decls.find((d) => d.name === "Email")?.kind).toBe("alias");

    // IdList — alias to Array<string>
    const idList = model.decls.find((d) => d.name === "IdList");
    expect(idList?.kind).toBe("alias");

    // NullableFields — `T | null` and `T | undefined` become Option<T>.
    const nullable = model.decls.find((d) => d.name === "NullableFields");
    expect(nullable?.kind).toBe("record");
    const nfFields = nullable?.kind === "record" ? nullable.fields : [];
    const nameField = nfFields.find((f) => f.name === "name");
    expect(nameField?.type.name).toBe("Option");
    expect(nameField?.type.args[0]?.name).toBe("String");
    const emailField = nfFields.find((f) => f.name === "email");
    expect(emailField?.type.name).toBe("Option");
    expect(emailField?.type.args[0]?.name).toBe("String");
    // Non-nullable sibling stays unwrapped.
    expect(nfFields.find((f) => f.name === "age")?.type.name).toBe("Int");
  });

  it("returns error on input with only functions, classes, and constants", () => {
    const src = `
function foo() { return 42; }
class Bar { baz() {} }
const X = 1;
export default function main() {}
`;
    expect(typescript.fromSource(src).ok).toBe(false);
  });
});

describe("[CONV-TS-TO-COMPLEX] complex typeDiagram -> TypeScript", () => {
  it("emits a big model with records, unions, aliases, generics, and all primitive types", () => {
    const td = `
type ChatRequest {
  message: String
  session_id: String
  tool_results: List<ToolResult>
  metadata: Map<String, String>
  debug: Bool
  timeout: Int
  score: Float
  payload: Bytes
  nothing: Unit
}

type ToolResult {
  tool_call_id: String
  name: String
  ok: Bool
}

type GenericBox<T> {
  value: T
  label: String
}

union ContentItem {
  Text { body: String, format: String }
  Image { url: String, width: Int, height: Int }
  Divider
}

union Direction { North\n South\n East\n West }

alias Email = String
alias Wrapper<T> = List<T>
`;
    const model = unwrap(buildModel(unwrap(parse(td))));
    const output = typescript.toSource(model);

    // ChatRequest — interface with all type mappings
    expect(output).toContain("export interface ChatRequest");
    expect(output).toContain("message: string");
    expect(output).toContain("tool_results: Array<ToolResult>");
    expect(output).toContain("metadata: Map<string, string>");
    expect(output).toContain("debug: boolean");
    expect(output).toContain("timeout: number");
    expect(output).toContain("score: number");
    expect(output).toContain("payload: Uint8Array");
    expect(output).toContain("nothing: void");

    // ToolResult — interface
    expect(output).toContain("export interface ToolResult");
    expect(output).toContain("ok: boolean");

    // GenericBox<T>
    expect(output).toContain("export interface GenericBox<T>");
    expect(output).toContain("value: T");

    // ContentItem — discriminated union
    expect(output).toContain("export type ContentItem");
    expect(output).toContain('kind: "Text"');
    expect(output).toContain("body: string");
    expect(output).toContain("format: string");
    expect(output).toContain('kind: "Image"');
    expect(output).toContain("url: string");
    expect(output).toContain("width: number");
    expect(output).toContain("height: number");
    expect(output).toContain('kind: "Divider"');

    // Direction — all unit variants
    expect(output).toContain("export type Direction");
    expect(output).toContain('kind: "North"');
    expect(output).toContain('kind: "South"');
    expect(output).toContain('kind: "East"');
    expect(output).toContain('kind: "West"');

    // Aliases
    expect(output).toContain("export type Email = string");
    expect(output).toContain("export type Wrapper<T> = Array<T>");

    // Ordering: ChatRequest before ToolResult before GenericBox
    expect(output.indexOf("ChatRequest")).toBeLessThan(output.indexOf("ToolResult"));
    expect(output.indexOf("ToolResult")).toBeLessThan(output.indexOf("GenericBox"));
  });
});

describe("[CONV-TS-RT] TypeScript round-trip TD -> TS -> TD", () => {
  it("round-trips a complex model preserving structure", () => {
    const td = `
type User {
  name: String
  age: Int
  active: Bool
}

type Order {
  id: String
  total: Float
}

union Shape {
  Circle { radius: Float }
  Rect { w: Float, h: Float }
  Point
}

alias Tag = String
`;
    const model1 = unwrap(buildModel(unwrap(parse(td))));
    const tsCode = typescript.toSource(model1);
    const model2 = unwrap(typescript.fromSource(tsCode));

    expect(model2.decls).toHaveLength(4);

    const user = model2.decls.find((d) => d.name === "User");
    expect(user?.kind).toBe("record");
    expect(user?.kind === "record" ? user.fields.length : 0).toBe(3);

    const order = model2.decls.find((d) => d.name === "Order");
    expect(order?.kind).toBe("record");
    expect(order?.kind === "record" ? order.fields.length : 0).toBe(2);

    const shape = model2.decls.find((d) => d.name === "Shape");
    expect(shape?.kind).toBe("union");
    const variants = shape?.kind === "union" ? shape.variants : [];
    expect(variants).toHaveLength(3);
    expect(variants[0]?.name).toBe("Circle");
    expect(variants[0]?.fields).toHaveLength(1);
    expect(variants[1]?.name).toBe("Rect");
    expect(variants[1]?.fields).toHaveLength(2);
    expect(variants[2]?.name).toBe("Point");
    expect(variants[2]?.fields).toHaveLength(0);

    expect(model2.decls.find((d) => d.name === "Tag")?.kind).toBe("alias");
  });
});

describe("[CONV-TS-RT] TypeScript round-trip TD -> TS -> TD", () => {
  it("losslessly round-trips the home-page example through TypeScript (TD text preserved)", () => {
    expectLosslessRoundTrip(typescript);
  });
});
