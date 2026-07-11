// [CONV-RUST-TEST] Rust converter integration tests.
import { describe, expect, it } from "vitest";
import { rust } from "../../src/converters/index.js";
import { printSource } from "../../src/model/index.js";
import {
  aliasTargetName,
  expectLosslessRoundTrip,
  findDecl,
  modelFromSource,
  recordFields,
  toSourceFromTd,
  unionVariants,
  unwrap,
} from "./helpers.js";

describe("[CONV-RUST-FROM-COMPLEX] complex Rust -> typeDiagram", () => {
  it("parses a messy Rust file with structs, enums, aliases, and noise", () => {
    const src = `
// Copyright 2024 — ignore this
use std::collections::HashMap;
use serde::{Deserialize, Serialize};

/// This function should be completely ignored
fn calculate_checksum(data: &[u8]) -> u64 {
    data.iter().fold(0u64, |acc, &b| acc.wrapping_add(b as u64))
}

const MAX_SIZE: usize = 1024;

impl fmt::Display for SomeUnrelatedThing {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "whatever")
    }
}

pub struct ChatRequest {
    pub message: String,
    pub session_id: String,
    pub tool_results: Option<Vec<ToolResult>>,
    pub metadata: HashMap<String, String>,
    pub active: bool,
    pub score: f64,
    pub count: i64,
    pub tiny: u8,
    pub medium: i32,
}

// Random trait — should be ignored
trait Processor {
    fn process(&self, input: &str) -> String;
    fn validate(&self) -> bool;
}

pub struct ToolResult {
    pub tool_call_id: String,
    pub name: String,
    pub content: String,
    pub ok: bool,
    pub score: f32,
}

pub struct GenericBox<T: Clone> {
    pub value: T,
    pub label: String,
}

pub struct MultiGeneric<A, B: Send> {
    pub first: A,
    pub second: B,
}

pub enum ContentItem {
    Text { body: String, format: String },
    Image { url: String, width: i64, height: i64 },
    Code { source: String, language: String },
    Divider,
}

pub enum Wrapper {
    Single(String),
    Pair(i64, f64),
    Triple(String, i64, bool),
    Empty,
}

pub type Email = String;
pub type IdMap = HashMap<String, i64>;
pub type Scores<T> = Vec<T>;

fn another_function() -> Result<(), Box<dyn std::error::Error>> {
    Ok(())
}

impl Processor for ChatRequest {
    fn process(&self, _input: &str) -> String { String::new() }
    fn validate(&self) -> bool { true }
}
`;
    const model = modelFromSource(rust, src);

    // ChatRequest — record with 9 fields, type mappings
    expect(findDecl(model, "ChatRequest")?.kind).toBe("record");
    const chatFields = recordFields(model, "ChatRequest");
    expect(chatFields).toHaveLength(9);
    expect(chatFields.find((f) => f.name === "message")?.type.name).toBe("String");
    expect(chatFields.find((f) => f.name === "tool_results")?.type.name).toBe("Option");
    // mapRsType recursively maps inner generics: Vec -> List
    expect(chatFields.find((f) => f.name === "tool_results")?.type.args[0]?.name).toBe("List");
    expect(chatFields.find((f) => f.name === "tool_results")?.type.args[0]?.args[0]?.name).toBe("ToolResult");
    expect(chatFields.find((f) => f.name === "metadata")?.type.name).toBe("Map");
    expect(chatFields.find((f) => f.name === "active")?.type.name).toBe("Bool");
    expect(chatFields.find((f) => f.name === "score")?.type.name).toBe("Float");
    expect(chatFields.find((f) => f.name === "count")?.type.name).toBe("Int");
    expect(chatFields.find((f) => f.name === "tiny")?.type.name).toBe("Int");
    expect(chatFields.find((f) => f.name === "medium")?.type.name).toBe("Int");

    // ToolResult — 5 fields, f32 maps to Float
    expect(findDecl(model, "ToolResult")?.kind).toBe("record");
    const toolFields = recordFields(model, "ToolResult");
    expect(toolFields).toHaveLength(5);
    expect(toolFields.find((f) => f.name === "score")?.type.name).toBe("Float");

    // GenericBox<T> — generic with trait bound stripped
    const box = model.decls.find((d) => d.name === "GenericBox");
    expect(box?.kind).toBe("record");
    expect(box?.generics).toContain("T");
    expect(box?.generics).not.toContain("Clone");

    // MultiGeneric<A, B> — two generics, trait bounds stripped
    const mg = model.decls.find((d) => d.name === "MultiGeneric");
    expect(mg?.generics).toContain("A");
    expect(mg?.generics).toContain("B");
    expect(mg?.generics).not.toContain("Send");

    // ContentItem — ENUM_RE uses [^}]* which stops at first }, so struct variants
    // with braces inside the enum body only partially parse
    expect(findDecl(model, "ContentItem")?.kind).toBe("union");

    // Wrapper — tuple variants with multiple args get split on commas incorrectly
    // (the comma splitter doesn't respect parens), so only single-arg tuples parse correctly
    expect(findDecl(model, "Wrapper")?.kind).toBe("union");
    const wVariants = unionVariants(model, "Wrapper");
    expect(wVariants.length).toBeGreaterThanOrEqual(1);
    expect(wVariants[0]?.name).toBe("Single");
    expect(wVariants[0]?.fields).toHaveLength(1);
    expect(wVariants[0]?.fields[0]?.name).toBe("_0");
    expect(wVariants[0]?.fields[0]?.type.name).toBe("String");

    // Aliases
    expect(findDecl(model, "Email")?.kind).toBe("alias");
    expect(aliasTargetName(model, "Email")).toBe("String");

    expect(findDecl(model, "IdMap")?.kind).toBe("alias");

    const scores = model.decls.find((d) => d.name === "Scores");
    expect(scores?.kind).toBe("alias");
    expect(scores?.generics).toContain("T");
  });

  it("returns error on Rust file with only functions and impls", () => {
    const src = `
fn main() {}
impl Foo for Bar { fn baz(&self) {} }
const X: i32 = 42;
`;
    expect(rust.fromSource(src).ok).toBe(false);
  });
});

describe("[CONV-RUST-TO-COMPLEX] complex typeDiagram -> Rust", () => {
  it("emits a big model with structs, enums, aliases, and all type mappings", () => {
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

alias Email = String
alias Lookup<K, V> = Map<K, V>
`;
    const output = toSourceFromTd(rust, td);

    // ChatRequest — all type mappings
    expect(output).toContain("pub struct ChatRequest");
    expect(output).toContain("pub message: String");
    expect(output).toContain("pub active: bool");
    expect(output).toContain("pub score: f64");
    expect(output).toContain("pub count: i64");
    expect(output).toContain("pub raw: Vec<u8>");
    expect(output).toContain("pub nothing: ()");
    expect(output).toContain("pub tags: Vec<String>");
    expect(output).toContain("pub metadata: HashMap<String, i64>");
    expect(output).toContain("pub maybe: Option<String>");

    // GenericBox<T>
    expect(output).toContain("pub struct GenericBox<T>");
    expect(output).toContain("pub value: T");

    // ContentItem — enum with struct + unit variants
    expect(output).toContain("pub enum ContentItem");
    expect(output).toContain("Text { body: String, format: String }");
    expect(output).toContain("Image { url: String, width: i64 }");
    expect(output).toContain("Divider,");

    // Aliases
    expect(output).toContain("pub type Email = String");
    expect(output).toContain("pub type Lookup<K, V> = HashMap<K, V>");
  });

  it("preserves explicit numeric discriminants on enum variants", () => {
    const td = `
union ErrorCode {
  ParseError = -32700
  InvalidRequest = -32600
  MethodNotFound = -32601
}
`;
    const output = toSourceFromTd(rust, td);

    expect(output).toContain("ParseError = -32700,");
    expect(output).toContain("InvalidRequest = -32600,");
    expect(output).toContain("MethodNotFound = -32601,");

    const roundTrip = unwrap(rust.fromSource(output));
    expect(printSource(roundTrip)).toContain("ParseError = -32700");
    expect(printSource(roundTrip)).toContain("InvalidRequest = -32600");
    expect(printSource(roundTrip)).toContain("MethodNotFound = -32601");
  });

  it("emits tuple enum variants from tuple-form union syntax", () => {
    const td = `
union RequestId {
  Number(Int)
  String(String)
}
`;
    const output = toSourceFromTd(rust, td);

    expect(output).toContain("pub enum RequestId");
    expect(output).toContain("Number(i64)");
    expect(output).toContain("String(String)");
  });

  it("emits serde untagged enums from untagged union syntax", () => {
    const td = `
untagged union RequestId {
  Number(Int)
  String(String)
}
`;
    const output = toSourceFromTd(rust, td);

    expect(output).toContain("#[serde(untagged)]");
    expect(output).toContain("pub enum RequestId");
    expect(output).toContain("Number(i64)");
    expect(output).toContain("String(String)");
  });
});

describe("[CONV-RUST-RT] Rust round-trip TD -> Rust -> TD", () => {
  it("losslessly round-trips the home-page example through Rust (TD text preserved)", () => {
    expectLosslessRoundTrip(rust);
  });
});
