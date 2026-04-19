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
