import { describe, expect, it } from "vitest";
import { tokenize } from "../src/parser/lexer.js";
import { DiagnosticBag } from "../src/parser/diagnostics.js";

function lex(src: string) {
  const bag = new DiagnosticBag();
  const tokens = tokenize(src, bag);
  return { tokens, diagnostics: bag.items };
}

describe("lexer", () => {
  it("emits keyword tokens", () => {
    const { tokens, diagnostics } = lex("type union alias typeDiagram");
    expect(diagnostics).toEqual([]);
    expect(tokens.map((t) => t.kind)).toEqual(["TypeKw", "UnionKw", "AliasKw", "TypeDiagramKw", "EOF"]);
  });

  it("emits punctuation", () => {
    const { tokens } = lex("{}<>,:=");
    expect(tokens.map((t) => t.kind)).toEqual([
      "LBrace",
      "RBrace",
      "LAngle",
      "RAngle",
      "Comma",
      "Colon",
      "Equals",
      "EOF",
    ]);
  });

  it("treats non-keyword identifiers as Ident", () => {
    const { tokens } = lex("User Address Option");
    expect(tokens.slice(0, 3).map((t) => t.kind)).toEqual(["Ident", "Ident", "Ident"]);
    expect(tokens[0]?.value).toBe("User");
  });

  it("tracks line/col across multi-line input", () => {
    const src = "type User\n  id: UUID";
    const { tokens } = lex(src);
    const ident = tokens.find((t) => t.value === "id");
    expect(ident?.line).toBe(2);
    expect(ident?.col).toBe(3);
  });

  it("skips line comments", () => {
    const { tokens } = lex("type # this is a comment\nUser");
    const kinds = tokens.map((t) => t.kind);
    expect(kinds).toEqual(["TypeKw", "Newline", "Ident", "EOF"]);
  });

  it("handles CRLF newlines", () => {
    const src = "type\r\nUser";
    const { tokens } = lex(src);
    const newline = tokens.find((t) => t.kind === "Newline");
    expect(newline?.line).toBe(1);
    const ident = tokens.find((t) => t.kind === "Ident");
    expect(ident?.line).toBe(2);
    expect(ident?.col).toBe(1);
  });

  it("emits diagnostic on unexpected char and continues", () => {
    const { tokens, diagnostics } = lex("type $ User");
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain("$");
    expect(tokens.map((t) => t.kind)).toEqual(["TypeKw", "Ident", "EOF"]);
  });

  it("preserves offsets for spans", () => {
    const src = "type User";
    const { tokens } = lex(src);
    expect(tokens[0]).toMatchObject({ kind: "TypeKw", offset: 0, length: 4 });
    expect(tokens[1]).toMatchObject({ kind: "Ident", offset: 5, length: 4, value: "User" });
  });
});
