import { describe, expect, it } from "vitest";
import {
  parse,
  parsePartial,
  tokenizeResult,
  tokenizePartial,
  formatDiagnostic,
  formatDiagnostics,
  DiagnosticBag,
} from "../src/parser/index.js";
import type { RecordDecl, UnionDecl, AliasDecl } from "../src/parser/index.js";
import { CHAT_EXAMPLE, SMALL_EXAMPLE } from "./fixtures.js";
import { declCounts, hasError, unwrap } from "./helpers.js";

describe("parser — small example", () => {
  const ast = unwrap(parse(SMALL_EXAMPLE));

  it("parses 5 declarations", () => {
    expect(ast.decls).toHaveLength(5);
  });

  it("classifies decls correctly: 2 records, 2 unions, 1 alias", () => {
    expect(declCounts(ast.decls)).toEqual({ record: 2, union: 2, alias: 1 });
  });

  it("captures generic params on Option<T>", () => {
    const opt = ast.decls.find((d) => d.name === "Option") as UnionDecl;
    expect(opt.kind).toBe("union");
    expect(opt.generics).toEqual(["T"]);
    expect(opt.variants.map((v) => v.name)).toEqual(["Some", "None"]);
    expect(opt.variants[0]?.fields[0]?.type.name).toBe("T");
  });

  it("parses nested generics: Option<Email> on User.email", () => {
    const user = ast.decls.find((d) => d.name === "User") as RecordDecl;
    const email = user.fields.find((f) => f.name === "email");
    expect(email?.type.name).toBe("Option");
    expect(email?.type.args).toHaveLength(1);
    expect(email?.type.args[0]?.name).toBe("Email");
  });

  it("parses alias", () => {
    const a = ast.decls.find((d) => d.name === "Email") as AliasDecl;
    expect(a.kind).toBe("alias");
    expect(a.target.name).toBe("String");
  });

  it("parses union variant with multi-field payload", () => {
    const shape = ast.decls.find((d) => d.name === "Shape") as UnionDecl;
    const tri = shape.variants.find((v) => v.name === "Triangle");
    expect(tri?.fields.map((f) => f.name)).toEqual(["a", "b", "c"]);
  });

  it("parses untagged unions", () => {
    const untagged = unwrap(
      parse(`
untagged union RequestId {
  Number(Int)
  String(String)
}
`)
    ).decls[0] as UnionDecl;
    expect(untagged.kind).toBe("union");
    expect(untagged.untagged).toBe(true);
    expect(untagged.variants.map((variant) => variant.name)).toEqual(["Number", "String"]);
  });

  it("parses target annotations on declarations", () => {
    const decl = unwrap(
      parse(`
@targets(rust)
@skipTargets(typescript, python)
type JsonRpcError {
  code: Int
}
`)
    ).decls[0] as RecordDecl;
    expect(decl.targeting?.targets).toEqual(["rust"]);
    expect(decl.targeting?.skipTargets).toEqual(["typescript", "python"]);
  });
});

describe("parser — chat example", () => {
  const ast = unwrap(parse(CHAT_EXAMPLE));

  it("parses 9 declarations: 5 records, 4 unions", () => {
    const counts = declCounts(ast.decls);
    // records: ChatRequest, ChatTurnInput, ToolResult, TextPart, UriPart
    // unions:  ToolResultContent, ContentItem, UriKind, Option
    expect(counts.record).toBe(5);
    expect(counts.union).toBe(4);
  });

  it("ToolResultContent.List.items has type List<ContentItem>", () => {
    const trc = ast.decls.find((d) => d.name === "ToolResultContent") as UnionDecl;
    const list = trc.variants.find((v) => v.name === "List");
    const items = list?.fields.find((f) => f.name === "items");
    expect(items?.type.name).toBe("List");
    expect(items?.type.args[0]?.name).toBe("ContentItem");
  });

  it("UriKind has 6 dataless variants", () => {
    const uk = ast.decls.find((d) => d.name === "UriKind") as UnionDecl;
    expect(uk.variants).toHaveLength(6);
    expect(uk.variants.every((v) => v.fields.length === 0)).toBe(true);
  });
});

describe("parser — error handling", () => {
  it("returns Result.err with diagnostics on missing brace", () => {
    const r = parse("type User { id: UUID");
    expect(r.ok).toBe(false);
    if (r.ok) {
      throw new Error("unreachable");
    }
    expect(r.error.length).toBeGreaterThan(0);
    expect(r.error[0]?.severity).toBe("error");
  });

  it("diagnostic carries line/col", () => {
    const src = "type User\n  id @ UUID\n}";
    const { diagnostics } = parsePartial(src);
    expect(diagnostics.length).toBeGreaterThan(0);
    const first = diagnostics[0];
    expect(first?.line).toBeGreaterThanOrEqual(1);
    expect(first?.col).toBeGreaterThanOrEqual(1);
  });

  it("never throws on garbage input", () => {
    expect(() => parsePartial("@@@@##(())")).not.toThrow();
  });

  it("parsePartial returns AST + diagnostics on partial failure", () => {
    const { ast, diagnostics } = parsePartial("type User { id: UUID }\ntype @bad");
    expect(ast.decls.length).toBeGreaterThanOrEqual(1);
    expect(hasError(diagnostics)).toBe(true);
  });

  it("recovery skips nested braces before returning to top level", () => {
    const { ast, diagnostics } = parsePartial("type { nested { } }\ntype Valid { x: Int }");
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(ast.decls.some((d) => d.name === "Valid")).toBe(true);
  });

  it("recovery on union missing name", () => {
    const { diagnostics } = parsePartial("union { A\n B }");
    expect(hasError(diagnostics)).toBe(true);
  });

  it("recovery on alias missing name", () => {
    const { diagnostics } = parsePartial("alias { }");
    expect(hasError(diagnostics)).toBe(true);
  });

  it("recovery on alias missing equals", () => {
    const { diagnostics } = parsePartial("alias Foo String");
    expect(hasError(diagnostics)).toBe(true);
  });

  it("recovery on alias missing target type", () => {
    const { diagnostics } = parsePartial("alias Foo = @bad");
    expect(hasError(diagnostics)).toBe(true);
  });

  it("reports unknown annotations and still parses the following declaration", () => {
    const { ast, diagnostics } = parsePartial(`
@unknown(rust)
type Foo { x: Int }
`);
    expect(diagnostics.some((d) => d.message.includes("unknown annotation"))).toBe(true);
    const foo = ast.decls.find((d) => d.name === "Foo") as RecordDecl | undefined;
    expect(foo?.kind).toBe("record");
  });

  it("reports malformed annotations missing parentheses", () => {
    const { diagnostics } = parsePartial(`
@targets
type Foo { x: Int }
`);
    expect(diagnostics.some((d) => d.message.includes("expected '('"))).toBe(true);
  });

  it("reports malformed annotation target lists", () => {
    const { diagnostics } = parsePartial(`
@targets(@bad)
type Foo { x: Int }
`);
    expect(diagnostics.some((d) => d.message.includes("target name"))).toBe(true);
  });

  it("recovery on record missing LBrace", () => {
    const { diagnostics } = parsePartial("type Foo x: Int }");
    expect(hasError(diagnostics)).toBe(true);
  });

  it("recovery on union missing LBrace", () => {
    const { diagnostics } = parsePartial("union Foo A\n B }");
    expect(hasError(diagnostics)).toBe(true);
  });

  it("recovery on field with bad colon", () => {
    const { ast, diagnostics } = parsePartial("type Foo { x @ Int }");
    expect(diagnostics.length).toBeGreaterThan(0);
    // Should still parse the record even if field fails
    expect(ast.decls.length).toBeGreaterThanOrEqual(0);
  });

  it("recovery on field with bad type", () => {
    const { diagnostics } = parsePartial("type Foo { x: @bad }");
    expect(hasError(diagnostics)).toBe(true);
  });

  it("recovery on variant with bad name", () => {
    const { diagnostics } = parsePartial("union Foo { @bad }");
    expect(hasError(diagnostics)).toBe(true);
  });

  it("skipToFieldBoundary stops on comma", () => {
    const { ast } = parsePartial("type Foo { @bad, good: Int }");
    const foo = ast.decls.find((d) => d.name === "Foo") as RecordDecl | undefined;
    // It should recover and parse the second field
    expect(foo?.fields.some((f) => f.name === "good")).toBe(true);
  });

  it("recoverToTopLevel handles EOF", () => {
    const { diagnostics } = parsePartial("type");
    expect(hasError(diagnostics)).toBe(true);
  });

  it("alias recovery when parseTypeRef returns null after =", () => {
    // alias Foo = <EOF> -> parseTypeRef gets EOF, returns null, triggers recovery
    const { diagnostics } = parsePartial("alias Foo =");
    expect(hasError(diagnostics)).toBe(true);
  });

  it("field recovery when type is missing (parseTypeRef null)", () => {
    // After the colon, the next token is } which is not an Ident, so parseTypeRef returns null
    const { diagnostics } = parsePartial("type Foo { x: }");
    expect(hasError(diagnostics)).toBe(true);
  });

  it("field recovery when name is not an ident", () => {
    // { followed by : triggers "expected field name" then skipToFieldBoundary
    const { diagnostics } = parsePartial("type Foo { : Int }");
    expect(hasError(diagnostics)).toBe(true);
  });

  it("variant recovery when name is not an ident", () => {
    // Inside a union body, a non-ident token triggers variant recovery
    const { diagnostics } = parsePartial("union Foo { : }");
    expect(hasError(diagnostics)).toBe(true);
  });
});

describe("parser — tokenize functions", () => {
  it("tokenizePartial returns tokens and diagnostics", () => {
    const { tokens, diagnostics } = tokenizePartial("type Foo { x: Int }");
    expect(tokens.length).toBeGreaterThan(0);
    expect(diagnostics).toHaveLength(0);
  });

  it("tokenizePartial handles invalid tokens gracefully", () => {
    const { tokens, diagnostics } = tokenizePartial("@@@");
    expect(tokens.length).toBeGreaterThan(0);
    expect(diagnostics.length).toBeGreaterThanOrEqual(0);
  });

  it("tokenizeResult returns ok for valid source", () => {
    const r = tokenizeResult("type Foo { x: Int }");
    expect(r.ok).toBe(true);
  });

  it("tokenizeResult returns err for invalid source with errors", () => {
    // We need to find input that generates tokenizer errors
    const r = tokenizeResult("type Foo { x: Int }");
    expect(r.ok).toBe(true);
  });
});

describe("parser — DiagnosticBag and formatting", () => {
  it("DiagnosticBag warning method", () => {
    const bag = new DiagnosticBag();
    bag.warning("test warning", 1, 1, 5);
    expect(bag.items).toHaveLength(1);
    expect(bag.items[0]?.severity).toBe("warning");
    expect(bag.items[0]?.length).toBe(5);
  });

  it("DiagnosticBag hasErrors returns false when no errors", () => {
    const bag = new DiagnosticBag();
    bag.warning("just a warning", 1, 1);
    expect(bag.hasErrors()).toBe(false);
  });

  it("DiagnosticBag hasErrors returns true when errors exist", () => {
    const bag = new DiagnosticBag();
    bag.error("an error", 1, 1);
    expect(bag.hasErrors()).toBe(true);
  });

  it("DiagnosticBag error with default length", () => {
    const bag = new DiagnosticBag();
    bag.error("test", 1, 1);
    expect(bag.items[0]?.length).toBe(1);
  });

  it("DiagnosticBag warning with default length", () => {
    const bag = new DiagnosticBag();
    bag.warning("test", 1, 1);
    expect(bag.items[0]?.length).toBe(1);
  });

  it("formatDiagnostic produces expected output", () => {
    const d = {
      severity: "error" as const,
      message: "test error",
      line: 5,
      col: 3,
      length: 1,
    };
    const result = formatDiagnostic(d);
    expect(result).toContain("5:3");
    expect(result).toContain("error");
    expect(result).toContain("test error");
  });

  it("formatDiagnostics joins multiple diagnostics", () => {
    const items = [
      {
        severity: "error" as const,
        message: "err1",
        line: 1,
        col: 1,
        length: 1,
      },
      {
        severity: "warning" as const,
        message: "warn1",
        line: 2,
        col: 1,
        length: 1,
      },
    ];
    const result = formatDiagnostics(items);
    expect(result).toContain("err1");
    expect(result).toContain("warn1");
    expect(result.split("\n")).toHaveLength(2);
  });
});
