// [CLI-BIN] Regression for https://github.com/Nimblesite/typeDiagram/issues/48 —
// the bin must flush ALL piped stdout before exiting. With `process.exit()` in
// bin.ts, piped output larger than one synchronous pipe write was silently
// truncated (observed: cut at exactly 8 KB with exit code 0). Black-box:
// builds the real bin with tsc, then spawns it with stdout as a pipe.
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { beforeAll, describe, expect, it } from "vitest";

const run = promisify(execFile);
const PKG_ROOT = fileURLToPath(new URL("..", import.meta.url));
const BIN = join(PKG_ROOT, "dist", "bin.js");
const TSC = join(dirname(createRequire(import.meta.url).resolve("typescript/package.json")), "bin", "tsc");

// Enough types that the Rust emission far exceeds the 64 KB kernel pipe
// buffer, so a premature exit cannot have flushed the tail synchronously.
const TYPE_COUNT = 1500;

const bigTdSource = () => {
  const types = Array.from(
    { length: TYPE_COUNT },
    (_, index) =>
      `  type Generated${String(index)} {\n` +
      `    name: String\n` +
      `    labels: List<String>\n` +
      `    description: String\n` +
      `  }`
  );
  return `typeDiagram\n\n${types.join("\n\n")}\n`;
};

describe("[CLI-BIN] bin flushes piped stdout completely (issue #48)", () => {
  let tdPath = "";

  beforeAll(async () => {
    await run(process.execPath, [TSC, "-p", "tsconfig.build.json"], { cwd: PKG_ROOT });
    tdPath = join(await mkdtemp(join(tmpdir(), "bin-flush-")), "big.td");
    await writeFile(tdPath, bigTdSource());
  }, 120_000);

  it.each([1, 2, 3])("emits every generated type through a pipe (run %i)", async () => {
    const { stdout, stderr } = await run(process.execPath, [BIN, "--to", "rust", tdPath], {
      maxBuffer: 16 * 1024 * 1024,
    });
    expect(stderr).toBe("");
    expect(stdout.length).toBeGreaterThan(64 * 1024);
    expect(stdout).toContain("pub struct Generated0 ");
    expect(stdout).toContain(`pub struct Generated${String(TYPE_COUNT - 1)} `);
    expect(stdout.trimEnd().endsWith("}")).toBe(true);
  });
});
