import { describe, expect, it } from "vitest";
import { parse } from "../src/parser/index.js";
import {
  ModelBuilder,
  alias,
  buildModel,
  buildModelPartial,
  fromJSON,
  printSource,
  record,
  ref,
  toJSON,
  union,
  validate,
} from "../src/model/index.js";
import { shouldEmitDeclToTarget, visibleDeclsForTarget } from "../src/model/types.js";
import { CHAT_EXAMPLE, SMALL_EXAMPLE } from "./fixtures.js";
import { declCounts, modelFromTd, unwrap } from "./helpers.js";

describe("model — buildModel from AST", () => {
  it("small example: 2 records, 2 unions, 1 alias", () => {
    const model = modelFromTd(SMALL_EXAMPLE);
    expect(declCounts(model.decls)).toEqual({ record: 2, union: 2, alias: 1 });
  });

  it("chat example: 5 records, 4 unions; ToolResultContent.List.items resolves to List<ContentItem>", () => {
    const model = modelFromTd(CHAT_EXAMPLE);
    expect(declCounts(model.decls)).toEqual({ record: 5, union: 4 });

    const trc = model.decls.find((d) => d.name === "ToolResultContent");
    if (trc?.kind !== "union") {
      throw new Error("expected union");
    }
    const list = trc.variants.find((v) => v.name === "List");
    const items = list?.fields.find((f) => f.name === "items");
    expect(items?.type.name).toBe("List");
    expect(items?.type.resolution.kind).toBe("external"); // List is external
    expect(items?.type.args[0]?.name).toBe("ContentItem");
    expect(items?.type.args[0]?.resolution.kind).toBe("declared");
  });

  it("Option<Email> on User.email: Option declared, Email is alias-declared", () => {
    const model = modelFromTd(SMALL_EXAMPLE);
    const user = model.decls.find((d) => d.name === "User");
    if (user?.kind !== "record") {
      throw new Error();
    }
    const email = user.fields.find((f) => f.name === "email");
    expect(email?.type.resolution.kind).toBe("declared");
    expect(email?.type.args[0]?.resolution.kind).toBe("declared");
  });

  it("primitives are detected", () => {
    const model = modelFromTd(SMALL_EXAMPLE);
    const addr = model.decls.find((d) => d.name === "Address");
    if (addr?.kind !== "record") {
      throw new Error();
    }
    const line1 = addr.fields.find((f) => f.name === "line1");
    expect(line1?.type.resolution.kind).toBe("primitive");
  });

  it("type params inside Option<T>", () => {
    const model = modelFromTd(SMALL_EXAMPLE);
    const opt = model.decls.find((d) => d.name === "Option");
    if (opt?.kind !== "union") {
      throw new Error();
    }
    const someValue = opt.variants[0]?.fields[0];
    expect(someValue?.type.resolution.kind).toBe("typeParam");
  });

  it("emits edges for record→record refs (User→Address)", () => {
    const model = modelFromTd(SMALL_EXAMPLE);
    const e = model.edges.find((x) => x.sourceDeclName === "User" && x.targetDeclName === "Address");
    expect(e).toBeDefined();
    expect(e?.kind).toBe("field");
    expect(e?.label).toBe("address");
  });

  it("emits variantPayload edges (ToolResultContent.List → ContentItem via List<…>)", () => {
    const model = modelFromTd(CHAT_EXAMPLE);
    const e = model.edges.find((x) => x.sourceDeclName === "ToolResultContent" && x.targetDeclName === "ContentItem");
    expect(e).toBeDefined();
    // List<ContentItem>: List is external (no edge to List), ContentItem is reached as a generic arg.
    expect(e?.kind).toBe("genericArg");
  });
});

describe("model — diagnostics", () => {
  it("flags duplicate decl names", () => {
    const src = `
typeDiagram
  type X { a: Int }
  type X { b: Int }
`;
    const ast = unwrap(parse(src));
    const r = buildModel(ast);
    expect(r.ok).toBe(false);
  });

  it("flags generic arity mismatch via parser path", () => {
    const src = `
typeDiagram
  union Option<T> { Some { value: T } None }
  type X { v: Option<Int, Bool> }
`;
    const ast = unwrap(parse(src));
    const { diagnostics } = buildModelPartial(ast);
    expect(diagnostics.some((d) => d.message.includes("type argument"))).toBe(true);
  });
});

describe("model — programmatic ModelBuilder", () => {
  it("constructs a model equivalent to the parsed small example for a subset", () => {
    const m = unwrap(
      new ModelBuilder()
        .add(
          record("Address", [
            { name: "line1", type: ref("String") },
            { name: "city", type: ref("String") },
          ])
        )
        .add(
          record("User", [
            { name: "id", type: ref("UUID") },
            { name: "addr", type: ref("Address") },
          ])
        )
        .build()
    );

    const user = m.decls.find((d) => d.name === "User");
    if (user?.kind !== "record") {
      throw new Error();
    }
    expect(user.fields[1]?.type.resolution.kind).toBe("declared");

    const addr = m.decls.find((d) => d.name === "Address");
    if (addr?.kind !== "record") {
      throw new Error();
    }
    expect(addr.fields[0]?.type.resolution.kind).toBe("primitive");

    const e = m.edges.find((x) => x.sourceDeclName === "User" && x.targetDeclName === "Address");
    expect(e).toBeDefined();
  });

  it("validate flags duplicates on hand-built model", () => {
    const built = new ModelBuilder()
      .add(record("X", [{ name: "a", type: ref("Int") }]))
      .add(record("X", [{ name: "b", type: ref("Int") }]))
      .buildPartial();
    expect(built.diagnostics.some((d) => d.message.includes("duplicate"))).toBe(true);
    const r = new ModelBuilder()
      .add(record("X", [{ name: "a", type: ref("Int") }]))
      .add(record("X", [{ name: "b", type: ref("Int") }]))
      .build();
    expect(r.ok).toBe(false);
  });

  it("supports unions, aliases, generics in builder", () => {
    const m = unwrap(
      new ModelBuilder()
        .add(union("Option", [{ name: "Some", fields: [{ name: "value", type: ref("T") }] }, { name: "None" }], ["T"]))
        .add(alias("Email", ref("String")))
        .build()
    );
    expect(m.decls).toHaveLength(2);
    const opt = m.decls.find((d) => d.name === "Option");
    if (opt?.kind !== "union") {
      throw new Error();
    }
    expect(opt.variants[0]?.fields[0]?.type.resolution.kind).toBe("typeParam");
  });
});

describe("model — JSON round-trip", () => {
  it("toJSON / fromJSON deep-equals on small example", () => {
    const model = modelFromTd(SMALL_EXAMPLE);
    const json = toJSON(model);
    const back = unwrap(fromJSON(json));

    // Deep-equal on JSON form (resolution may differ for externals not in original)
    expect(toJSON(back)).toEqual(json);
  });

  it("JSON round-trip for chat example", () => {
    const model = modelFromTd(CHAT_EXAMPLE);
    const json = toJSON(model);
    const back = unwrap(fromJSON(json));
    expect(toJSON(back)).toEqual(json);
  });

  it("preserves untagged unions through printSource and JSON", () => {
    const model = modelFromTd(`
untagged union RequestId {
  Number(Int)
  String(String)
}
`);

    const requestId = model.decls.find((decl) => decl.name === "RequestId");
    expect(requestId?.kind).toBe("union");
    expect(requestId?.kind === "union" ? requestId.untagged : undefined).toBe(true);
    expect(printSource(model)).toContain("untagged union RequestId");

    const roundTrip = unwrap(fromJSON(toJSON(model)));
    const requestIdRoundTrip = roundTrip.decls.find((decl) => decl.name === "RequestId");
    expect(requestIdRoundTrip?.kind).toBe("union");
    expect(requestIdRoundTrip?.kind === "union" ? requestIdRoundTrip.untagged : undefined).toBe(true);
  });

  it("preserves declaration target gating through printSource and JSON", () => {
    const td = `
@targets(rust)
@skipTargets(typescript)
type JsonRpcError {
  code: Int
}
`;
    const model = modelFromTd(td);
    expect(printSource(model)).toContain("@targets(rust)");
    expect(printSource(model)).toContain("@skipTargets(typescript)");

    const roundTrip = unwrap(fromJSON(toJSON(model)));
    const decl = roundTrip.decls.find((entry) => entry.name === "JsonRpcError");
    expect(decl?.targeting?.targets).toEqual(["rust"]);
    expect(decl?.targeting?.skipTargets).toEqual(["typescript"]);
  });

  it("rejects wrong schema version", () => {
    const r = fromJSON({ version: 99, decls: [] });
    expect(r.ok).toBe(false);
  });
});

describe("model — printSource round-trip", () => {
  const expectPrintSourceRoundTrips = (td: string) => {
    const model = modelFromTd(td);
    const model2 = modelFromTd(printSource(model));
    expect(toJSON(model2)).toEqual(toJSON(model));
  };

  it("printSource(model) parses back to an equivalent model — small", () => {
    expectPrintSourceRoundTrips(SMALL_EXAMPLE);
  });

  it("printSource(model) parses back to an equivalent model — chat", () => {
    expectPrintSourceRoundTrips(CHAT_EXAMPLE);
  });
});

describe("model — standalone validate", () => {
  it("validate runs on hand-built model and flags arity mismatch", () => {
    const built = new ModelBuilder()
      .add(
        union(
          "Pair",
          [
            {
              name: "P",
              fields: [
                { name: "a", type: ref("T") },
                { name: "b", type: ref("U") },
              ],
            },
          ],
          ["T", "U"]
        )
      )
      .add(record("X", [{ name: "p", type: ref("Pair", [ref("Int")]) }]))
      .buildPartial();
    const diags = validate(built.model);
    expect(diags.some((d) => d.message.includes("type argument"))).toBe(true);
  });
});

describe("model — JSON edge cases", () => {
  it("rejects non-object JSON", () => {
    const r = fromJSON("not-an-object");
    expect(r.ok).toBe(false);
  });

  it("rejects null JSON", () => {
    const r = fromJSON(null);
    expect(r.ok).toBe(false);
  });

  it("rejects missing decls array", () => {
    const r = fromJSON({ version: 1 });
    expect(r.ok).toBe(false);
  });

  it("rejects invalid decl (non-object)", () => {
    const r = fromJSON({ version: 1, decls: ["not-a-decl"] });
    expect(r.ok).toBe(false);
  });

  it("rejects decl with missing name", () => {
    const r = fromJSON({
      version: 1,
      decls: [{ kind: "record", generics: [], fields: [] }],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects decl with missing generics", () => {
    const r = fromJSON({ version: 1, decls: [{ kind: "record", name: "X" }] });
    expect(r.ok).toBe(false);
  });

  it("rejects unknown decl kind", () => {
    const r = fromJSON({
      version: 1,
      decls: [{ kind: "unknown", name: "X", generics: [] }],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects record with missing fields", () => {
    const r = fromJSON({
      version: 1,
      decls: [{ kind: "record", name: "X", generics: [] }],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects union with missing variants", () => {
    const r = fromJSON({
      version: 1,
      decls: [{ kind: "union", name: "X", generics: [] }],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects alias with missing target", () => {
    const r = fromJSON({
      version: 1,
      decls: [{ kind: "alias", name: "X", generics: [] }],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects non-object targeting JSON", () => {
    const r = fromJSON({
      version: 1,
      decls: [{ kind: "record", name: "X", generics: [], fields: [], targeting: "rust" }],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects non-string targeting arrays", () => {
    const badTargets = fromJSON({
      version: 1,
      decls: [{ kind: "record", name: "X", generics: [], fields: [], targeting: { targets: [1] } }],
    });
    const badSkipTargets = fromJSON({
      version: 1,
      decls: [{ kind: "record", name: "X", generics: [], fields: [], targeting: { skipTargets: [false] } }],
    });
    expect(badTargets.ok).toBe(false);
    expect(badSkipTargets.ok).toBe(false);
  });

  it("rejects invalid targeting JSON on unions and aliases", () => {
    const badUnion = fromJSON({
      version: 1,
      decls: [{ kind: "union", name: "X", generics: [], variants: [], targeting: { targets: [1] } }],
    });
    const badAlias = fromJSON({
      version: 1,
      decls: [{ kind: "alias", name: "X", generics: [], target: { name: "String", args: [] }, targeting: null }],
    });
    expect(badUnion.ok).toBe(false);
    expect(badAlias.ok).toBe(false);
  });

  it("round-trips alias JSON", () => {
    const model = modelFromTd(`alias Email = String`);
    const json = toJSON(model);
    const back = unwrap(fromJSON(json));
    expect(toJSON(back)).toEqual(json);
  });
});

describe("model — build alias edges", () => {
  it("emits edges for alias referencing a declared type", () => {
    const model = modelFromTd(`type User { name: String }\nalias Usr = User`);
    const e = model.edges.find((x) => x.sourceDeclName === "Usr" && x.targetDeclName === "User");
    expect(e).toBeDefined();
  });
});

describe("model — target visibility helpers", () => {
  it("applies whitelist and blacklist rules", () => {
    expect(shouldEmitDeclToTarget({ targeting: { targets: ["rust"] } }, "typescript")).toBe(false);
    expect(shouldEmitDeclToTarget({ targeting: { skipTargets: ["typescript"] } }, "typescript")).toBe(false);
    expect(shouldEmitDeclToTarget({ targeting: { targets: [] } }, "typescript")).toBe(true);
    expect(shouldEmitDeclToTarget({}, "typescript")).toBe(true);
  });

  it("filters declarations for a specific target", () => {
    const model = modelFromTd(`
@targets(rust)
type RustOnly {
  code: Int
}

@skipTargets(typescript)
type AlsoHidden {
  code: Int
}

type Shared {
  ok: Bool
}
`);
    expect(visibleDeclsForTarget(model.decls, "typescript").map((decl) => decl.name)).toEqual(["Shared"]);
    expect(visibleDeclsForTarget(model.decls, "rust").map((decl) => decl.name)).toEqual([
      "RustOnly",
      "AlsoHidden",
      "Shared",
    ]);
  });
});

describe("model — builder computeEdges for unions with fields", () => {
  it("creates variantPayload edges via builder", () => {
    const m = unwrap(
      new ModelBuilder()
        .add(record("Payload", [{ name: "data", type: ref("String") }]))
        .add(
          union("Result", [
            { name: "Ok", fields: [{ name: "value", type: ref("Payload") }] },
            { name: "Err", fields: [{ name: "msg", type: ref("String") }] },
          ])
        )
        .build()
    );
    const e = m.edges.find((x) => x.sourceDeclName === "Result" && x.targetDeclName === "Payload");
    expect(e).toBeDefined();
    expect(e?.kind).toBe("variantPayload");
  });

  it("creates edges for aliases via builder", () => {
    const m = unwrap(
      new ModelBuilder()
        .add(record("Foo", [{ name: "x", type: ref("Int") }]))
        .add(alias("Bar", ref("Foo")))
        .build()
    );
    const e = m.edges.find((x) => x.sourceDeclName === "Bar" && x.targetDeclName === "Foo");
    expect(e).toBeDefined();
  });
});
