// [CONV-PROTO-TEST] Protobuf converter integration tests.
import { describe, expect, it } from "vitest";
import { protobuf } from "../../src/converters/index.js";
import { parse } from "../../src/parser/index.js";
import { buildModel } from "../../src/model/index.js";
import { expectLosslessRoundTrip, unwrap } from "./helpers.js";

describe("[CONV-PROTO-FROM] proto3 -> typeDiagram", () => {
  it("parses messages, enums, oneofs, and alias directives", () => {
    const src = `
syntax = "proto3";

message ChatRequest {
  string message = 1;
  string session_id = 2;
  repeated ToolResult tool_results = 3;
  optional string nickname = 4;
}

message ToolResult {
  string tool_call_id = 1;
  string name = 2;
  bool ok = 3;
}

enum UriKind {
  URIKIND_UNSPECIFIED = 0;
  URIKIND_Image = 1;
  URIKIND_Audio = 2;
  URIKIND_Video = 3;
}

message ContentItem {
  message Text {
    string value = 1;
  }
  message Url {
    string url = 1;
  }
  oneof variant {
    Text text = 1;
    Url url = 2;
    google.protobuf.Empty none = 3;
  }
}

// @td-alias: Email = String
`;
    const model = unwrap(protobuf.fromSource(src));

    const chat = model.decls.find((d) => d.name === "ChatRequest");
    expect(chat?.kind).toBe("record");
    const chatFields = chat?.kind === "record" ? chat.fields : [];
    expect(chatFields).toHaveLength(4);
    expect(chatFields.find((f) => f.name === "message")?.type.name).toBe("String");
    expect(chatFields.find((f) => f.name === "tool_results")?.type.name).toBe("List");
    expect(chatFields.find((f) => f.name === "tool_results")?.type.args[0]?.name).toBe("ToolResult");
    expect(chatFields.find((f) => f.name === "nickname")?.type.name).toBe("Option");

    const uk = model.decls.find((d) => d.name === "UriKind");
    expect(uk?.kind).toBe("union");
    const ukVariants = uk?.kind === "union" ? uk.variants : [];
    // The UNSPECIFIED sentinel is stripped on parse-back.
    expect(ukVariants.map((v) => v.name)).toEqual(["Image", "Audio", "Video"]);

    const ci = model.decls.find((d) => d.name === "ContentItem");
    expect(ci?.kind).toBe("union");
    const ciVariants = ci?.kind === "union" ? ci.variants : [];
    expect(ciVariants).toHaveLength(3);
    expect(ciVariants[0]?.name).toBe("Text");
    expect(ciVariants[0]?.fields[0]?.name).toBe("value");
    expect(ciVariants[2]?.name).toBe("None");
    expect(ciVariants[2]?.fields).toHaveLength(0);

    const email = model.decls.find((d) => d.name === "Email");
    expect(email?.kind).toBe("alias");
    expect(email?.kind === "alias" ? email.target.name : "").toBe("String");
  });

  it("honours @td-type directives for types proto can't express natively", () => {
    const src = `
syntax = "proto3";

message Req {
  // @td-type: Option<List<String>>
  repeated bytes tags = 1;
}
`;
    const model = unwrap(protobuf.fromSource(src));
    const req = model.decls.find((d) => d.name === "Req");
    expect(req?.kind).toBe("record");
    const f = req?.kind === "record" ? req.fields[0] : undefined;
    expect(f?.name).toBe("tags");
    expect(f?.type.name).toBe("Option");
    expect(f?.type.args[0]?.name).toBe("List");
    expect(f?.type.args[0]?.args[0]?.name).toBe("String");
  });

  it("returns error on proto source with no messages/enums/aliases", () => {
    expect(protobuf.fromSource('syntax = "proto3";\n').ok).toBe(false);
  });
});

describe("[CONV-PROTO-TO] typeDiagram -> proto3", () => {
  it("emits messages, enums, oneofs, and alias directives", () => {
    const td = `
type ChatRequest {
  message: String
  session_id: String
  tool_results: List<ToolResult>
}

type ToolResult {
  tool_call_id: String
}

union UriKind { Image\n Audio\n Video }

union ContentItem {
  Text { value: String }
  None
}

alias Email = String
`;
    const model = unwrap(buildModel(unwrap(parse(td))));
    const out = protobuf.toSource(model);

    expect(out).toContain('syntax = "proto3";');
    expect(out).toContain("message ChatRequest {");
    expect(out).toContain("string message = 1;");
    expect(out).toContain("string session_id = 2;");
    expect(out).toContain("repeated ToolResult tool_results = 3;");
    expect(out).toContain("enum UriKind {");
    expect(out).toContain("URIKIND_UNSPECIFIED = 0;");
    expect(out).toContain("URIKIND_Image = 1;");
    expect(out).toContain("message ContentItem {");
    expect(out).toContain("message Text {");
    expect(out).toContain("oneof variant {");
    expect(out).toContain("Text text = 1;");
    expect(out).toContain("google.protobuf.Empty none = 2;");
    expect(out).toContain("// @td-alias: Email = String");
  });

  it("emits @td-type directive for Option<List<T>> fields", () => {
    const td = `type Req { tags: Option<List<String>> }`;
    const out = protobuf.toSource(unwrap(buildModel(unwrap(parse(td)))));
    expect(out).toContain("// @td-type: Option<List<String>>");
  });
});

describe("[CONV-PROTO-RT] proto round-trip TD -> proto -> TD", () => {
  it("losslessly round-trips the home-page example through protobuf (TD text preserved)", () => {
    expectLosslessRoundTrip(protobuf);
  });
});

describe("[CONV-PROTO-ERR] error paths", () => {
  it("returns error on malformed proto with only a directive comment", () => {
    const src = "// just a comment\n";
    expect(protobuf.fromSource(src).ok).toBe(false);
  });

  it("skips fields whose line doesn't match the field regex", () => {
    // The junk line should be ignored; only `ok bool = 1;` is picked up.
    const src = `
syntax = "proto3";
message Foo {
  not a real field
  bool ok = 1;
}
`;
    const model = unwrap(protobuf.fromSource(src));
    const foo = model.decls.find((d) => d.name === "Foo");
    expect(foo?.kind).toBe("record");
    const fields = foo?.kind === "record" ? foo.fields : [];
    expect(fields).toHaveLength(1);
    expect(fields[0]?.name).toBe("ok");
  });

  it("emits @td-type directive for nested Option<Option<T>>", () => {
    const td = `type X { v: Option<Option<String>> }`;
    const model = unwrap(buildModel(unwrap(parse(td))));
    const out = protobuf.toSource(model);
    expect(out).toContain("// @td-type: Option<Option<String>>");
  });
});

describe("[CONV-PROTO-EDGE] edge cases", () => {
  it("emits map<K, V> for Map types and parses them back", () => {
    const td = `type Metrics { counts: Map<String, Int> }`;
    const model = unwrap(buildModel(unwrap(parse(td))));
    const out = protobuf.toSource(model);
    expect(out).toContain("map<string, int64> counts = 1;");
    const back = unwrap(protobuf.fromSource(out));
    const m = back.decls.find((d) => d.name === "Metrics");
    expect(m?.kind).toBe("record");
    const f = m?.kind === "record" ? m.fields[0] : undefined;
    expect(f?.type.name).toBe("Map");
    expect(f?.type.args[0]?.name).toBe("String");
    expect(f?.type.args[1]?.name).toBe("Int");
  });

  it("falls back to @td-type directive for List<List<T>> and Option<Map<K,V>>", () => {
    const td = `type Deep { matrix: List<List<String>>\n maybe: Option<Map<String, Int>> }`;
    const model = unwrap(buildModel(unwrap(parse(td))));
    const out = protobuf.toSource(model);
    expect(out).toContain("// @td-type: List<List<String>>");
    expect(out).toContain("// @td-type: Option<Map<String, Int>>");
    // Round-trip preserves the types despite proto not supporting them.
    const back = unwrap(protobuf.fromSource(out));
    const deep = back.decls.find((decl) => decl.name === "Deep");
    const fields = deep?.kind === "record" ? deep.fields : [];
    expect(fields.find((f) => f.name === "matrix")?.type.name).toBe("List");
    expect(fields.find((f) => f.name === "matrix")?.type.args[0]?.name).toBe("List");
    expect(fields.find((f) => f.name === "maybe")?.type.name).toBe("Option");
    expect(fields.find((f) => f.name === "maybe")?.type.args[0]?.name).toBe("Map");
  });

  it("preserves generics on messages via @td-generics directive", () => {
    const td = `type Box<T> { value: T }`;
    const model = unwrap(buildModel(unwrap(parse(td))));
    const out = protobuf.toSource(model);
    expect(out).toContain("// @td-generics: T");
    const back = unwrap(protobuf.fromSource(out));
    const box = back.decls.find((d) => d.name === "Box");
    expect(box?.generics).toEqual(["T"]);
  });
});
