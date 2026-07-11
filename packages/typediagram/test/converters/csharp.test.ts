// [CONV-CS-TEST] C# converter integration tests.
import { describe, expect, it } from "vitest";
import { csharp } from "../../src/converters/index.js";
import {
  aliasTargetName,
  expectLosslessRoundTrip,
  findDecl,
  modelFromSource,
  recordFields,
  toSourceFromTd,
  unionVariants,
} from "./helpers.js";

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
    const model = modelFromSource(csharp, src);

    // ChatRequest — record with 6 params
    expect(findDecl(model, "ChatRequest")?.kind).toBe("record");
    const chatFields = recordFields(model, "ChatRequest");
    expect(chatFields).toHaveLength(6);
    expect(chatFields.find((f) => f.name === "Message")?.type.name).toBe("String");
    expect(chatFields.find((f) => f.name === "SessionId")?.type.name).toBe("String");
    expect(chatFields.find((f) => f.name === "ToolResults")?.type.name).toBe("List");
    expect(chatFields.find((f) => f.name === "Active")?.type.name).toBe("Bool");
    expect(chatFields.find((f) => f.name === "Score")?.type.name).toBe("Float");
    expect(chatFields.find((f) => f.name === "Count")?.type.name).toBe("Int");

    // ToolResult — 4 fields
    expect(findDecl(model, "ToolResult")?.kind).toBe("record");
    expect(recordFields(model, "ToolResult")).toHaveLength(4);

    // GenericBox<T>
    const box = model.decls.find((d) => d.name === "GenericBox");
    expect(box?.kind).toBe("record");
    expect(box?.generics).toContain("T");
    const boxFields = recordFields(model, "GenericBox");
    expect(boxFields).toHaveLength(2);
    expect(boxFields[0]?.name).toBe("Value");

    // Pair<A, B>
    const pair = model.decls.find((d) => d.name === "Pair");
    expect(pair?.generics).toContain("A");
    expect(pair?.generics).toContain("B");

    // NullableFields — nullable types stripped
    expect(findDecl(model, "NullableFields")?.kind).toBe("record");
    expect(recordFields(model, "NullableFields")).toHaveLength(3);

    // Config / GenericContainer — property-bag `class` style is no longer
    // parsed (we only recognise primary-constructor records, abstract DU
    // records, and enums). This is deliberate: the new converter emits
    // everything as primary-constructor records for lossless round-trip,
    // so the parser doesn't need to understand legacy property-bag classes.
    expect(findDecl(model, "Config")).toBeUndefined();
    expect(findDecl(model, "GenericContainer")).toBeUndefined();

    // ContentType — enum with 4 variants (comment line ignored)
    expect(findDecl(model, "ContentType")?.kind).toBe("union");
    const ctVariants = unionVariants(model, "ContentType");
    expect(ctVariants).toHaveLength(4);
    expect(ctVariants[0]?.name).toBe("Text");
    expect(ctVariants[3]?.name).toBe("Divider");

    // HttpStatus — enum with assigned values, values stripped
    expect(findDecl(model, "HttpStatus")?.kind).toBe("union");
    const hsVariants = unionVariants(model, "HttpStatus");
    expect(hsVariants).toHaveLength(3);
    expect(hsVariants[0]?.name).toBe("Ok");
    expect(hsVariants[1]?.name).toBe("NotFound");
    expect(hsVariants[2]?.name).toBe("ServerError");

    // InternalStatus — enum without public modifier
    expect(findDecl(model, "InternalStatus")?.kind).toBe("union");
    expect(unionVariants(model, "InternalStatus")).toHaveLength(2);

    // Property-bag classes and static helpers are ignored entirely.
    expect(findDecl(model, "RequestMiddleware")).toBeUndefined();
    expect(findDecl(model, "Extensions")).toBeUndefined();
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
    const output = toSourceFromTd(csharp, td);

    // ChatRequest — primary-constructor record preserving original field
    // names (lowercase) for lossless round-trip.
    expect(output).toContain("public sealed record ChatRequest(");
    expect(output).toContain("string message");
    expect(output).toContain("bool active");
    expect(output).toContain("double score");
    expect(output).toContain("int count");
    expect(output).toContain("List<string> tags");
    expect(output).toContain("Dictionary<string, int> metadata");

    // GenericBox<T>
    expect(output).toContain("public sealed record GenericBox<T>(");
    expect(output).toContain("T value");

    // ContentType — bare enum (no payloads)
    expect(output).toContain("public enum ContentType");
    expect(output).toContain("Text");
    expect(output).toContain("Image");
    expect(output).toContain("Code");
    expect(output).toContain("Divider");

    // Aliases emitted as `using` directives for lossless round-trip.
    expect(output).toContain("using Email = string;");
    expect(output).toContain("using Wrapper = List<T>;");
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
    const csCode = toSourceFromTd(csharp, td);
    const model2 = modelFromSource(csharp, csCode);

    // Now includes the alias since it's preserved as `using Email = ...;`.
    expect(model2.decls).toHaveLength(4);

    expect(findDecl(model2, "User")?.kind).toBe("record");
    expect(recordFields(model2, "User")).toHaveLength(3);

    expect(findDecl(model2, "Order")?.kind).toBe("record");
    expect(recordFields(model2, "Order")).toHaveLength(2);

    expect(findDecl(model2, "Status")?.kind).toBe("union");
    const variants = unionVariants(model2, "Status");
    expect(variants).toHaveLength(3);
    expect(variants[0]?.name).toBe("Active");
    expect(variants[1]?.name).toBe("Inactive");
    expect(variants[2]?.name).toBe("Pending");

    expect(findDecl(model2, "Email")?.kind).toBe("alias");
    expect(aliasTargetName(model2, "Email")).toBe("String");
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
    const out = toSourceFromTd(csharp, td);

    expect(out).toContain("#nullable enable");
    expect(out).not.toContain("Nullable<");
    expect(out).toMatch(/string\?\s/);
    expect(out).toMatch(/int\?\s/);
  });
});

describe("[CONV-CS-BUG-12] aliases emit as using directives for lossless round-trip", () => {
  it("emits each alias as `using Alias = Target;` rather than inlining", () => {
    const td = `
alias Uuid = String
alias Json = Map<String, Any>

type ToolResultIn {
  id: Uuid
  payload: Json
}
`;
    const out = toSourceFromTd(csharp, td);

    expect(out).toContain("using Uuid = string;");
    expect(out).toContain("using Json = Dictionary<string, object>;");
    // Fields reference the alias name so the alias survives round-trip.
    expect(out).toContain("Uuid id");
    expect(out).toContain("Json payload");
  });
});

describe("[CONV-CS-BUG-11] records use primary-constructor style for lossless round-trip", () => {
  it("emits primary-constructor records preserving original field names", () => {
    const td = `
type ChatResponse {
  response: String
  session_id: String
  conversation_id: String
  tool_calls: List<String>
}
`;
    const out = toSourceFromTd(csharp, td);

    // Primary-constructor form: `record Foo(Type name, ...);`
    expect(out).toContain("public sealed record ChatResponse(");
    expect(out).toContain("string response");
    expect(out).toContain("string session_id");
    expect(out).toContain("string conversation_id");
    expect(out).toContain("List<string> tool_calls");
    // No more JsonPropertyName attribute block — the property-bag style is
    // replaced by the round-trip-friendly primary-constructor form.
    expect(out).not.toContain("JsonPropertyName");
    expect(out).not.toMatch(/\{\s*get;\s*init;\s*\}/);
  });
});

describe("[CONV-CS-BUG-10] payload unions emit as abstract record with nested sealed records", () => {
  it("emits a closed hierarchy using the RestClient.Net DU pattern", () => {
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
    const out = toSourceFromTd(csharp, td);

    // Abstract parent record with a private constructor = closed hierarchy.
    expect(out).toContain("public abstract record ContentItem");
    expect(out).toContain("private ContentItem()");
    // Each variant is a nested sealed record inheriting from the parent.
    expect(out).toContain("public sealed record Text(TextPart part) : ContentItem;");
    expect(out).toContain("public sealed record Url(UrlPart part) : ContentItem;");
    expect(out).toContain("public sealed record Str(string value) : ContentItem;");
    expect(out).toContain("public sealed record Num(double value) : ContentItem;");
    // No more JsonPropertyName-discriminator style.
    expect(out).not.toContain("public interface IContentItem");
    expect(out).not.toContain('JsonPropertyName("kind")');
    expect(out).not.toContain("public enum ContentItem");
  });

  it("keeps bare unions (no payloads) as enum", () => {
    const td = `
union Color { Red\n Green\n Blue }
`;
    const out = toSourceFromTd(csharp, td);

    expect(out).toContain("public enum Color");
    expect(out).toContain("Red");
    expect(out).toContain("Green");
    expect(out).toContain("Blue");
  });
});

describe("[CONV-CS-RT] C# round-trip TD -> C# -> TD", () => {
  it("losslessly round-trips the home-page example through C# (TD text preserved)", () => {
    expectLosslessRoundTrip(csharp);
  });
});
