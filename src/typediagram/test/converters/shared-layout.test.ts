import { describe, expect, it } from "vitest";
import { generateSharedC } from "../../src/converters/shared-c.js";
import { generateSharedLayout } from "../../src/converters/shared-layout.js";
import { expectErrorMessages, modelFromTd, unwrap } from "./helpers.js";

// [CONV-SHARED-LAYOUT] Shared offsets are independent of wire codecs/object layouts.
describe("shared memory layout", () => {
  it("lays out inline identities, dynamic references, optional values and union tags", async () => {
    expect(generateSharedLayout).toBeTypeOf("function");
    const schema = `alias Instance = Uuid
      alias Label = String
      type Caption { text: Label }
      type Owner { app: Instance serial: Int }
      type Ref { app: Instance slot: Int generation: Int offset: Int }
      type Lease { owner: Owner reference: Ref }
      type Node { label: String children: List<Node> active: Bool owner: Owner }
      union Event { Empty {} Count { value: Int } NodeValue { value: Node } }
      type Request { previous: Option<Owner> event: Event }`;
    const layout = unwrap(await generateSharedLayout(modelFromTd(schema), 8));
    expect(layout.declarations.find((decl) => decl.name === "Owner")).toMatchObject({ bytes: 24, inline: true });
    expect(layout.declarations.find((decl) => decl.name === "Ref")).toMatchObject({ bytes: 40, inline: true });
    expect(layout.declarations.find((decl) => decl.name === "Lease")).toMatchObject({ bytes: 64, inline: true });
    expect(layout.declarations.find((decl) => decl.name === "Node")).toMatchObject({
      bytes: 128,
      inline: false,
      fields: [
        { name: "label", offset: 0, bytes: 48 },
        { name: "children", offset: 48, bytes: 48 },
        { name: "active", offset: 96, bytes: 8 },
        { name: "owner", offset: 104, bytes: 24 },
      ],
    });
    expect(layout.declarations.find((decl) => decl.name === "Event")).toMatchObject({
      bytes: 48,
      inline: false,
      variants: [
        { name: "Empty", tag: 0 },
        { name: "Count", tag: 1 },
        { name: "NodeValue", tag: 2 },
      ],
    });
    expect(layout.declarations.find((decl) => decl.name === "Request")).toMatchObject({ bytes: 72 });
    expect(layout.declarations.find((decl) => decl.name === "Caption")).toMatchObject({
      bytes: 48,
      fields: [{ name: "text", bytes: 48, storage: "bytes" }],
    });
    expect(layout.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(unwrap(await generateSharedLayout(modelFromTd(schema + "\n"), 8)).fingerprint).toBe(layout.fingerprint);
    expect(unwrap(await generateSharedLayout(modelFromTd(schema), 4)).fingerprint).not.toBe(layout.fingerprint);
    expect(
      unwrap(await generateSharedLayout(modelFromTd(schema.replace("serial:", "counter:")), 8)).fingerprint
    ).not.toBe(layout.fingerprint);
    expect(await generateSharedLayout(modelFromTd("type Bad { value: Map<String, Int> }"), 8)).toMatchObject({
      ok: false,
    });
  });
  it("caps inline copying and makes recursive declaration order irrelevant", async () => {
    for (const cyclic of ["alias A = A", "alias A = B\nalias B = A", "alias A = Option<A>"]) {
      expect(await generateSharedLayout(modelFromTd(cyclic), 8)).toMatchObject({ ok: false });
    }
    const declarations = [
      "type Large { a: Int b: Int c: Int d: Int e: Int f: Int g: Int h: Int i: Int }",
      "alias LargeAlias = Large",
      "type Holder { value: LargeAlias next: Option<Holder> }",
      "alias Link = Node",
      "type Node { next: Option<Link> }",
      "type Left { right: Right }",
      "type Right { left: Left }",
    ];
    const layout = unwrap(await generateSharedLayout(modelFromTd(declarations.join("\n")), 8));
    expect(await generateSharedLayout(modelFromTd("type Valid { value: Int }"), 16)).toMatchObject({
      ok: false,
    });
    expect(layout).toMatchObject({ abiMajor: 1, endian: "little", alignment: 8, inlineLimit: 64 });
    expect(layout.declarations.find((decl) => decl.name === "Node")).toMatchObject({
      bytes: 48,
      inline: false,
      fields: [{ name: "next", bytes: 48, storage: "optional", value: { bytes: 40, storage: "reference" } }],
    });
    expect(layout.declarations.find((decl) => decl.name === "Large")).toMatchObject({ bytes: 72, inline: false });
    expect(layout.declarations.find((decl) => decl.name === "Holder")).toMatchObject({
      bytes: 88,
      fields: [
        { name: "value", bytes: 40, storage: "reference" },
        { name: "next", bytes: 48, storage: "optional" },
      ],
    });
    expect(unwrap(await generateSharedLayout(modelFromTd(declarations.reverse().join("\n")), 8))).toEqual(layout);
  });
});

// [CONV-SHARED-C] The C profile reuses generateSharedLayout verbatim and emits constants only.
describe("shared memory C profile", () => {
  const schema = `alias Instance = Uuid
    type Owner { app: Instance serial: Int }
    type Ref { app: Instance slot: Int }
    type Lease { owner: Owner reference: Ref }
    type Node { label: String children: List<Node> }
    union Event { Empty {} Count { value: Int } NodeValue { value: Node } }
    type Request { previous: Option<Owner> event: Event }`;

  it("emits guard, fingerprint, profile macros, typedefs, asserts and offset constants", async () => {
    const model = modelFromTd(schema);
    const c = unwrap(await generateSharedC(model, 8));
    expect(c).toContain("#ifndef TD_SHARED_H\n#define TD_SHARED_H");
    expect(c).toContain("#include <stddef.h>");
    expect(c).toContain(`#define TD_SHARED_FINGERPRINT "${unwrap(await generateSharedLayout(model, 8)).fingerprint}"`);
    expect(c).toContain("#define TD_SHARED_POINTER_BYTES 8");
    expect(c).toContain("#define TD_SHARED_ABI_MAJOR 1");
    expect(c.trim().endsWith("#endif")).toBe(true);
    expect(c).toContain("TD_SHARED_STORAGE(Owner, 24);");
    expect(c).toContain("sizeof(td_##name) == (byte_count)");
    expect(c).toContain("_Alignof(td_##name) == 8");
    expect(c).toContain("TD_SHARED_STORAGE(Lease, 48);");
    expect(c).toContain("#define TD_Lease_owner_OFFSET 0");
    expect(c).toContain("#define TD_Lease_owner_BYTES 24");
    expect(c).toContain("#define TD_Lease_reference_OFFSET 24");
    expect(c).toContain("#define TD_Request_previous_OFFSET 0");
    expect(c).toContain("#define TD_Request_previous_BYTES 32");
    expect(c).toContain("#define TD_Request_event_BYTES 40");
    expect(c).toContain("#define TD_Event_Empty_TAG 0");
    expect(c).toContain("#define TD_Event_Count_TAG 1");
    expect(c).toContain("#define TD_Event_NodeValue_TAG 2");
    expect(c).toContain("#define TD_Event_Count_value_OFFSET 8");
    expect(c).toContain("#define TD_Event_Count_value_BYTES 8");
    expect(c).toContain("#define TD_Event_NodeValue_value_OFFSET 8");
    expect(c).toContain("#define TD_Event_NodeValue_value_BYTES 40");
    expect(c).toContain("TD_SHARED_STORAGE(Node, 96);");
    // Constants only: deterministic output, no pointers, accessors, codec, or view validation.
    expect(unwrap(await generateSharedC(model, 8))).toBe(c);
    expect(c).not.toContain("*");
    expect(unwrap(await generateSharedC(modelFromTd(schema), 4))).toContain("#define TD_SHARED_POINTER_BYTES 4");
  });

  it("passes generator errors through unchanged and rejects zero sizes and injectable identifiers", async () => {
    expectErrorMessages(await generateSharedC(modelFromTd("alias A = A"), 8), ["shared-layout:"]);
    expectErrorMessages(await generateSharedC(modelFromTd("type Bad { value: Map<String, Int> }"), 8), [
      "shared-layout:",
    ]);
    expectErrorMessages(await generateSharedC(modelFromTd(schema), 16), ["unsupported pointer profile"]);
    expectErrorMessages(await generateSharedC(modelFromTd("alias Nothing = Unit"), 8), [
      "zero-size declaration 'Nothing'",
    ]);
    const solo = modelFromTd("type Solo { a: Int }");
    const poisonDecl = { ...solo, decls: solo.decls.map((d) => (d.name === "Solo" ? { ...d, name: "Solo };" } : d)) };
    expectErrorMessages(await generateSharedC(poisonDecl, 8), ["invalid C identifier", "Solo"]);
    const poisonField = {
      ...solo,
      decls: solo.decls.map((d) =>
        d.kind === "record" ? { ...d, fields: d.fields.map((f) => ({ ...f, name: "a\n#define EVIL 1" })) } : d
      ),
    };
    expectErrorMessages(await generateSharedC(poisonField, 8), ["invalid C identifier", "a"]);
    const events = modelFromTd("union Event { Count { value: Int } }");
    const poisonVariant = {
      ...events,
      decls: events.decls.map((d) =>
        d.kind === "union" ? { ...d, variants: d.variants.map((v) => ({ ...v, name: "Count)" })) } : d
      ),
    };
    expectErrorMessages(await generateSharedC(poisonVariant, 8), ["invalid C identifier", "Count)"]);
  });

  it("rejects colliding C symbols and emits selected declarations with the complete fingerprint", async () => {
    const collision = modelFromTd("type A_B { c: Int }\ntype A { B_c: Int }");
    expectErrorMessages(await generateSharedC(collision, 8), ["C symbol collision"]);
    const model = modelFromTd(schema);
    const selected = unwrap(await generateSharedC(model, 8, ["Owner", "Lease"]));
    expect(selected).toContain("TD_SHARED_STORAGE(Owner,");
    expect(selected).toContain("TD_SHARED_STORAGE(Lease,");
    expect(selected).not.toContain("TD_SHARED_STORAGE(Node,");
    expect(selected).toContain(unwrap(await generateSharedLayout(model, 8)).fingerprint);
    expectErrorMessages(await generateSharedC(model, 8, ["Missing"]), ["unknown declaration"]);
    const solo = modelFromTd("type Solo { a: Int }");
    const newline = { ...solo, decls: solo.decls.map((d) => ({ ...d, name: d.name + "\n" })) };
    expectErrorMessages(await generateSharedC(newline, 8), ["invalid C identifier"]);
  });
});
