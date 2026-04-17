// [CLI-PIPELINE-DOCS] Proves the multi-language-pipeline doc: one .td file
// generates TS + Rust + SVG outputs via the real CLI, all from the same source.
// Mirrors the Makefile pattern shown in docs/specs/multi-language-pipeline.md.
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../src/cli.js";

const makeStream = () => {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk));
      cb();
    },
  });
  return { stream, text: () => chunks.join("") };
};

const SCHEMA = `typeDiagram

type User {
  id:    String
  name:  String
  email: String
}

type Order {
  id:    String
  total: Float
}
`;

const runCli = async (argv: ReadonlyArray<string>): Promise<{ code: number; stdout: string; stderr: string }> => {
  const out = makeStream();
  const err = makeStream();
  const code = await main([...argv], out.stream, err.stream);
  return { code, stdout: out.text(), stderr: err.text() };
};

describe("[CLI-PIPELINE-DOCS] multi-language pipeline doc examples", () => {
  it("generates TypeScript + Rust + SVG from the same schema in a repo-style layout", async () => {
    // Set up the layout the doc describes: schemas/ + frontend/src/generated + backend/src/generated
    const root = await mkdtemp(join(tmpdir(), "td-pipeline-"));
    const schemasDir = join(root, "schemas");
    const tsOutDir = join(root, "frontend", "src", "generated");
    const rsOutDir = join(root, "backend", "src", "generated");
    await mkdir(schemasDir, { recursive: true });
    await mkdir(tsOutDir, { recursive: true });
    await mkdir(rsOutDir, { recursive: true });

    const schemaPath = join(schemasDir, "user.td");
    await writeFile(schemaPath, SCHEMA, "utf8");

    // --to typescript
    const ts = await runCli(["--to", "typescript", schemaPath]);
    expect(ts.stderr).toBe("");
    expect(ts.code).toBe(0);
    expect(ts.stdout).toContain("export interface User");
    expect(ts.stdout).toContain("export interface Order");
    expect(ts.stdout).toContain("id: string");
    expect(ts.stdout).toContain("total: number");
    const tsFile = join(tsOutDir, "user.ts");
    await writeFile(tsFile, ts.stdout, "utf8");

    // --to rust
    const rs = await runCli(["--to", "rust", schemaPath]);
    expect(rs.stderr).toBe("");
    expect(rs.code).toBe(0);
    expect(rs.stdout).toContain("pub struct User");
    expect(rs.stdout).toContain("pub struct Order");
    expect(rs.stdout).toContain("pub id: String");
    expect(rs.stdout).toContain("pub total: f64");
    const rsFile = join(rsOutDir, "user.rs");
    await writeFile(rsFile, rs.stdout, "utf8");

    // default (SVG)
    const svg = await runCli([schemaPath]);
    expect(svg.stderr).toBe("");
    expect(svg.code).toBe(0);
    expect(svg.stdout).toMatch(/^<svg[\s>]/);
    expect(svg.stdout).toContain("User");
    expect(svg.stdout).toContain("Order");

    // The two language outputs describe the SAME set of types by name — this is the
    // whole point of the pipeline: one schema, N languages, all aligned.
    const tsText = await readFile(tsFile, "utf8");
    const rsText = await readFile(rsFile, "utf8");
    for (const typeName of ["User", "Order"]) {
      expect(tsText).toContain(typeName);
      expect(rsText).toContain(typeName);
    }
  });

  it.each([
    { lang: "typescript", expect: "export interface User" },
    { lang: "rust", expect: "pub struct User" },
    { lang: "python", expect: "class User" },
    { lang: "go", expect: "type User struct" },
    { lang: "csharp", expect: "record User" },
  ])("--to $lang emits $lang source for a simple record", async ({ lang, expect: needle }) => {
    const root = await mkdtemp(join(tmpdir(), "td-pipeline-"));
    const schemaPath = join(root, "s.td");
    await writeFile(schemaPath, "typeDiagram\n\ntype User { id: String, name: String }\n", "utf8");

    const { code, stderr, stdout } = await runCli(["--to", lang, schemaPath]);
    expect(stderr).toBe("");
    expect(code).toBe(0);
    expect(stdout).toContain(needle);
  });
});
