// [CLI-CONFIG-GENERATE-TEST] One config drives atomic multi-language generation
// and repeated source-file regeneration through the real CLI entry point.
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { main } from "../src/cli.js";
import { makeStream, run } from "./helpers.js";

const source = (fields: string) => `typeDiagram

type Person {
${fields}
}
`;

const runConfig = async (root: string, name: string, value: unknown) => {
  const path = join(root, name);
  await writeFile(path, typeof value === "string" ? value : JSON.stringify(value), "utf8");
  return run(["--config", path]);
};

const expectFailure = (result: Awaited<ReturnType<typeof run>>, message: string) => {
  expect(result.code).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain(message);
};

const expectGeneratedFields = async (typeScriptPath: string, rustPath: string, tsField: string, rustField: string) => {
  expect(await readFile(typeScriptPath, "utf8")).toContain(tsField);
  expect(await readFile(rustPath, "utf8")).toContain(rustField);
};

describe("[CLI-CONFIG-GENERATE] configured ADT generation", () => {
  it("generates every selected language and regenerates after valid, invalid, and recovered edits", async () => {
    const root = await mkdtemp(join(tmpdir(), "td-config-generate-"));
    const configPath = join(root, "typediagram.json");
    const sourcePath = join(root, "schemas", "person.td");
    const typeScriptPath = join(root, "generated", "web", "person.ts");
    const rustPath = join(root, "generated", "server", "person.rs");
    await mkdir(join(root, "schemas"), { recursive: true });
    await writeFile(sourcePath, source("  id: Int"), "utf8");
    await writeFile(
      configPath,
      JSON.stringify({
        source: "schemas/person.td",
        outputs: {
          typescript: "generated/web/person.ts",
          rust: "generated/server/person.rs",
        },
      }),
      "utf8"
    );

    const initial = await run(["--config", configPath]);
    expect(initial.code).toBe(0);
    expect(initial.stderr).toBe("");
    expect(initial.stdout).toContain(`generated typescript -> ${typeScriptPath}`);
    expect(initial.stdout).toContain(`generated rust -> ${rustPath}`);
    expect(await readFile(typeScriptPath, "utf8")).toContain("export interface Person");
    expect(await readFile(typeScriptPath, "utf8")).toContain("id: number");
    expect(await readFile(rustPath, "utf8")).toContain("pub struct Person");
    expect(await readFile(rustPath, "utf8")).toContain("pub id: i64");

    await writeFile(
      configPath,
      JSON.stringify({
        source: "schemas/person.td",
        watch: true,
        outputs: {
          typescript: "generated/web/person.ts",
          rust: "generated/server/person.rs",
        },
      }),
      "utf8"
    );

    const out = makeStream();
    const err = makeStream();
    const controller = new AbortController();
    const watched = main(["--config", configPath], out.stream, err.stream, controller.signal);
    await vi.waitFor(() => {
      expect(out.text()).toContain(`watching ${sourcePath}`);
    });
    await writeFile(sourcePath, source("  id: Int\n  name: String"), "utf8");
    await vi.waitFor(() => expectGeneratedFields(typeScriptPath, rustPath, "name: string", "pub name: String"));
    const lastGoodTypeScript = await readFile(typeScriptPath, "utf8");
    const lastGoodRust = await readFile(rustPath, "utf8");

    await writeFile(sourcePath, `${source("  id: Int\n  name: String")}active`, "utf8");
    await vi.waitFor(() => {
      expect(err.text()).toContain("expected 'type', 'union', 'untagged union', or 'alias'");
    });
    expect(await readFile(typeScriptPath, "utf8")).toBe(lastGoodTypeScript);
    expect(await readFile(rustPath, "utf8")).toBe(lastGoodRust);
    expect(lastGoodTypeScript).not.toContain("active: boolean");
    expect(lastGoodRust).not.toContain("pub active: bool");

    await writeFile(sourcePath, source("  id: Int\n  name: String\n  active: Bool"), "utf8");
    await vi.waitFor(() => expectGeneratedFields(typeScriptPath, rustPath, "active: boolean", "pub active: bool"));
    controller.abort();
    expect(await watched).toBe(0);
    expect(out.text().split("generated typescript ->").length - 1).toBeGreaterThanOrEqual(3);
    expect(out.text().split("generated rust ->").length - 1).toBeGreaterThanOrEqual(3);
    expect(out.text()).toContain("watch stopped");
    expect(await readFile(typeScriptPath, "utf8")).not.toContain("active\n");
    expect(await readFile(rustPath, "utf8")).not.toContain("active\n");
    expect((await readdir(join(root, "generated", "web"))).filter((name) => name.endsWith(".tmp"))).toEqual([]);
    expect((await readdir(join(root, "generated", "server"))).filter((name) => name.endsWith(".tmp"))).toEqual([]);

    const invalidConfigPath = join(root, "invalid.json");
    await writeFile(
      invalidConfigPath,
      JSON.stringify({ source: "schemas/person.td", outputs: { swift: "generated/person.swift" } }),
      "utf8"
    );
    const invalidConfig = await run(["--config", invalidConfigPath]);
    expectFailure(invalidConfig, "unsupported output language 'swift'");

    const invalidCases: ReadonlyArray<readonly [string, unknown, string]> = [
      ["array.json", [], "generation config must be a JSON object"],
      ["missing-source.json", { outputs: { typescript: "generated/person.ts" } }, "config.source"],
      [
        "wrong-extension.json",
        { source: "schemas/person.txt", outputs: { typescript: "generated/person.ts" } },
        "must point to a .td file",
      ],
      ["outputs-array.json", { source: "schemas/person.td", outputs: [] }, "config.outputs must be an object"],
      ["outputs-empty.json", { source: "schemas/person.td", outputs: {} }, "select at least one language"],
      [
        "output-path-empty.json",
        { source: "schemas/person.td", outputs: { typescript: "", rust: "generated/person.rs" } },
        "expects a non-empty file path",
      ],
      [
        "watch-invalid.json",
        { source: "schemas/person.td", watch: "yes", outputs: { typescript: "generated/person.ts" } },
        "config.watch must be a boolean",
      ],
      [
        "source-collision.json",
        { source: "schemas/person.td", outputs: { typescript: "schemas/person.td" } },
        "cannot overwrite the .td source",
      ],
      ["malformed.json", "{", "cannot parse"],
    ];
    for (const [name, value, message] of invalidCases) {
      expectFailure(await runConfig(root, name, value), message);
    }

    const absentConfig = await run(["--config", join(root, "absent.json")]);
    expectFailure(absentConfig, "cannot read");
    const absentSource = await runConfig(root, "absent-source.json", {
      source: "schemas/absent.td",
      outputs: { typescript: "generated/absent.ts" },
    });
    expectFailure(absentSource, "cannot read");

    await writeFile(sourcePath, source("  mystery: Mystery"), "utf8");
    const codegenFailure = await runConfig(root, "codegen-failure.json", {
      source: "schemas/person.td",
      outputs: { typescript: "generated/person.ts", rust: "generated/person.rs" },
    });
    expectFailure(codegenFailure, "unknown type 'Mystery'");

    await writeFile(sourcePath, "type Person { id: Int }\ntype Person { name: String }\n", "utf8");
    const modelFailure = await runConfig(root, "model-failure.json", {
      source: "schemas/person.td",
      outputs: { typescript: "generated/person.ts" },
    });
    expectFailure(modelFailure, "duplicate declaration 'Person'");

    await writeFile(sourcePath, source("  id: Int"), "utf8");
    const outputDirectory = join(root, "generated", "directory-output");
    await mkdir(outputDirectory, { recursive: true });
    const writeFailure = await runConfig(root, "write-failure.json", {
      source: "schemas/person.td",
      outputs: { typescript: "generated/directory-output" },
    });
    expectFailure(writeFailure, "cannot write");

    const watchFailure = await runConfig(root, "watch-failure.json", {
      source: "missing/person.td",
      watch: true,
      outputs: { typescript: "generated/missing.ts" },
    });
    expectFailure(watchFailure, "cannot watch");

    await writeFile(
      configPath,
      JSON.stringify({
        source: "schemas/person.td",
        watch: true,
        outputs: { typescript: "generated/pre-aborted.ts" },
      }),
      "utf8"
    );
    const preAborted = new AbortController();
    preAborted.abort();
    const preAbortedOut = makeStream();
    const preAbortedErr = makeStream();
    expect(await main(["--config", configPath], preAbortedOut.stream, preAbortedErr.stream, preAborted.signal)).toBe(0);
    expect(preAbortedOut.text()).toContain("watching");
    expect(preAbortedOut.text()).toContain("watch stopped");
    expect(preAbortedErr.text()).toBe("");

    const signalOut = makeStream();
    const signalErr = makeStream();
    const originalSignals = new Set(process.listeners("SIGINT"));
    const processWatched = main(["--config", configPath], signalOut.stream, signalErr.stream);
    await vi.waitFor(() => {
      expect(signalOut.text()).toContain("watching");
    });
    const stop = process.listeners("SIGINT").find((listener) => !originalSignals.has(listener));
    expect(stop).toBeDefined();
    stop?.();
    expect(await processWatched).toBe(0);
    expect(signalOut.text()).toContain("watch stopped");
    expect(signalErr.text()).toBe("");
    expect(process.listeners("SIGINT")).toEqual([...originalSignals]);
  });
});
