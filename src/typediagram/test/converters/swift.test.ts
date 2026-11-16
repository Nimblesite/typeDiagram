import { describe, expect, it } from "vitest";
import { generateSwiftModule } from "../../src/converters/swift.js";
import { modelFromTd, unwrap } from "./helpers.js";

// [CONV-SWIFT] Logical native-host models; fixed ABI views are separate.
describe("Swift model generation", () => {
  it("emits native fields, aliases, optional arrays and named enum payloads", () => {
    expect(generateSwiftModule).toBeTypeOf("function");
    const source = unwrap(
      generateSwiftModule(
        modelFromTd(`
      alias Id = Int
      type Owner { id: Id appInstance: Uuid }
      type Frame { owner: Owner label: String enabled: Bool weight: Float children: List<Owner> selection: Option<Id> }
      union Action { Empty {} Select { id: Id } Replace { frame: Frame } }
    `)
      )
    );
    expect(source).toContain("import Foundation");
    expect(source).toContain("public init(`id`: `Id`, `appInstance`: UUID)");
    expect(source).toContain("self.`appInstance` = `appInstance`");
    expect(source).toContain("public typealias `Id` = Int64");
    expect(source).toContain("public let `appInstance`: UUID");
    expect(source).toContain("public let `weight`: Double");
    expect(source).toContain("public let `children`: [`Owner`]");
    expect(source).toContain("public let `selection`: `Id`?");
    expect(source).toContain("case `Select`(`id`: `Id`)");
    expect(source).toContain("case `Empty`");
    expect(generateSwiftModule(modelFromTd("type Cycle { next: Option<Cycle> }"))).toMatchObject({
      ok: false,
    });
    expect(generateSwiftModule(modelFromTd("type Generic<T> { value: T }"))).toMatchObject({ ok: false });
    expect(generateSwiftModule(modelFromTd("type Bad { payload: Map<String, Int> }"))).toMatchObject({
      ok: false,
    });
  });
});
