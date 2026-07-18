// [EDITOR-SOURCE-TEST] Whole-model editing scenario matching visual-canvas actions.
import { describe, expect, it } from "vitest";
import {
  addDeclaration,
  addRow,
  connectDeclarations,
  editRow,
  removeDeclaration,
  removeRow,
  renameDeclaration,
} from "../src/editor/index.js";
import { parse } from "../src/parser/index.js";
import { buildModel } from "../src/model/index.js";

const SOURCE = `typeDiagram

type User {
  id: Int
  email: String
}

type Team {
  members: List<User>
}

union Result {
  Ok
  Error { message: String }
}

alias Owner = User
`;

const value = (result: ReturnType<typeof renameDeclaration>) => {
  expect(result.ok).toBe(true);
  return result.ok ? result.value : "";
};

describe("[EDITOR-SOURCE] visual operations preserve a valid, connected type model", () => {
  it("renames declarations and edits/adds/removes/connects record, union, and alias rows", () => {
    const renamed = value(renameDeclaration(SOURCE, "User", "Person"));
    expect(renamed).toContain("type Person");
    expect(renamed).toContain("List<Person>");
    expect(renamed).toContain("alias Owner = Person");

    const fieldEdited = value(editRow(renamed, "Person", 1, { name: "primary_email", type: "Option<String>" }));
    expect(fieldEdited).toContain("primary_email: Option<String>");

    const rowAdded = value(addRow(fieldEdited, "Person"));
    expect(rowAdded).toContain("field: String");
    const rowRemoved = value(removeRow(rowAdded, "Person", 0));
    expect(rowRemoved).not.toContain("id: Int");

    const recordConnected = value(connectDeclarations(rowRemoved, "Person", -1, "Team"));
    expect(recordConnected).toContain("team: Team");
    const rowConnected = value(connectDeclarations(recordConnected, "Person", 0, "Team"));
    expect(rowConnected).toContain("primary_email: Team");

    const unionConnected = value(connectDeclarations(rowConnected, "Result", 0, "Person"));
    expect(unionConnected).toContain("Ok(Person)");
    const aliasConnected = value(connectDeclarations(unionConnected, "Owner", -1, "Team"));
    expect(aliasConnected).toContain("alias Owner = Team");

    const parsed = parse(aliasConnected);
    const model = parsed.ok ? buildModel(parsed.value) : parsed;
    expect(parsed.ok).toBe(true);
    expect(model.ok).toBe(true);
    expect(model.ok ? model.value.edges.some((edge) => edge.targetDeclName === "Team") : false).toBe(true);
  });

  it("returns specific failures without corrupting source", () => {
    const missing = renameDeclaration(SOURCE, "Missing", "Other");
    const invalidType = editRow(SOURCE, "User", 0, { type: "List<" });
    expect(missing).toEqual({ ok: false, error: { message: "Unknown declaration 'Missing'" } });
    expect(invalidType.ok).toBe(false);
    expect(invalidType.ok ? "" : invalidType.error.message).toContain("expected");
  });

  it("handles every declaration kind plus malformed and missing edit targets", () => {
    const invalidSource = renameDeclaration("@@@", "User", "Person");
    const invalidModel = renameDeclaration("type A {}\ntype A {}", "A", "B");
    const emptyName = renameDeclaration(SOURCE, "User", "  ");
    expect(invalidSource.ok).toBe(false);
    expect(invalidModel.ok).toBe(false);
    expect(emptyName.ok).toBe(false);

    const unionNamed = value(editRow(SOURCE, "Result", 0, { name: "Success" }));
    const unionTyped = value(editRow(unionNamed, "Result", 0, { type: "List<User>" }));
    expect(unionTyped).toContain("Success(List<User>)");
    const aliasTyped = value(editRow(unionTyped, "Owner", 0, { type: "Map<String, Team>" }));
    expect(aliasTyped).toContain("alias Owner = Map<String, Team>");

    const unionAdded = value(addRow(aliasTyped, "Result"));
    expect(unionAdded).toContain("Variant");
    const unionRemoved = value(removeRow(unionAdded, "Result", 2));
    expect(unionRemoved).not.toContain("Variant");
    expect(value(addRow(unionRemoved, "Owner"))).toBe(unionRemoved);
    expect(value(removeRow(unionRemoved, "Owner", 0))).toBe(unionRemoved);

    const unionConnected = value(connectDeclarations(unionRemoved, "Result", -1, "Team"));
    expect(unionConnected).toContain("Team(Team)");
    const unchangedRow = value(editRow(unionConnected, "User", 99, { name: "missing", type: "String" }));
    expect(unchangedRow).not.toContain("missing:");

    expect(editRow(SOURCE, "Missing", 0, { name: "x" }).ok).toBe(false);
    expect(addRow(SOURCE, "Missing").ok).toBe(false);
    expect(removeRow(SOURCE, "Missing", 0).ok).toBe(false);
    expect(connectDeclarations(SOURCE, "Missing", -1, "User").ok).toBe(false);
    expect(connectDeclarations(SOURCE, "User", -1, "Missing").ok).toBe(false);
  });

  it("adds uniquely named ADTs and removes only the selected declaration", () => {
    const record = value(addDeclaration(SOURCE, "record"));
    const secondRecord = value(addDeclaration(record, "record"));
    const union = value(addDeclaration(secondRecord, "union"));
    const alias = value(addDeclaration(union, "alias"));
    expect(alias).toContain("type NewRecord");
    expect(alias).toContain("type NewRecord2");
    expect(alias).toContain("union NewUnion");
    expect(alias).toContain("alias NewAlias = String");

    const removed = value(removeDeclaration(alias, "User"));
    expect(removed).not.toContain("type User {");
    expect(removed).toContain("members: List<User>");
    expect(removed).toContain("alias Owner = User");
    expect(removeDeclaration(SOURCE, "Missing")).toEqual({
      ok: false,
      error: { message: "Unknown declaration 'Missing'" },
    });
    expect(addDeclaration("@@@", "record").ok).toBe(false);
    expect(removeDeclaration("@@@", "User").ok).toBe(false);
  });

  it("connects to a generic node without committing an unrecoverable bare generic reference", () => {
    const genericSource = `${SOURCE}\nunion Option<T> {\n  Some { value: T }\n  None\n}\n`;
    const connected = connectDeclarations(genericSource, "User", -1, "Option");
    expect(connected.ok).toBe(true);
    const next = connected.ok ? connected.value : "";
    expect(next).toContain("option: Option<Any>");
    const parsed = parse(next);
    expect(parsed.ok).toBe(true);
    const model = parsed.ok ? buildModel(parsed.value) : parsed;
    expect(model.ok).toBe(true);
    expect(model.ok ? model.value.edges.some((edge) => edge.targetDeclName === "Option") : false).toBe(true);
  });

  it("rejects a bare generic field edit before it can replace the live diagram", () => {
    const genericSource = `${SOURCE}\nunion Option<T> {\n  Some { value: T }\n  None\n}\n`;
    const edited = editRow(genericSource, "User", 0, { type: "Option" });
    expect(edited.ok).toBe(false);
    expect(edited.ok ? edited.value : edited.error.message).toContain("takes 1 type argument(s), got 0");
    expect(genericSource).toContain("id: Int");
    expect(genericSource).not.toContain("id: Option");
    const originalModel = parse(genericSource);
    expect(originalModel.ok).toBe(true);
  });
});
