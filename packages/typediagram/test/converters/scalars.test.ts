// [CONV-SCALARS] Semantic scalars DateTime/Uuid/Decimal across all 9 converters,
// plus [MODEL-CODEGEN-UNKNOWN] hard rejection of unknown type identifiers (GH issue #38).
import { describe, expect, it } from "vitest";
import { byLanguage, python, csharp, typescript, go, rust } from "../../src/converters/index.js";
import type { Language } from "../../src/converters/index.js";
import { parse } from "../../src/parser/index.js";
import { buildModel, validateForCodegen } from "../../src/model/index.js";
import type { Model } from "../../src/model/index.js";
import { unwrap } from "./helpers.js";

const SCALARS_TD = `type AuditEvent {
  id: Uuid
  createdAt: DateTime
  amount: Decimal
  parent: Option<Uuid>
  history: List<DateTime>
  totals: Map<String, Decimal>
}

union PaymentState {
  Pending
  Settled { at: DateTime }
  Refunded { ref: Uuid }
}

alias EventTimes = Map<Uuid, DateTime>
`;

const scalarModel = (): Model => unwrap(buildModel(unwrap(parse(SCALARS_TD))));

const fieldTypeName = (model: Model, declName: string, fieldName: string): string => {
  const decl = model.decls.find((d) => d.name === declName);
  const field = decl?.kind === "record" ? decl.fields.find((f) => f.name === fieldName) : undefined;
  return field?.type.name ?? `<missing ${declName}.${fieldName}>`;
};

interface EmitCase {
  lang: Language;
  snippets: string[];
}

const EMIT_CASES: EmitCase[] = [
  {
    lang: "typescript",
    snippets: ["createdAt: string", "id: string", "amount: string", "history: Array<string>"],
  },
  {
    lang: "python",
    snippets: [
      "import datetime",
      "import uuid",
      "import decimal",
      "createdAt: datetime.datetime",
      "id: uuid.UUID",
      "amount: decimal.Decimal",
      "history: list[datetime.datetime]",
      "parent: Optional[uuid.UUID]",
      "totals: dict[str, decimal.Decimal]",
    ],
  },
  {
    lang: "rust",
    snippets: [
      "pub createdAt: chrono::DateTime<chrono::Utc>",
      "pub id: uuid::Uuid",
      "pub amount: rust_decimal::Decimal",
      "Vec<chrono::DateTime<chrono::Utc>>",
    ],
  },
  {
    lang: "go",
    snippets: ['import "time"', "createdAt time.Time", "id string", "amount string", "[]time.Time"],
  },
  {
    lang: "csharp",
    snippets: ["DateTimeOffset createdAt", "Guid id", "decimal amount", "Guid? parent"],
  },
  {
    lang: "fsharp",
    snippets: ["createdAt: DateTimeOffset", "id: Guid", "amount: decimal"],
  },
  {
    lang: "dart",
    snippets: ["final DateTime createdAt;", "final String id;", "final String amount;"],
  },
  {
    lang: "protobuf",
    snippets: [
      'import "google/protobuf/timestamp.proto";',
      "google.protobuf.Timestamp createdAt = 2;",
      "string id = 1;",
      "repeated google.protobuf.Timestamp history",
    ],
  },
  {
    lang: "php",
    snippets: ["\\DateTimeImmutable $createdAt", "string $id", "string $amount"],
  },
];

describe("[CONV-SCALARS] typeDiagram scalars -> all 9 languages", () => {
  it.each(EMIT_CASES)("emits native $lang types for DateTime/Uuid/Decimal", ({ lang, snippets }) => {
    const out = byLanguage[lang].toSource(scalarModel());
    for (const snippet of snippets) {
      expect(out).toContain(snippet);
    }
  });

  it("pydantic style maps scalars and imports their modules", () => {
    const out = python.toSource(scalarModel(), { style: "pydantic" });
    expect(out).toContain("import datetime");
    expect(out).toContain("import uuid");
    expect(out).toContain("import decimal");
    expect(out).toContain("createdAt: datetime.datetime");
    expect(out).toContain("id: uuid.UUID");
    expect(out).toContain("amount: decimal.Decimal");
  });
});

describe("[CONV-SCALARS-RESOLVE] scalars resolve as primitives, declarations still shadow", () => {
  it("DateTime/Uuid/Decimal are primitives (not externals) and user decls win over builtins", () => {
    const model = scalarModel();
    expect(model.externals).toEqual(["List", "Map", "Option"]);
    const audit = model.decls.find((d) => d.name === "AuditEvent");
    expect(audit?.kind).toBe("record");
    const fields = audit?.kind === "record" ? audit.fields : [];
    expect(fields.find((f) => f.name === "id")?.type.resolution).toEqual({ kind: "primitive" });
    expect(fields.find((f) => f.name === "createdAt")?.type.resolution).toEqual({ kind: "primitive" });
    expect(fields.find((f) => f.name === "amount")?.type.resolution).toEqual({ kind: "primitive" });

    const shadowed = unwrap(buildModel(unwrap(parse("alias Uuid = String\n\ntype W {\n  id: Uuid\n}\n"))));
    const w = shadowed.decls.find((d) => d.name === "W");
    const idField = w?.kind === "record" ? w.fields[0] : undefined;
    expect(idField?.type.resolution).toEqual({ kind: "declared", declName: "Uuid" });
    expect(csharp.toSource(shadowed)).toContain("using Uuid = string;");
  });
});

describe("[CONV-SCALARS-FROM] language sources -> scalar model refs", () => {
  it("python/csharp/typescript/go/rust native date-uuid-decimal types map back to scalars", () => {
    const pySrc = [
      "from dataclasses import dataclass",
      "import datetime, uuid, decimal",
      "",
      "@dataclass",
      "class Audit:",
      "    createdAt: datetime.datetime",
      "    id: uuid.UUID",
      "    amount: decimal.Decimal",
      "",
    ].join("\n");
    const pyModel = unwrap(python.fromSource(pySrc));
    expect(fieldTypeName(pyModel, "Audit", "createdAt")).toBe("DateTime");
    expect(fieldTypeName(pyModel, "Audit", "id")).toBe("Uuid");
    expect(fieldTypeName(pyModel, "Audit", "amount")).toBe("Decimal");

    const csModel = unwrap(
      csharp.fromSource("public sealed record Audit(DateTimeOffset createdAt, Guid id, decimal amount);\n")
    );
    expect(fieldTypeName(csModel, "Audit", "createdAt")).toBe("DateTime");
    expect(fieldTypeName(csModel, "Audit", "id")).toBe("Uuid");
    expect(fieldTypeName(csModel, "Audit", "amount")).toBe("Decimal");

    const tsModel = unwrap(typescript.fromSource("export interface Audit {\n  createdAt: Date;\n  id: string;\n}\n"));
    expect(fieldTypeName(tsModel, "Audit", "createdAt")).toBe("DateTime");

    const goModel = unwrap(
      go.fromSource("package types\n\ntype Audit struct {\n\tcreatedAt time.Time\n\tid string\n}\n")
    );
    expect(fieldTypeName(goModel, "Audit", "createdAt")).toBe("DateTime");

    const rsSrc = [
      "pub struct Audit {",
      "    pub createdAt: chrono::DateTime<chrono::Utc>,",
      "    pub id: uuid::Uuid,",
      "    pub amount: rust_decimal::Decimal,",
      "}",
      "",
    ].join("\n");
    const rsModel = unwrap(rust.fromSource(rsSrc));
    expect(fieldTypeName(rsModel, "Audit", "createdAt")).toBe("DateTime");
    expect(fieldTypeName(rsModel, "Audit", "id")).toBe("Uuid");
    expect(fieldTypeName(rsModel, "Audit", "amount")).toBe("Decimal");
  });
});

describe("[MODEL-CODEGEN-UNKNOWN] validateForCodegen rejects unknown type identifiers", () => {
  it("errors on unknown names, allows builtins/declared/generics, respects targeting", () => {
    const src = [
      "type Probe {",
      "  a: DateTime",
      "  b: Timestamp",
      "  c: Uuid",
      "  d: Instant",
      "  e: List<Frob>",
      "}",
      "",
      "@skipTargets(python)",
      "type GoOnly {",
      "  x: Mystery",
      "}",
      "",
      "union Status {",
      "  Live",
      "  Dead { cause: Reaper }",
      "}",
      "",
      "alias Target = Wormhole",
      "",
    ].join("\n");
    const model = unwrap(buildModel(unwrap(parse(src))));
    const diags = validateForCodegen(model, "python");
    expect(diags.length).toBeGreaterThan(0);
    expect(diags.every((d) => d.severity === "error")).toBe(true);
    const messages = diags.map((d) => d.message).join("\n");
    expect(messages).toContain("Timestamp");
    expect(messages).toContain("Instant");
    expect(messages).toContain("Frob");
    expect(messages).toContain("Reaper");
    expect(messages).toContain("Wormhole");
    expect(messages).not.toContain("Mystery");
    expect(messages).not.toContain("DateTime");
    expect(messages).not.toContain("Uuid");
    expect(
      validateForCodegen(model, "go")
        .map((d) => d.message)
        .join("\n")
    ).toContain("Mystery");

    const okSrc = [
      "type Known<T> {",
      "  a: List<Int>",
      "  b: Map<String, Bool>",
      "  c: Option<Float>",
      "  d: Any",
      "  e: T",
      "  f: PaymentRef",
      "}",
      "",
      "type PaymentRef {",
      "  id: Uuid",
      "}",
      "",
    ].join("\n");
    const okModel = unwrap(buildModel(unwrap(parse(okSrc))));
    expect(validateForCodegen(okModel, "python")).toEqual([]);
  });
});
