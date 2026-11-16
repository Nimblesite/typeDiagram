// [DSL-FUNCTION-TEST] Function declarations survive every public model/render layer.
import { describe, expect, it } from "vitest";
import { renderToString } from "../src/index.js";
import { buildModel, fromJSON, printSource, toJSON } from "../src/model/index.js";
import { parse } from "../src/parser/index.js";
import { unwrap } from "./helpers.js";

describe("[DSL-FUNCTION] function declarations", () => {
  it("parses, resolves, prints, serializes, lays out, and renders signatures and overloads", async () => {
    const source = `typeDiagram

type Request { id: Int }
type Response { body: Bytes }

function submit<T>(request: Request, fallback: Option<T>) -> Response

function read {
  (request: Request) -> Bytes
  async (request: Request, limit: Int) -> Response
}
`;
    const ast = unwrap(parse(source));
    expect(ast.decls.map((decl) => decl.kind)).toEqual(["record", "record", "function", "function"]);

    const model = unwrap(buildModel(ast));
    const submit = model.decls.find((decl) => decl.name === "submit");
    const read = model.decls.find((decl) => decl.name === "read");
    expect(submit?.kind).toBe("function");
    expect(submit?.generics).toEqual(["T"]);
    expect(submit?.kind === "function" ? submit.signatures[0]?.params.map((param) => param.name) : []).toEqual([
      "request",
      "fallback",
    ]);
    expect(read?.kind === "function" ? read.signatures : []).toHaveLength(2);
    expect(read?.kind === "function" ? read.signatures[1]?.async : undefined).toBe(true);
    expect(model.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceDeclName: "submit", targetDeclName: "Request", kind: "parameter" }),
        expect.objectContaining({ sourceDeclName: "submit", targetDeclName: "Response", kind: "return" }),
        expect.objectContaining({ sourceDeclName: "read", targetDeclName: "Response", kind: "return" }),
      ])
    );

    const printed = printSource(model);
    expect(printed).toContain("function submit<T>(request: Request, fallback: Option<T>) -> Response");
    expect(printed).toContain("function read {\n  (request: Request) -> Bytes");
    expect(printed).toContain("  async (request: Request, limit: Int) -> Response");
    expect(toJSON(unwrap(fromJSON(toJSON(model))))).toEqual(toJSON(model));

    const svg = unwrap(await renderToString(printed));
    expect(svg).toContain('data-decl="submit"');
    expect(svg).toContain('data-kind="function"');
    expect(svg).toContain("function submit&lt;T&gt;");
    expect(svg).toContain("request: Request");
    expect(svg).toContain("async (request: Request, limit: Int) → Response");
  });

  it("returns diagnostics and recovers across malformed function heads, parameters, returns, and overload rows", () => {
    const malformed = [
      "async type Nope {}",
      "function",
      "function missing(",
      "function missingArrow(value: Int) String",
      "function bad { nope\n (value Int) -> Unit\n () -> Unit }\ntype Recovered { ok: Bool }",
    ];
    const results = malformed.map((source) => parse(source));
    expect(results.every((result) => !result.ok)).toBe(true);
    expect(
      results.flatMap((result) => (result.ok ? [] : result.error)).map((diagnostic) => diagnostic.message)
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("expected 'function'"),
        expect.stringContaining("function name"),
        expect.stringContaining("expected ')'"),
        expect.stringContaining("expected '->'"),
        expect.stringContaining("expected '('"),
      ])
    );
  });
});
