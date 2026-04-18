// [CONV-CS-TEST] C# converter integration tests.
import { describe, expect, it } from "vitest";
import { csharp } from "../../src/converters/index.js";
import { parse } from "../../src/parser/index.js";
import { buildModel } from "../../src/model/index.js";
import { unwrap } from "./helpers.js";

describe("[CONV-CS-FROM-COMPLEX] complex C# -> typeDiagram", () => {
  it("parses a messy C# file with records, classes, enums, and noise", () => {
    const src = `
// Copyright 2024 Acme Corp
using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Threading.Tasks;

namespace Acme.Domain;

/// <summary>Helper method — should be ignored completely.</summary>
public static class Extensions
{
    public static string ToJson(this object obj) => JsonSerializer.Serialize(obj);
}

public record ChatRequest(
    string Message,
    string SessionId,
    List<ToolResult> ToolResults,
    bool Active,
    double Score,
    int Count
);

// Middleware class — noise
public class RequestMiddleware
{
    public async Task InvokeAsync(HttpContext context) { }
    private void LogRequest(string path) { }
}

public record ToolResult(
    string ToolCallId,
    string Name,
    string Content,
    bool Ok
);

public record GenericBox<T>(
    T Value,
    string Label
);

public record Pair<A, B>(
    A First,
    B Second
);

public record NullableFields(
    int? MaybeInt,
    string? MaybeName,
    double Value
);

public class Config {
    public string Host { get; set; }
    public int Port { get; set; }
    public bool Debug { get; set; }
}

public class GenericContainer<T> {
    public T Value { get; set; }
    public string Label { get; set; }
}

public enum ContentType {
    Text,
    Image,
    // A comment inside enum
    Code,
    Divider
}

public enum HttpStatus {
    Ok = 200,
    NotFound = 404,
    ServerError = 500
}

enum InternalStatus { Active, Inactive }

// Static helper — noise
public static int ComputeHash(string input) => input.GetHashCode();
`;
    const model = unwrap(csharp.fromSource(src));

    // ChatRequest — record with 6 params
    const chat = model.decls.find((d) => d.name === "ChatRequest");
    expect(chat?.kind).toBe("record");
    const chatFields = chat?.kind === "record" ? chat.fields : [];
    expect(chatFields).toHaveLength(6);
    expect(chatFields.find((f) => f.name === "Message")?.type.name).toBe("String");
    expect(chatFields.find((f) => f.name === "SessionId")?.type.name).toBe("String");
    expect(chatFields.find((f) => f.name === "ToolResults")?.type.name).toBe("List");
    expect(chatFields.find((f) => f.name === "Active")?.type.name).toBe("Bool");
    expect(chatFields.find((f) => f.name === "Score")?.type.name).toBe("Float");
    expect(chatFields.find((f) => f.name === "Count")?.type.name).toBe("Int");

    // ToolResult — 4 fields
    const tool = model.decls.find((d) => d.name === "ToolResult");
    expect(tool?.kind).toBe("record");
    expect(tool?.kind === "record" ? tool.fields.length : 0).toBe(4);

    // GenericBox<T>
    const box = model.decls.find((d) => d.name === "GenericBox");
    expect(box?.kind).toBe("record");
    expect(box?.generics).toContain("T");
    const boxFields = box?.kind === "record" ? box.fields : [];
    expect(boxFields).toHaveLength(2);
    expect(boxFields[0]?.name).toBe("Value");

    // Pair<A, B>
    const pair = model.decls.find((d) => d.name === "Pair");
    expect(pair?.generics).toContain("A");
    expect(pair?.generics).toContain("B");

    // NullableFields — nullable types stripped
    const nullable = model.decls.find((d) => d.name === "NullableFields");
    expect(nullable?.kind).toBe("record");
    expect(nullable?.kind === "record" ? nullable.fields.length : 0).toBe(3);

    // Config — class with property-bag fields is captured with balanced-brace parser
    const cfg = model.decls.find((d) => d.name === "Config");
    expect(cfg?.kind).toBe("record");
    const cfgFields = cfg?.kind === "record" ? cfg.fields : [];
    expect(cfgFields).toHaveLength(3);
    expect(cfgFields.find((f) => f.name === "Host")?.type.name).toBe("String");
    expect(cfgFields.find((f) => f.name === "Port")?.type.name).toBe("Int");
    expect(cfgFields.find((f) => f.name === "Debug")?.type.name).toBe("Bool");

    // GenericContainer<T> — property-bag class with fields captured
    const gc = model.decls.find((d) => d.name === "GenericContainer");
    expect(gc?.kind).toBe("record");
    expect(gc?.generics).toContain("T");
    const gcFields = gc?.kind === "record" ? gc.fields : [];
    expect(gcFields).toHaveLength(2);

    // ContentType — enum with 4 variants (comment line ignored)
    const ct = model.decls.find((d) => d.name === "ContentType");
    expect(ct?.kind).toBe("union");
    const ctVariants = ct?.kind === "union" ? ct.variants : [];
    expect(ctVariants).toHaveLength(4);
    expect(ctVariants[0]?.name).toBe("Text");
    expect(ctVariants[3]?.name).toBe("Divider");

    // HttpStatus — enum with assigned values, values stripped
    const hs = model.decls.find((d) => d.name === "HttpStatus");
    expect(hs?.kind).toBe("union");
    const hsVariants = hs?.kind === "union" ? hs.variants : [];
    expect(hsVariants).toHaveLength(3);
    expect(hsVariants[0]?.name).toBe("Ok");
    expect(hsVariants[1]?.name).toBe("NotFound");
    expect(hsVariants[2]?.name).toBe("ServerError");

    // InternalStatus — enum without public modifier
    const is_ = model.decls.find((d) => d.name === "InternalStatus");
    expect(is_?.kind).toBe("union");
    expect(is_?.kind === "union" ? is_.variants.length : 0).toBe(2);

    // CLASS_RE matches any class with braces — RequestMiddleware gets parsed as empty record
    // (its body truncated at first } from the method), Extensions similarly
    const mw = model.decls.find((d) => d.name === "RequestMiddleware");
    expect(mw?.kind).toBe("record");
    expect(mw?.kind === "record" ? mw.fields.length : 0).toBe(0);
  });

  it("returns error on C# with no type definitions at all", () => {
    const src = `
using System;
namespace Foo;
// Just comments and using statements, no classes, records, or enums
`;
    expect(csharp.fromSource(src).ok).toBe(false);
  });
});

describe("[CONV-CS-TO-COMPLEX] complex typeDiagram -> C#", () => {
  it("emits a big model with records, enums, aliases, and all type mappings", () => {
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
}

type GenericBox<T> {
  value: T
  label: String
}

union ContentType { Text\n Image\n Code\n Divider }

alias Email = String
alias Wrapper<T> = List<T>
`;
    const model = unwrap(buildModel(unwrap(parse(td))));
    const output = csharp.toSource(model);

    // ChatRequest — property-bag record with JsonPropertyName + PascalCase
    expect(output).toContain("public sealed record ChatRequest");
    expect(output).toContain('[JsonPropertyName("message")]');
    expect(output).toContain("public string Message { get; init; }");
    expect(output).toContain("public bool Active { get; init; }");
    expect(output).toContain("public double Score { get; init; }");
    expect(output).toContain("public int Count { get; init; }");
    expect(output).toContain("public IReadOnlyList<string> Tags { get; init; }");
    expect(output).toContain("public IReadOnlyDictionary<string, int> Metadata { get; init; }");

    // GenericBox<T>
    expect(output).toContain("public sealed record GenericBox<T>");
    expect(output).toContain("public T Value { get; init; }");

    // ContentType — bare enum (no payloads)
    expect(output).toContain("public enum ContentType");
    expect(output).toContain("Text");
    expect(output).toContain("Image");
    expect(output).toContain("Code");
    expect(output).toContain("Divider");

    // Aliases inlined — no `using X = Y;` emitted
    expect(output).not.toContain("using Email =");
    expect(output).not.toContain("using Wrapper");
  });
});

describe("[CONV-CS-RT] C# round-trip TD -> C# -> TD", () => {
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

union Status { Active\n Inactive\n Pending }

alias Email = String
`;
    const model1 = unwrap(buildModel(unwrap(parse(td))));
    const csCode = csharp.toSource(model1);
    const model2 = unwrap(csharp.fromSource(csCode));

    expect(model2.decls).toHaveLength(3);

    const user = model2.decls.find((d) => d.name === "User");
    expect(user?.kind).toBe("record");
    expect(user?.kind === "record" ? user.fields.length : 0).toBe(3);

    const order = model2.decls.find((d) => d.name === "Order");
    expect(order?.kind).toBe("record");
    expect(order?.kind === "record" ? order.fields.length : 0).toBe(2);

    const status = model2.decls.find((d) => d.name === "Status");
    expect(status?.kind).toBe("union");
    const variants = status?.kind === "union" ? status.variants : [];
    expect(variants).toHaveLength(3);
    expect(variants[0]?.name).toBe("Active");
    expect(variants[1]?.name).toBe("Inactive");
    expect(variants[2]?.name).toBe("Pending");
  });
});

describe("[CONV-CS-BUG-13] Option<T> renders as T? with #nullable enable", () => {
  it("emits T? not Nullable<T> and adds #nullable enable", () => {
    const td = `
type UrlPart {
  url: String
  media_type: Option<String>
  maybe_count: Option<Int>
}
`;
    const model = unwrap(buildModel(unwrap(parse(td))));
    const out = csharp.toSource(model);

    expect(out).toContain("#nullable enable");
    expect(out).not.toContain("Nullable<");
    expect(out).toMatch(/string\?\s/);
    expect(out).toMatch(/int\?\s/);
  });
});

describe("[CONV-CS-BUG-12] aliases inlined, no mid-file using directives, Any mapped to object", () => {
  it("inlines aliases at emit time and maps Any to object", () => {
    const td = `
alias Uuid = String
alias Json = Map<String, Any>
alias ToolResultContent = Any

type ToolResultIn {
  id: Uuid
  payload: Json
  content: ToolResultContent
}
`;
    const model = unwrap(buildModel(unwrap(parse(td))));
    const out = csharp.toSource(model);

    expect(out).not.toContain("using Uuid =");
    expect(out).not.toContain("using Json =");
    expect(out).not.toContain("using ToolResultContent =");
    expect(out).not.toMatch(/\bAny\b/);
    expect(out).toMatch(/string\s+id/i);
    expect(out).toMatch(/Dictionary<string,\s*object>/);
    expect(out).toMatch(/\bobject\s+[A-Za-z]+/);
  });

  it("places any using directives at top of file, before namespace/types", () => {
    const td = `
type Req {
  tags: List<String>
}
`;
    const model = unwrap(buildModel(unwrap(parse(td))));
    const out = csharp.toSource(model);

    const firstTypeIdx = out.search(/\b(public\s+(?:sealed\s+)?record|public\s+enum|public\s+interface)\b/);
    const usingMatches = [...out.matchAll(/^using\s/gm)];
    for (const u of usingMatches) {
      expect(u.index).toBeLessThan(firstTypeIdx);
    }
  });
});

describe("[CONV-CS-BUG-11] records use property-bag style with JsonPropertyName", () => {
  it("emits PascalCase properties with JsonPropertyName on snake_case source", () => {
    const td = `
type ChatResponse {
  response: String
  session_id: String
  conversation_id: String
  tool_calls: List<String>
}
`;
    const model = unwrap(buildModel(unwrap(parse(td))));
    const out = csharp.toSource(model);

    expect(out).toContain("using System.Text.Json.Serialization;");
    expect(out).toContain("public sealed record ChatResponse");
    expect(out).toContain('[JsonPropertyName("response")]');
    expect(out).toContain("public string Response { get; init; }");
    expect(out).toContain('[JsonPropertyName("session_id")]');
    expect(out).toContain("public string SessionId { get; init; }");
    expect(out).toContain('[JsonPropertyName("conversation_id")]');
    expect(out).toContain("public string ConversationId { get; init; }");
    expect(out).toContain('[JsonPropertyName("tool_calls")]');
    expect(out).toContain("public IReadOnlyList<string> ToolCalls { get; init; }");
    expect(out).not.toMatch(/public record ChatResponse\(/);
  });
});

describe("[CONV-CS-BUG-10] payload unions emit records per variant, not flat enum", () => {
  it("emits one record per variant with a kind discriminator", () => {
    const td = `
type TextPart { text: String }
type UrlPart { url: String }

union ContentItem {
  Text  { part: TextPart }
  Url   { part: UrlPart }
  Str   { value: String }
  Num   { value: Float }
}
`;
    const model = unwrap(buildModel(unwrap(parse(td))));
    const out = csharp.toSource(model);

    expect(out).toContain("public interface IContentItem");
    expect(out).toContain("public sealed record ContentItemText");
    expect(out).toContain("public sealed record ContentItemUrl");
    expect(out).toContain("public sealed record ContentItemStr");
    expect(out).toContain("public sealed record ContentItemNum");
    expect(out).toContain(": IContentItem");
    expect(out).toContain('[JsonPropertyName("kind")]');
    expect(out).toMatch(/Kind\s*\{\s*get;\s*init;\s*\}\s*=\s*"text"/);
    expect(out).toMatch(/Kind\s*\{\s*get;\s*init;\s*\}\s*=\s*"url"/);
    expect(out).toMatch(/TextPart\s+Part\s*\{\s*get;\s*init;\s*\}/);
    expect(out).not.toContain("public enum ContentItem");
  });

  it("keeps bare unions (no payloads) as enum", () => {
    const td = `
union Color { Red\n Green\n Blue }
`;
    const model = unwrap(buildModel(unwrap(parse(td))));
    const out = csharp.toSource(model);

    expect(out).toContain("public enum Color");
    expect(out).toContain("Red");
    expect(out).toContain("Green");
    expect(out).toContain("Blue");
  });
});
