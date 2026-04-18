// [CONV-FS-TEST] F# converter integration tests.
import { describe, expect, it } from "vitest";
import { fsharp } from "../../src/converters/index.js";
import { parse } from "../../src/parser/index.js";
import { buildModel } from "../../src/model/index.js";
import { expectLosslessRoundTrip, unwrap } from "./helpers.js";

describe("[CONV-FS-FROM-COMPLEX] complex F# -> typeDiagram", () => {
  it("parses a messy F# file with records, DUs, abbreviations, and noise", () => {
    const src = `
// Copyright 2024 Acme Corp
module Acme.Domain

open System

let apiUrl = "https://example.com"
let maxRetries = 3

let calculateTotal (items: float list) = List.sum items

type ChatRequest = {
    message: string
    session_id: string
    tool_results: ToolResult list option
    metadata: Map<string, string>
    tags: string list
    active: bool
    score: float
}

let noop () = ()

type ToolResult = {
    tool_call_id: string
    name: string
    content: string
    ok: bool
    score: float
}

type GenericBox<'T> = {
    value: 'T
    label: string
}

type Pair<'A, 'B> = {
    first: 'A
    second: 'B
}

type ContentItem =
    | Text of body: string * format: string
    | Image of url: string * width: int
    | Code of source: string
    | Divider

type Direction =
    | North
    | South
    | East
    | West

type Email = string
`;
    const model = unwrap(fsharp.fromSource(src));

    // ChatRequest — record with 7 fields, type mappings
    const chat = model.decls.find((d) => d.name === "ChatRequest");
    expect(chat?.kind).toBe("record");
    const chatFields = chat?.kind === "record" ? chat.fields : [];
    expect(chatFields).toHaveLength(7);
    expect(chatFields.find((f) => f.name === "message")?.type.name).toBe("String");
    expect(chatFields.find((f) => f.name === "tool_results")?.type.name).toBe("Option");
    expect(chatFields.find((f) => f.name === "tool_results")?.type.args[0]?.name).toBe("List");
    expect(chatFields.find((f) => f.name === "tool_results")?.type.args[0]?.args[0]?.name).toBe("ToolResult");
    expect(chatFields.find((f) => f.name === "tags")?.type.name).toBe("List");
    expect(chatFields.find((f) => f.name === "tags")?.type.args[0]?.name).toBe("String");
    expect(chatFields.find((f) => f.name === "active")?.type.name).toBe("Bool");
    expect(chatFields.find((f) => f.name === "score")?.type.name).toBe("Float");

    // ToolResult — record with 5 fields
    const tool = model.decls.find((d) => d.name === "ToolResult");
    expect(tool?.kind).toBe("record");
    expect(tool?.kind === "record" ? tool.fields.length : 0).toBe(5);

    // GenericBox<T> — generics with tick stripped
    const box = model.decls.find((d) => d.name === "GenericBox");
    expect(box?.kind).toBe("record");
    expect(box?.generics).toContain("T");
    expect(box?.generics).not.toContain("'T");

    // Pair<A, B>
    const pair = model.decls.find((d) => d.name === "Pair");
    expect(pair?.generics).toContain("A");
    expect(pair?.generics).toContain("B");

    // ContentItem — DU with mixed variants
    const ci = model.decls.find((d) => d.name === "ContentItem");
    expect(ci?.kind).toBe("union");
    const ciVariants = ci?.kind === "union" ? ci.variants : [];
    expect(ciVariants).toHaveLength(4);
    expect(ciVariants[0]?.name).toBe("Text");
    expect(ciVariants[0]?.fields).toHaveLength(2);
    expect(ciVariants[0]?.fields[0]?.name).toBe("body");
    expect(ciVariants[0]?.fields[0]?.type.name).toBe("String");
    expect(ciVariants[1]?.name).toBe("Image");
    expect(ciVariants[1]?.fields).toHaveLength(2);
    expect(ciVariants[2]?.name).toBe("Code");
    expect(ciVariants[2]?.fields).toHaveLength(1);
    expect(ciVariants[3]?.name).toBe("Divider");
    expect(ciVariants[3]?.fields).toHaveLength(0);

    // Direction — all unit variants
    const dir = model.decls.find((d) => d.name === "Direction");
    expect(dir?.kind).toBe("union");
    expect(dir?.kind === "union" ? dir.variants.length : 0).toBe(4);

    // Email — type abbreviation
    const email = model.decls.find((d) => d.name === "Email");
    expect(email?.kind).toBe("alias");
    expect(email?.kind === "alias" ? email.target.name : "").toBe("String");
  });

  it("returns error on F# with only let bindings and functions", () => {
    const src = `
module Foo

let x = 42
let add a b = a + b
`;
    expect(fsharp.fromSource(src).ok).toBe(false);
  });
});

describe("[CONV-FS-TO-COMPLEX] complex typeDiagram -> F#", () => {
  it("emits a big model with records, unions, aliases, and all type mappings", () => {
    const td = `
type ChatRequest {
  message: String
  active: Bool
  score: Float
  count: Int
  raw: Bytes
  nothing: Unit
  tags: List<String>
  metadata: Map<String, Int>
  maybe: Option<String>
}

type GenericBox<T> {
  value: T
  label: String
}

union ContentItem {
  Text { body: String, format: String }
  Image { url: String, width: Int }
  Divider
}

union Direction { North\n South\n East\n West }

alias Email = String
`;
    const model = unwrap(buildModel(unwrap(parse(td))));
    const output = fsharp.toSource(model);

    // ChatRequest — all type mappings, postfix list/option
    expect(output).toContain("type ChatRequest = {");
    expect(output).toContain("message: string");
    expect(output).toContain("active: bool");
    expect(output).toContain("score: float");
    expect(output).toContain("count: int");
    expect(output).toContain("raw: byte[]");
    expect(output).toContain("nothing: unit");
    expect(output).toContain("tags: string list");
    expect(output).toContain("metadata: Map<string, int>");
    expect(output).toContain("maybe: string option");

    // GenericBox<'T>
    expect(output).toContain("type GenericBox<'T> = {");
    expect(output).toContain("value: T");

    // ContentItem — DU with variants
    expect(output).toContain("type ContentItem =");
    expect(output).toContain("| Text of");
    expect(output).toContain("body: string");
    expect(output).toContain("| Image of");
    expect(output).toContain("| Divider");

    // Direction — all unit variants
    expect(output).toContain("type Direction =");
    expect(output).toContain("| North");
    expect(output).toContain("| South");
    expect(output).toContain("| East");
    expect(output).toContain("| West");

    // Alias
    expect(output).toContain("type Email = string");
  });
});

describe("[CONV-FS-RT] F# round-trip TD -> F# -> TD", () => {
  it("losslessly round-trips the home-page example through F# (TD text preserved)", () => {
    expectLosslessRoundTrip(fsharp);
  });
});
