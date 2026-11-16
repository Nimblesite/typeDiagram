import { describe, expect, it } from "vitest";
import { generateOspreyModule } from "../../src/converters/osprey.js";
import { modelFromTd, unwrap } from "./helpers.js";

// [CONV-OSPREY] Generate app-side models from the same bridge schema.
describe("Osprey model generation", () => {
  it("emits aliases, generic records, union fields and nested optional lists", () => {
    expect(generateOspreyModule).toBeTypeOf("function");
    const source = unwrap(
      generateOspreyModule(
        modelFromTd(`
      alias Id = Int
      type Box<T> { value: T }
      type Node { id: Id title: String selected: Bool children: List<Node> parent: Option<Id> weight: Float }
      union Event { Idle {} Selected { id: Id } Batch { nodes: List<Node> } }
    `)
      )
    );
    expect(source).toContain("type Id = int");
    expect(source).toContain("type Box T =\n    value : T");
    expect(source).toContain("children : List<Node>");
    expect(source).toContain("parent : Option<Id>");
    expect(source).toContain("selected : bool");
    expect(source).toContain("weight : float");
    expect(source).toContain(
      "type Event =\n    Idle\n    Selected\n        id : Id\n    Batch\n        nodes : List<Node>"
    );
    for (const schema of [
      "union First { Same {} } union Second { Same {} }",
      "union Role { List {} }",
      "type Name { value: Int } union Tag { Name {} }",
    ]) {
      expect(generateOspreyModule(modelFromTd(schema))).toMatchObject({ ok: false });
    }
    for (const field of ["instance", "state", "do"]) {
      expect(generateOspreyModule(modelFromTd(`type Bad { ${field}: Int }`))).toMatchObject({ ok: false });
    }
    for (const primitive of ["Bytes", "DateTime", "Decimal"]) {
      expect(generateOspreyModule(modelFromTd(`type Unsupported { value: ${primitive} }`))).toMatchObject({
        ok: false,
      });
    }
  });
});
