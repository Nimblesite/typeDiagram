// [CONV-TYPEREF-TEST] Exhaustive tests for parseTypeRef and printTypeRef.
import { describe, expect, it } from "vitest";
import { parseTypeRef, printTypeRef } from "../../src/converters/parse-typeref.js";

describe("[CONV-TYPEREF] parseTypeRef basics", () => {
  it("parses a simple type name", () => {
    const t = parseTypeRef("String");
    expect(t.name).toBe("String");
    expect(t.args).toHaveLength(0);
  });

  it("parses a single generic arg", () => {
    const t = parseTypeRef("Option<String>");
    expect(t.name).toBe("Option");
    expect(t.args).toHaveLength(1);
    expect(t.args[0]?.name).toBe("String");
  });

  it("parses two generic args", () => {
    const t = parseTypeRef("Map<String, Int>");
    expect(t.name).toBe("Map");
    expect(t.args).toHaveLength(2);
    expect(t.args[0]?.name).toBe("String");
    expect(t.args[1]?.name).toBe("Int");
  });

  it("parses nested generics", () => {
    const t = parseTypeRef("Map<String, List<Int>>");
    expect(t.name).toBe("Map");
    expect(t.args[1]?.name).toBe("List");
    expect(t.args[1]?.args[0]?.name).toBe("Int");
  });

  it("parses deeply nested generics", () => {
    const t = parseTypeRef("Map<String, Option<List<Map<String, Int>>>>");
    expect(t.name).toBe("Map");
    expect(t.args[1]?.name).toBe("Option");
    expect(t.args[1]?.args[0]?.name).toBe("List");
    expect(t.args[1]?.args[0]?.args[0]?.name).toBe("Map");
    expect(t.args[1]?.args[0]?.args[0]?.args[1]?.name).toBe("Int");
  });

  it("parses three generic args", () => {
    const t = parseTypeRef("Triple<A, B, C>");
    expect(t.name).toBe("Triple");
    expect(t.args).toHaveLength(3);
    expect(t.args[2]?.name).toBe("C");
  });
});

describe("[CONV-TYPEREF-EDGE] parseTypeRef edge cases", () => {
  it("handles empty generic args", () => {
    const t = parseTypeRef("Foo<>");
    expect(t.name).toBe("Foo");
    expect(t.args).toHaveLength(0);
  });

  it("trims whitespace from name", () => {
    const t = parseTypeRef("  String  ");
    expect(t.name).toBe("String");
  });

  it("handles whitespace in generic args", () => {
    const t = parseTypeRef("Map<  String ,  Int  >");
    expect(t.args[0]?.name).toBe("String");
    expect(t.args[1]?.name).toBe("Int");
  });

  it("handles single-char type names", () => {
    const t = parseTypeRef("T");
    expect(t.name).toBe("T");
    expect(t.args).toHaveLength(0);
  });

  it("handles single-char generic param", () => {
    const t = parseTypeRef("Box<T>");
    expect(t.name).toBe("Box");
    expect(t.args[0]?.name).toBe("T");
  });
});

describe("[CONV-TYPEREF-PRINT] printTypeRef", () => {
  it("prints a simple type", () => {
    expect(printTypeRef({ name: "Int", args: [], resolution: { kind: "external" } })).toBe("Int");
  });

  it("prints a generic type", () => {
    const t = parseTypeRef("Option<String>");
    expect(printTypeRef(t)).toBe("Option<String>");
  });

  it("round-trips a deeply nested type", () => {
    const original = "Map<String, Option<List<Int>>>";
    expect(printTypeRef(parseTypeRef(original))).toBe(original);
  });

  it("round-trips triple generic", () => {
    const original = "Triple<A, B, C>";
    expect(printTypeRef(parseTypeRef(original))).toBe(original);
  });

  it("round-trips four levels of nesting", () => {
    const original = "A<B<C<D<E>>>>";
    expect(printTypeRef(parseTypeRef(original))).toBe(original);
  });
});
