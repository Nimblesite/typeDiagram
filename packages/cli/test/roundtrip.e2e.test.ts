// [CLI-E2E-ROUNDTRIP] Polyglot chain roundtrip tests.
// Tests run IN REVERSE: start from language source files, produce .td via --emit td,
// then convert to another language, produce .td again, chain through all languages.
//
// Chain: C# → .td → Rust → .td → Python → .td → TypeScript → .td → C#
import { Readable, Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { main } from "../src/cli.js";

const fixturePath = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

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

const run = async (args: string[]) => {
  const out = makeStream();
  const err = makeStream();
  const code = await main(args, out.stream, err.stream);
  return { code, stdout: out.text(), stderr: err.text() };
};

/** Feed source string via stdin (no file arg). */
const runStdin = async (args: string[], source: string) => {
  const out = makeStream();
  const errS = makeStream();
  const fakeStdin = new Readable({
    read() {
      this.push(source);
      this.push(null);
    },
  });
  const original = process.stdin;
  Object.defineProperty(process, "stdin", {
    value: fakeStdin,
    writable: true,
    configurable: true,
  });
  try {
    const code = await main(args, out.stream, errS.stream);
    return { code, stdout: out.text(), stderr: errS.text() };
  } finally {
    Object.defineProperty(process, "stdin", {
      value: original,
      writable: true,
      configurable: true,
    });
  }
};

// ── [CLI-ROUNDTRIP-FROM] Each language source file → SVG diagram ──

describe("[CLI-ROUNDTRIP-FROM] language source → diagram", () => {
  it.each([
    { lang: "csharp", fixture: "types.cs", types: ["User", "Address", "Shape"] },
    { lang: "python", fixture: "types.py", types: ["User", "Address", "Shape"] },
    { lang: "rust", fixture: "types.rs", types: ["User", "Address", "Shape"] },
    { lang: "typescript", fixture: "types.ts", types: ["User", "Address"] },
  ] as const)("--from $lang produces SVG with $types", async ({ lang, fixture, types }) => {
    const { code, stdout, stderr } = await run(["--from", lang, fixturePath(fixture)]);
    expect(stderr).toBe("");
    expect(code).toBe(0);
    expect(stdout).toMatch(/^<svg[\s>]/);
    for (const t of types) {
      expect(stdout).toContain(t);
    }
  });
});

// ── [CLI-ROUNDTRIP-EMIT] .td → each language output ──

describe("[CLI-ROUNDTRIP-EMIT] .td → language output", () => {
  it.each([
    { lang: "csharp", markers: ["public sealed record User", "public sealed record Address"] },
    { lang: "python", markers: ["@dataclass", "class User:", "class Address:"] },
    {
      lang: "rust",
      markers: ["pub struct User", "pub struct Address", "pub enum Shape"],
    },
    {
      lang: "typescript",
      markers: ["export interface User", "export interface Address"],
    },
  ] as const)("--to $lang emits expected constructs", async ({ lang, markers }) => {
    const { code, stdout } = await run(["--to", lang, fixturePath("small.td")]);
    expect(code).toBe(0);
    for (const m of markers) {
      expect(stdout).toContain(m);
    }
  });
});

// ── [CLI-ROUNDTRIP-CHAIN] True piped chain: C# → .td → Rust → .td → Python → .td → TS → .td → C# ──
// Each step pipes its actual output as input to the next step via --emit td and stdin.

describe("[CLI-ROUNDTRIP-CHAIN] C# → .td → Rust → .td → Python → .td → TS → .td → C#", () => {
  it("chains through all languages, piping output as input", async () => {
    // Step 1: C# fixture → .td via --from csharp --emit td
    const step1 = await run(["--from", "csharp", "--emit", "td", fixturePath("types.cs")]);
    expect(step1.code).toBe(0);
    expect(step1.stdout).toContain("type User");
    const td1 = step1.stdout;

    // Step 2: .td → Rust via --to rust (piped from step 1 output)
    const step2 = await runStdin(["--to", "rust"], td1);
    expect(step2.code).toBe(0);
    expect(step2.stdout).toContain("pub struct User");
    const rustSrc = step2.stdout;

    // Step 3: Rust source → .td via --from rust --emit td
    const step3 = await runStdin(["--from", "rust", "--emit", "td"], rustSrc);
    expect(step3.code).toBe(0);
    expect(step3.stdout).toContain("type User");
    const td2 = step3.stdout;

    // Step 4: .td → Python via --to python (piped from step 3 output)
    const step4 = await runStdin(["--to", "python"], td2);
    expect(step4.code).toBe(0);
    expect(step4.stdout).toContain("class User:");
    const pySrc = step4.stdout;

    // Step 5: Python source → .td via --from python --emit td
    const step5 = await runStdin(["--from", "python", "--emit", "td"], pySrc);
    expect(step5.code).toBe(0);
    expect(step5.stdout).toContain("type User");
    const td3 = step5.stdout;

    // Step 6: .td → TypeScript via --to typescript (piped from step 5 output)
    const step6 = await runStdin(["--to", "typescript"], td3);
    expect(step6.code).toBe(0);
    expect(step6.stdout).toContain("export interface User");
    const tsSrc = step6.stdout;

    // Step 7: TypeScript source → .td via --from typescript --emit td
    const step7 = await runStdin(["--from", "typescript", "--emit", "td"], tsSrc);
    expect(step7.code).toBe(0);
    expect(step7.stdout).toContain("type User");
    const td4 = step7.stdout;

    // Step 8: .td → C# via --to csharp (full circle, piped from step 7)
    const step8 = await runStdin(["--to", "csharp"], td4);
    expect(step8.code).toBe(0);
    expect(step8.stdout).toContain("public sealed record User");
  });
});

// ── [CLI-ROUNDTRIP-CROSS] Cross-language matrix: each source × every target ──

describe("[CLI-ROUNDTRIP-CROSS] source lang → .td → every target lang", () => {
  const sources = [
    { lang: "csharp", fixture: "types.cs" },
    { lang: "python", fixture: "types.py" },
    { lang: "rust", fixture: "types.rs" },
    { lang: "typescript", fixture: "types.ts" },
  ] as const;

  const targets = [
    { lang: "csharp", marker: "public sealed record" },
    { lang: "python", marker: "@dataclass" },
    { lang: "rust", marker: "pub struct" },
    { lang: "typescript", marker: "export interface" },
  ] as const;

  for (const src of sources) {
    for (const tgt of targets) {
      it(`${src.lang} → .td → ${tgt.lang}`, async () => {
        // Source lang → .td
        const td = await run(["--from", src.lang, "--emit", "td", fixturePath(src.fixture)]);
        expect(td.code).toBe(0);
        expect(td.stdout).toContain("type");

        // .td → target lang (piped)
        const out = await runStdin(["--to", tgt.lang], td.stdout);
        expect(out.code).toBe(0);
        expect(out.stdout).toContain(tgt.marker);
      });
    }
  }
});
