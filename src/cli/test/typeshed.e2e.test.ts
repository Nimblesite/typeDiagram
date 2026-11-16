// [TYPESHED-BULK-TEST] Black-box repository conversion through the public CLI function.
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { typeshedMain } from "../src/typeshed-cli.js";
import { makeStream } from "./helpers.js";

const createStubRoot = async (source: string) => {
  const root = await mkdtemp(join(tmpdir(), "typediagram-typeshed-invalid-"));
  await Promise.all([
    mkdir(join(root, "stdlib"), { recursive: true }),
    mkdir(join(root, "stubs"), { recursive: true }),
  ]);
  await writeFile(join(root, "stdlib", "sample.pyi"), source, "utf8");
  return root;
};

describe("[TYPESHED-BULK] typeshed repository conversion", () => {
  it("mirrors stdlib and third-party stubs, skips empty modules, and retains no methods", async () => {
    const root = await mkdtemp(join(tmpdir(), "typediagram-typeshed-source-"));
    const output = await mkdtemp(join(tmpdir(), "typediagram-typeshed-output-"));
    await mkdir(join(root, "stdlib"), { recursive: true });
    await mkdir(join(root, "stubs", "package", "package"), { recursive: true });
    await writeFile(
      join(root, "stdlib", "sample.pyi"),
      "class Payload:\n    value: str\n    def encode(self) -> bytes: ...\n\ndef fetch(payload: Payload) -> bytes: ...\n",
      "utf8"
    );
    await writeFile(join(root, "stdlib", "empty.pyi"), "from sample import Payload\n", "utf8");
    await writeFile(
      join(root, "stubs", "package", "package", "__init__.pyi"),
      "from typing import TypedDict\nclass Config(TypedDict):\n    enabled: bool\n",
      "utf8"
    );

    const stdout = makeStream();
    const stderr = makeStream();
    const code = await typeshedMain([root, output], stdout.stream, stderr.stream);
    const stdlib = await readFile(join(output, "stdlib", "sample.td"), "utf8");
    const thirdParty = await readFile(join(output, "stubs", "package", "package", "__init__.td"), "utf8");
    expect(code).toBe(0);
    expect(stderr.text()).toBe("");
    expect(stdout.text()).toBe("converted 2 typeshed files (3 declarations); skipped 1 files without declarations\n");
    expect(stdlib).toContain("type Payload");
    expect(stdlib).toContain("function fetch(payload: Payload) -> Bytes");
    expect(stdlib).not.toContain("encode");
    expect(thirdParty).toContain("type Config");
    expect(await readdir(join(output, "stdlib"))).toEqual(["sample.td"]);
  });

  it("reports missing arguments and invalid roots without partial success", async () => {
    const stdout = makeStream();
    const stderr = makeStream();
    expect(await typeshedMain([], stdout.stream, stderr.stream)).toBe(1);
    expect(stderr.text()).toContain("usage: typediagram-typeshed");
    const missingOutputError = makeStream();
    expect(await typeshedMain(["/typeshed"], stdout.stream, missingOutputError.stream)).toBe(1);
    expect(missingOutputError.text()).toContain("usage: typediagram-typeshed");
    const missingError = makeStream();
    expect(await typeshedMain(["/missing/typeshed", "/tmp/output"], stdout.stream, missingError.stream)).toBe(1);
    expect(missingError.text()).toContain("cannot scan typeshed root");
    const invalidRoot = await createStubRoot("def broken(: ...");
    const invalidOutput = await mkdtemp(join(tmpdir(), "typediagram-typeshed-invalid-output-"));
    const invalidError = makeStream();
    expect(await typeshedMain([invalidRoot, invalidOutput], stdout.stream, invalidError.stream)).toBe(1);
    expect(invalidError.text()).toContain("Invalid typeshed/Python stub syntax");
    const validRoot = await createStubRoot("class Valid:\n    value: str\n");
    const blockedOutput = join(await mkdtemp(join(tmpdir(), "typediagram-typeshed-blocked-")), "output");
    await writeFile(blockedOutput, "not a directory", "utf8");
    const writeError = makeStream();
    expect(await typeshedMain([validRoot, blockedOutput], stdout.stream, writeError.stream)).toBe(1);
    expect(writeError.text()).toContain("cannot write");
    const unreadableRoot = await mkdtemp(join(tmpdir(), "typediagram-typeshed-unreadable-"));
    await Promise.all([
      mkdir(join(unreadableRoot, "stdlib", "directory.pyi"), { recursive: true }),
      mkdir(join(unreadableRoot, "stubs"), { recursive: true }),
    ]);
    const readError = makeStream();
    expect(await typeshedMain([unreadableRoot, invalidOutput], stdout.stream, readError.stream)).toBe(1);
    expect(readError.text()).toContain("cannot convert");
  });
});
