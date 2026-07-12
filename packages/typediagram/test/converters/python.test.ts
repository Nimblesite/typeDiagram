// [CONV-PY-TEST] Python converter integration tests.
import { describe, expect, it } from "vitest";
import { python } from "../../src/converters/index.js";
import {
  expectFieldTypes,
  expectLosslessRoundTrip,
  findDecl,
  modelFromSource,
  recordFields,
  toSourceFromTd,
  unionVariants,
} from "./helpers.js";

describe("[CONV-PY-FROM-COMPLEX] complex Python -> typeDiagram", () => {
  it("parses a messy real-world file with dataclasses, enums, TypedDicts, and noise", () => {
    const src = `
#!/usr/bin/env python3
"""Module docstring — should be totally ignored."""

import os
import sys
from typing import Optional, List, Dict, Set, Tuple
from dataclasses import dataclass, field
from enum import Enum

# Constants
API_URL = "https://example.com"
MAX_RETRIES = 3
DEBUG = False

def calculate_total(items: list[float]) -> float:
    """Calculate the total price of items."""
    return sum(items)

class DatabaseConnection:
    """Plain class with methods — should be completely ignored."""
    def __init__(self, url: str):
        self.url = url

    async def connect(self):
        pass

    def disconnect(self):
        pass

    @property
    def is_connected(self) -> bool:
        return False

@dataclass
class ChatRequest:
    message: str
    session_id: str
    tool_results: Optional[list[ToolResult]]
    metadata: dict[str, str]
    tags: list[str]
    active: bool
    score: float
    raw: bytes

async def fetch_user(user_id: int) -> dict:
    """Async function — noise."""
    return {}

@dataclass
class ToolResult:
    tool_call_id: str  # inline comment should be stripped
    name: str
    content: str
    ok: bool = False  # default value should be stripped

class Direction(str, Enum):
    NORTH = "north"
    SOUTH = "south"
    EAST = "east"
    WEST = "west"

lambda_fn = lambda x: x * 2

class Config(TypedDict):
    host: str
    port: int
    debug: bool

class Logger:
    """Another plain class to ignore."""
    level: str = "INFO"
    def log(self, msg: str):
        print(msg)

@dataclass
class GenericContainer:
    items: List[str]
    lookup: Dict[str, int]
    unique: Set[str]
    pair: Tuple[int, str]

class HttpStatus(Enum):
    OK = 200
    NOT_FOUND = 404
    SERVER_ERROR = 500

# Trailing noise
CONSTANT = 42
`;
    const model = modelFromSource(python, src);

    // Should NOT have parsed plain classes
    expect(findDecl(model, "DatabaseConnection")).toBeUndefined();
    expect(findDecl(model, "Logger")).toBeUndefined();

    // ChatRequest — record with 8 fields, type mappings
    expect(findDecl(model, "ChatRequest")?.kind).toBe("record");
    const chatFields = recordFields(model, "ChatRequest");
    expect(chatFields).toHaveLength(8);
    expectFieldTypes(chatFields, {
      message: "String",
      session_id: "String",
      tool_results: "Option<List<ToolResult>>",
      metadata: "Map<String, String>",
      tags: "List<String>",
      active: "Bool",
      score: "Float",
      raw: "Bytes",
    });

    // ToolResult — record, defaults/comments stripped
    expect(findDecl(model, "ToolResult")?.kind).toBe("record");
    const toolFields = recordFields(model, "ToolResult");
    expect(toolFields).toHaveLength(4);
    expect(toolFields.find((f) => f.name === "ok")?.type.name).toBe("Bool");

    // Direction — union from str Enum
    expect(findDecl(model, "Direction")?.kind).toBe("union");
    const dirVariants = unionVariants(model, "Direction");
    expect(dirVariants).toHaveLength(4);
    expect(dirVariants[0]?.name).toBe("NORTH");
    expect(dirVariants[3]?.name).toBe("WEST");

    // Config — TypedDict parsed as record
    expect(findDecl(model, "Config")?.kind).toBe("record");
    const cfgFields = recordFields(model, "Config");
    expectFieldTypes(cfgFields, { host: "String", port: "Int", debug: "Bool" });

    // GenericContainer — capital List, Dict, Set, Tuple
    expect(findDecl(model, "GenericContainer")?.kind).toBe("record");
    const gcFields = recordFields(model, "GenericContainer");
    expectFieldTypes(gcFields, {
      items: "List<String>",
      lookup: "Map<String, Int>",
      unique: "List<String>",
      pair: "List<Int, String>",
    });

    // HttpStatus — Enum without str mixin
    expect(findDecl(model, "HttpStatus")?.kind).toBe("union");
    expect(unionVariants(model, "HttpStatus")).toHaveLength(3);
  });

  it("returns error on input with only plain classes and functions", () => {
    const src = `
class Foo:
    def bar(self):
        pass

def baz():
    return 42

CONSTANT = "hello"
`;
    expect(python.fromSource(src).ok).toBe(false);
  });
});

describe("[CONV-PY-TO-COMPLEX] complex typeDiagram -> Python", () => {
  it("emits a big model with records, unions, aliases, and all primitives", () => {
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

type ToolResult {
  name: String
  ok: Bool
}

union ContentItem {
  Text { body: String, format: String }
  Image { url: String, width: Int }
  Divider
}

union Color { Red\n Green\n Blue }

alias Email = String
`;
    const output = toSourceFromTd(python, td);

    // Imports
    expect(output).toContain("from __future__ import annotations");
    expect(output).toContain("from dataclasses import dataclass");
    expect(output).toContain("from enum import Enum");
    expect(output).toContain("from typing import Optional");

    // ChatRequest — all type mappings
    expect(output).toContain("@dataclass");
    expect(output).toContain("class ChatRequest:");
    expect(output).toContain("message: str");
    expect(output).toContain("active: bool");
    expect(output).toContain("score: float");
    expect(output).toContain("count: int");
    expect(output).toContain("raw: bytes");
    expect(output).toContain("nothing: None");
    expect(output).toContain("tags: list[str]");
    expect(output).toContain("metadata: dict[str, int]");
    expect(output).toContain("maybe: Optional[str]");

    // ToolResult
    expect(output).toContain("class ToolResult:");
    expect(output).toContain("name: str");
    expect(output).toContain("ok: bool");

    // ContentItem — mixed union: dataclasses for payload variants (prefixed), type alias
    expect(output).toContain("class ContentItemText:");
    expect(output).toContain("body: str");
    expect(output).toContain("format: str");
    expect(output).toContain("class ContentItemImage:");
    expect(output).toContain("url: str");
    expect(output).toContain("width: int");
    expect(output).toContain("ContentItem =");

    // Color — pure enum
    expect(output).toContain("class Color(str, Enum):");
    expect(output).toContain('Red = "red"');
    expect(output).toContain('Green = "green"');
    expect(output).toContain('Blue = "blue"');

    // Alias
    expect(output).toContain("Email = str");
  });
});

describe("[CONV-PY-RT] Python round-trip TD -> PY -> TD", () => {
  it("round-trips records and enums preserving structure", () => {
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

union Color { Red\n Green\n Blue }
`;
    const pyCode = toSourceFromTd(python, td);
    const model2 = modelFromSource(python, pyCode);

    // 3 decls survived the trip
    expect(model2.decls).toHaveLength(3);

    expect(findDecl(model2, "User")?.kind).toBe("record");
    const userFields = recordFields(model2, "User");
    expect(userFields).toHaveLength(3);
    expect(userFields[0]?.type.name).toBe("String");
    expect(userFields[1]?.type.name).toBe("Int");
    expect(userFields[2]?.type.name).toBe("Bool");

    expect(findDecl(model2, "Order")?.kind).toBe("record");
    expect(recordFields(model2, "Order")).toHaveLength(2);

    expect(findDecl(model2, "Color")?.kind).toBe("union");
    expect(unionVariants(model2, "Color")).toHaveLength(3);
  });
});

describe("[CONV-PY-BUG-6] pydantic style emits BaseModel, not dataclass", () => {
  it("emits pydantic.BaseModel subclasses when style=pydantic", () => {
    const td = `
type ChatRequest {
  message: Option<String>
  session_id: Option<String>
  tags: List<String>
  metadata: Map<String, Int>
}
`;
    const out = toSourceFromTd(python, td, { style: "pydantic" });

    expect(out).toContain("from pydantic import BaseModel");
    expect(out).toContain("from pydantic import Field");
    expect(out).toContain("class ChatRequest(BaseModel):");
    expect(out).not.toContain("@dataclass");
    expect(out).toContain("message: str | None = None");
    expect(out).toContain("session_id: str | None = None");
    expect(out).toContain("tags: list[str] = Field(default_factory=list)");
    expect(out).toContain("metadata: dict[str, int] = Field(default_factory=dict)");
  });
});

describe("[CONV-PY-BUG-7] Any is imported when used", () => {
  it("imports Any from typing when alias references Any", () => {
    const td = `
alias Json = Map<String, Any>

type ToolCallOut {
  arguments: Json
}
`;
    const out = toSourceFromTd(python, td);

    expect(out).toContain("Any");
    expect(out).toMatch(/from typing import[^\n]*\bAny\b/);
  });

  it("does not import Any when unused", () => {
    const td = `
type Simple {
  name: String
}
`;
    const out = toSourceFromTd(python, td);
    expect(out).not.toMatch(/from typing import[^\n]*\bAny\b/);
  });
});

describe("[CONV-PY-BUG-8] union payload variants prefixed with parent name", () => {
  it("prefixes payload variant class names with union name", () => {
    const td = `
union ContentItem {
  Text  { part: String }
  Url   { part: String }
  Str   { value: String }
}
`;
    const out = toSourceFromTd(python, td);

    expect(out).toContain("class ContentItemText:");
    expect(out).toContain("class ContentItemUrl:");
    expect(out).toContain("class ContentItemStr:");
    expect(out).not.toMatch(/^class Text:/m);
    expect(out).not.toMatch(/^class Url:/m);
    expect(out).not.toMatch(/^class Str:/m);
    expect(out).toContain("ContentItem = ContentItemText | ContentItemUrl | ContentItemStr");
  });
});

describe("[CONV-PY-BUG-9] Optional fields default to None in dataclass", () => {
  it("appends = None to Optional fields", () => {
    const td = `
type ChatRequest {
  message:      Option<String>
  session_id:   Option<String>
  tool_results: Option<List<String>>
}
`;
    const out = toSourceFromTd(python, td);

    expect(out).toContain("message: Optional[str] = None");
    expect(out).toContain("session_id: Optional[str] = None");
    expect(out).toContain("tool_results: Optional[list[str]] = None");
  });

  it("uses default_factory for List and Map required fields", () => {
    const td = `
type Req {
  tags: List<String>
  meta: Map<String, Int>
}
`;
    const out = toSourceFromTd(python, td);

    expect(out).toContain("from dataclasses import dataclass, field");
    expect(out).toContain("tags: list[str] = field(default_factory=list)");
    expect(out).toContain("meta: dict[str, int] = field(default_factory=dict)");
  });
});

describe("[CONV-PY-RT] Python round-trip TD -> Python -> TD", () => {
  it("losslessly round-trips the home-page example through Python (TD text preserved)", () => {
    expectLosslessRoundTrip(python);
  });
});
