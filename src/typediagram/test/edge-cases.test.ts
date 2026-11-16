// [EDGE-CASES] §17 edge-case tests for robustness before MVP ships.
import { describe, expect, it } from "vitest";
import { renderToString } from "../src/index.js";
import { parse } from "../src/parser/index.js";
import { buildModel } from "../src/model/index.js";
import { unwrap } from "./helpers.js";

// [EDGE-EMPTY] Empty diagram — parse("") and parse("typeDiagram\n")
describe("[EDGE-EMPTY] empty diagram", () => {
  it("parses empty string to valid AST with zero decls", () => {
    const ast = unwrap(parse(""));
    expect(ast.decls).toHaveLength(0);
  });

  it("parses bare header to valid AST with zero decls", () => {
    const ast = unwrap(parse("typeDiagram\n"));
    expect(ast.decls).toHaveLength(0);
  });

  it("builds empty model from empty AST", () => {
    const ast = unwrap(parse(""));
    const model = unwrap(buildModel(ast));
    expect(model.decls).toHaveLength(0);
    expect(model.edges).toHaveLength(0);
  });

  it("renderToString produces valid empty SVG (no NaN)", async () => {
    const svg = unwrap(await renderToString(""));
    expect(svg).toMatch(/^<svg/);
    expect(svg).toContain("</svg>");
    expect(svg).not.toContain("NaN");
  });

  it("renderToString with header-only produces valid empty SVG", async () => {
    const svg = unwrap(await renderToString("typeDiagram\n"));
    expect(svg).toMatch(/^<svg/);
    expect(svg).not.toContain("NaN");
  });
});

// [EDGE-SINGLE] Single-node diagram — layout/render must not crash
describe("[EDGE-SINGLE] single-node diagram", () => {
  it("renders a single record", async () => {
    const svg = unwrap(await renderToString("type Foo { bar: String }"));
    expect(svg).toContain("Foo");
    expect(svg).toContain("bar");
  });

  it("renders a single union", async () => {
    const svg = unwrap(await renderToString("union Color { Red\n Green\n Blue }"));
    expect(svg).toContain("Color");
    expect(svg).toContain("Red");
  });

  it("renders a single alias", async () => {
    const svg = unwrap(await renderToString("alias Email = String"));
    expect(svg).toContain("Email");
  });
});

// [EDGE-CYCLE] Self-referential types
describe("[EDGE-CYCLE] self-referential types", () => {
  const TREE = `
    type Tree {
      value: String
      left: Tree
      right: Tree
    }
  `;

  it("parses self-referential type", () => {
    const ast = unwrap(parse(TREE));
    expect(ast.decls).toHaveLength(1);
  });

  it("builds model with self-referential edge", () => {
    const ast = unwrap(parse(TREE));
    const model = unwrap(buildModel(ast));
    const selfEdge = model.edges.find((e) => e.sourceDeclName === "Tree" && e.targetDeclName === "Tree");
    expect(selfEdge).toBeDefined();
  });

  it("renders self-referential type without crash", async () => {
    const svg = unwrap(await renderToString(TREE));
    expect(svg).toContain("Tree");
    expect(svg).toContain("left");
    expect(svg).toContain("right");
  });
});

// [EDGE-TRAILING] Trailing-newline tolerance
describe("[EDGE-TRAILING] trailing newline tolerance", () => {
  it("parses file ending mid-line (no trailing newline)", () => {
    const ast = unwrap(parse("type X { a: String }"));
    expect(ast.decls).toHaveLength(1);
  });

  it("parses file with multiple trailing newlines", () => {
    const ast = unwrap(parse("type X { a: String }\n\n\n"));
    expect(ast.decls).toHaveLength(1);
  });

  it("parses file with CRLF line endings", () => {
    const ast = unwrap(parse("type X {\r\n  a: String\r\n}\r\n"));
    expect(ast.decls).toHaveLength(1);
  });
});

// [EDGE-LONGNAME] Long type/field names
describe("[EDGE-LONGNAME] long type names", () => {
  it("handles a 200-char field name without blowing up", async () => {
    const longName = "a".repeat(200);
    const src = `type Foo { ${longName}: String }`;
    const svg = unwrap(await renderToString(src));
    expect(svg).toContain(longName);
    expect(svg).not.toContain("NaN");
    expect(svg).not.toContain("Infinity");
  });

  it("handles a 200-char type name", async () => {
    const longName = "A" + "a".repeat(199);
    const src = `type ${longName} { x: String }`;
    const svg = unwrap(await renderToString(src));
    expect(svg).toContain(longName);
  });
});
