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
import { CHAT_EXAMPLE, SMALL_EXAMPLE } from "./fixtures.js";

function unwrap<T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!r.ok) {
    throw new Error(`expected ok, got: ${JSON.stringify(r.error)}`);
  }
  return r.value;
}

describe("model — buildModel from AST", () => {
  it("small example: 2 records, 2 unions, 1 alias", () => {
    const ast = unwrap(parse(SMALL_EXAMPLE));
    const model = unwrap(buildModel(ast));
    const counts = model.decls.reduce<Record<string, number>>((acc, d) => {
      acc[d.kind] = (acc[d.kind] ?? 0) + 1;
      return acc;
    }, {});
    expect(counts).toEqual({ record: 2, union: 2, alias: 1 });
  });

  it("chat example: 5 records, 4 unions; ToolResultContent.List.items resolves to List<ContentItem>", () => {
    const ast = unwrap(parse(CHAT_EXAMPLE));
    const model = unwrap(buildModel(ast));
    const counts = model.decls.reduce<Record<string, number>>((acc, d) => {
      acc[d.kind] = (acc[d.kind] ?? 0) + 1;
      return acc;
    }, {});
    expect(counts).toEqual({ record: 5, union: 4 });

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
    const ast = unwrap(parse(SMALL_EXAMPLE));
    const model = unwrap(buildModel(ast));
    const user = model.decls.find((d) => d.name === "User");
    if (user?.kind !== "record") {
      throw new Error();
    }
    const email = user.fields.find((f) => f.name === "email");
    expect(email?.type.resolution.kind).toBe("declared");
    expect(email?.type.args[0]?.resolution.kind).toBe("declared");
  });

  it("primitives are detected", () => {
    const ast = unwrap(parse(SMALL_EXAMPLE));
    const model = unwrap(buildModel(ast));
    const addr = model.decls.find((d) => d.name === "Address");
    if (addr?.kind !== "record") {
      throw new Error();
    }
    const line1 = addr.fields.find((f) => f.name === "line1");
    expect(line1?.type.resolution.kind).toBe("primitive");
  });

  it("type params inside Option<T>", () => {
    const ast = unwrap(parse(SMALL_EXAMPLE));
    const model = unwrap(buildModel(ast));
    const opt = model.decls.find((d) => d.name === "Option");
    if (opt?.kind !== "union") {
      throw new Error();
    }
    const someValue = opt.variants[0]?.fields[0];
    expect(someValue?.type.resolution.kind).toBe("typeParam");
  });

  it("emits edges for record→record refs (User→Address)", () => {
    const ast = unwrap(parse(SMALL_EXAMPLE));
    const model = unwrap(buildModel(ast));
    const e = model.edges.find((x) => x.sourceDeclName === "User" && x.targetDeclName === "Address");
    expect(e).toBeDefined();
    expect(e?.kind).toBe("field");
    expect(e?.label).toBe("address");
  });

  it("emits variantPayload edges (ToolResultContent.List → ContentItem via List<…>)", () => {
    const ast = unwrap(parse(CHAT_EXAMPLE));
    const model = unwrap(buildModel(ast));
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
    const ast = unwrap(parse(SMALL_EXAMPLE));
    const model = unwrap(buildModel(ast));
    const json = toJSON(model);
    const back = unwrap(fromJSON(json));

    // Deep-equal on JSON form (resolution may differ for externals not in original)
    expect(toJSON(back)).toEqual(json);
  });

  it("JSON round-trip for chat example", () => {
    const ast = unwrap(parse(CHAT_EXAMPLE));
    const model = unwrap(buildModel(ast));
    const json = toJSON(model);
    const back = unwrap(fromJSON(json));
    expect(toJSON(back)).toEqual(json);
  });

  it("preserves untagged unions through printSource and JSON", () => {
    const model = unwrap(
      buildModel(
        unwrap(
          parse(`
untagged union RequestId {
  Number(Int)
  String(String)
}
`)
        )
      )
    );

    const requestId = model.decls.find((decl) => decl.name === "RequestId");
    expect(requestId?.kind).toBe("union");
    expect(requestId?.kind === "union" ? requestId.untagged : undefined).toBe(true);
    expect(printSource(model)).toContain("untagged union RequestId");

    const roundTrip = unwrap(fromJSON(toJSON(model)));
    const requestIdRoundTrip = roundTrip.decls.find((decl) => decl.name === "RequestId");
    expect(requestIdRoundTrip?.kind).toBe("union");
    expect(requestIdRoundTrip?.kind === "union" ? requestIdRoundTrip.untagged : undefined).toBe(true);
  });

  it("rejects wrong schema version", () => {
    const r = fromJSON({ version: 99, decls: [] });
    expect(r.ok).toBe(false);
  });
});

describe("model — printSource round-trip", () => {
  it("printSource(model) parses back to an equivalent model — small", () => {
    const ast = unwrap(parse(SMALL_EXAMPLE));
    const model = unwrap(buildModel(ast));
    const src = printSource(model);
    const ast2 = unwrap(parse(src));
    const model2 = unwrap(buildModel(ast2));
    expect(toJSON(model2)).toEqual(toJSON(model));
  });

  it("printSource(model) parses back to an equivalent model — chat", () => {
    const ast = unwrap(parse(CHAT_EXAMPLE));
    const model = unwrap(buildModel(ast));
    const src = printSource(model);
    const ast2 = unwrap(parse(src));
    const model2 = unwrap(buildModel(ast2));
    expect(toJSON(model2)).toEqual(toJSON(model));
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

  it("round-trips alias JSON", () => {
    const td = `alias Email = String`;
    const model = unwrap(buildModel(unwrap(parse(td))));
    const json = toJSON(model);
    const back = unwrap(fromJSON(json));
    expect(toJSON(back)).toEqual(json);
  });
});

describe("model — build alias edges", () => {
  it("emits edges for alias referencing a declared type", () => {
    const td = `type User { name: String }\nalias Usr = User`;
    const ast = unwrap(parse(td));
    const model = unwrap(buildModel(ast));
    const e = model.edges.find((x) => x.sourceDeclName === "Usr" && x.targetDeclName === "User");
    expect(e).toBeDefined();
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
