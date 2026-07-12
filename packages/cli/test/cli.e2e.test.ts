// [CLI-E2E] Full CLI: argv -> parse -> renderToString -> stdout / diagnostics -> stderr, exit code.
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { versionJson, versionText } from "../src/version.js";
import { fixturePath, run, runStdin } from "./helpers.js";

describe("[CLI-E2E] typediagram CLI", () => {
  it.each([
    {
      file: "small.td",
      names: ["User", "Address", "Shape", "Option", "Email"],
    },
    {
      file: "chat-model.td",
      names: ["ChatRequest", "ToolResultContent", "ContentItem", "UriKind", "Option"],
    },
  ])("renders spec example $file to SVG on stdout (exit 0)", async ({ file, names }) => {
    const { code, stdout, stderr } = await run([fixturePath(file)]);
    expect(stderr).toBe("");
    expect(code).toBe(0);
    expect(stdout).toMatch(/^<svg[\s>]/);
    for (const name of names) {
      expect(stdout).toContain(name);
    }
  });

  it("reports parse errors to stderr with exit 1", async () => {
    const { code, stderr } = await run([fixturePath("bad.td")]);
    expect(code).toBe(1);
    expect(stderr.length).toBeGreaterThan(0);
  });

  it("fails cleanly when file is missing", async () => {
    const { code, stderr } = await run(["/no/such/path.td"]);
    expect(code).toBe(1);
    expect(stderr).toMatch(/cannot read/);
  });

  it("--help prints usage and exits 0", async () => {
    const { code, stdout, stderr } = await run(["--help"]);
    expect(code).toBe(0);
    expect(stdout).toContain("typediagram");
    expect(stderr).toBe("");
  });

  it("renders with --font-size option", async () => {
    const { code, stdout } = await run(["--font-size", "16", fixturePath("small.td")]);
    expect(code).toBe(0);
    expect(stdout).toMatch(/^<svg[\s>]/);
    expect(stdout).toContain('font-size="16"');
  });

  it("rejects unknown flag with exit 1", async () => {
    const { code } = await run(["--bogus"]);
    expect(code).toBe(1);
  });
});

describe("[CLI-E2E-FROM] --from language conversion", () => {
  it("--from typescript converts TS interfaces to SVG", async () => {
    const { code, stdout, stderr } = await run(["--from", "typescript", fixturePath("types.ts")]);
    expect(stderr).toBe("");
    expect(code).toBe(0);
    expect(stdout).toMatch(/^<svg[\s>]/);
    expect(stdout).toContain("User");
    expect(stdout).toContain("Address");
  });

  it("--from with bad source returns exit 1", async () => {
    const { code } = await run(["--from", "typescript", fixturePath("bad.td")]);
    expect(code).toBe(1);
  });

  it("--from with missing file returns exit 1", async () => {
    const { code, stderr } = await run(["--from", "typescript", "/no/such/file.ts"]);
    expect(code).toBe(1);
    expect(stderr).toMatch(/cannot read/);
  });

  it("--from --emit td outputs typeDiagram source (not SVG)", async () => {
    const { code, stdout, stderr } = await run(["--from", "rust", "--emit", "td", fixturePath("types.rs")]);
    expect(stderr).toBe("");
    expect(code).toBe(0);
    expect(stdout).not.toMatch(/^<svg/);
    expect(stdout).toContain("type User");
    expect(stdout).toContain("union Shape");
  });

  it("--from --emit td+svg outputs td then separator then SVG", async () => {
    const { code, stdout, stderr } = await run(["--from", "rust", "--emit", "td+svg", fixturePath("types.rs")]);
    expect(stderr).toBe("");
    expect(code).toBe(0);
    const parts = stdout.split("\n---\n");
    expect(parts.length).toBe(2);
    expect(parts[0]).toContain("type User");
    expect(parts[1]).toMatch(/^<svg[\s>]/);
  });
});

describe("[CLI-E2E-TO] --to language export", () => {
  it("--to typescript converts typeDiagram to TS source", async () => {
    const { code, stdout } = await run(["--to", "typescript", fixturePath("small.td")]);
    expect(code).toBe(0);
    expect(stdout).toContain("export interface User");
    expect(stdout).toContain("name: string");
  });

  it("--to rust converts typeDiagram to Rust source", async () => {
    const { code, stdout } = await run(["--to", "rust", fixturePath("small.td")]);
    expect(code).toBe(0);
    expect(stdout).toContain("pub struct User");
    expect(stdout).toContain("pub enum");
  });

  it("--to python converts typeDiagram to Python source", async () => {
    const { code, stdout } = await run(["--to", "python", fixturePath("small.td")]);
    expect(code).toBe(0);
    expect(stdout).toContain("@dataclass");
    expect(stdout).toContain("class User:");
  });

  it("--to go converts typeDiagram to Go source", async () => {
    const { code, stdout } = await run(["--to", "go", fixturePath("small.td")]);
    expect(code).toBe(0);
    expect(stdout).toContain("type User struct");
  });

  it("--to with bad typeDiagram source returns exit 1", async () => {
    const { code } = await run(["--to", "typescript", fixturePath("bad.td")]);
    expect(code).toBe(1);
  });

  it("--to with missing file returns exit 1", async () => {
    const { code, stderr } = await run(["--to", "typescript", "/no/such/file.td"]);
    expect(code).toBe(1);
    expect(stderr).toMatch(/cannot read/);
  });

  it("--to with duplicate declarations fails model build", async () => {
    const { code, stderr } = await run(["--to", "typescript", fixturePath("duplicate.td")]);
    expect(code).toBe(1);
    expect(stderr).toContain("duplicate");
  });
});

describe("[CLI-TDBIN] generated Rust TDBIN glue", () => {
  it("encode emits generated Rust ADTs plus TDBIN codec impls", async () => {
    const { code, stdout, stderr } = await run(["encode", fixturePath("scalars.td")]);
    expect(stderr).toBe("");
    expect(code).toBe(0);
    expect(stdout).toContain("pub struct AuditEvent");
    expect(stdout).toContain("impl tdbin::Struct for AuditEvent");
    expect(stdout).toContain("w.word_list(at, Self::DATA_WORDS, 0, Some(&history_words))?;");
  });

  it("decode emits codec impls for already-generated Rust ADTs", async () => {
    const { code, stdout, stderr } = await run(["decode", fixturePath("scalars.td")]);
    expect(stderr).toBe("");
    expect(code).toBe(0);
    expect(stdout).not.toContain("pub struct AuditEvent");
    expect(stdout).toContain("impl tdbin::Struct for AuditEvent");
    expect(stdout).toContain("fn read_struct");
  });

  it("verify validates TDBIN schema support without emitting Rust source", async () => {
    const { code, stdout, stderr } = await run(["verify", fixturePath("scalars.td")]);
    expect(stderr).toBe("");
    expect(code).toBe(0);
    expect(stdout).toBe("tdbin schema ok\n");
  });

  it("verify reports unsupported TDBIN schemas as diagnostics", async () => {
    const { code, stdout, stderr } = await run(["verify", fixturePath("small.td")]);
    expect(code).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toContain("tdbin:");
  });

  it("verify reports missing files, parse errors, and model errors", async () => {
    for (const argv of [
      ["verify", "/no/such/tdbin-schema.td"],
      ["verify", fixturePath("bad.td")],
      ["verify", fixturePath("duplicate.td")],
    ]) {
      const { code, stdout, stderr } = await run(argv);
      expect(code).toBe(1);
      expect(stdout).toBe("");
      expect(stderr.length).toBeGreaterThan(0);
    }
  });

  it("verify reports Rust codegen validation errors before TDBIN generation", async () => {
    const { code, stdout, stderr } = await run(["verify", fixturePath("unknown-types.td")]);
    expect(code).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toMatch(/unknown type/i);
  });
});

// Ensure fixture file exists (sanity).
describe("[CLI-E2E-FIXTURE] fixtures present", () => {
  it("small.td contains expected content", async () => {
    const txt = await readFile(fixturePath("small.td"), "utf8");
    expect(txt).toContain("type User");
    expect(txt).toContain("union Option<T>");
  });
});

describe("[CLI-E2E-STDIN] stdin input", () => {
  it("reads source from stdin when no file given", async () => {
    const src = await readFile(fixturePath("small.td"), "utf8");
    const { code, stdout } = await runStdin([], src);
    expect(code).toBe(0);
    expect(stdout).toMatch(/^<svg[\s>]/);
  });
});

// [CLI-CODEGEN-UNKNOWN] GH issue #38: --to must hard-fail on unknown type
// identifiers instead of silently emitting them into target source, and
// [CONV-SCALARS] semantic scalars must reach codegen output end-to-end.
describe("[CLI-CODEGEN-UNKNOWN] --to rejects unknown type identifiers", () => {
  it("exits 1, emits nothing, and lists every unknown type on stderr", async () => {
    const { code, stdout, stderr } = await run([fixturePath("unknown-types.td"), "--to", "python"]);
    expect(code).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toMatch(/unknown type/i);
    expect(stderr).toContain("Timestamp");
    expect(stderr).toContain("Instant");
    expect(stderr).not.toContain("DateTime");
    expect(stderr).not.toContain("Uuid");
  });

  it.each([
    {
      lang: "python",
      snippets: [
        "import datetime",
        "import uuid",
        "import decimal",
        "id: uuid.UUID",
        "createdAt: datetime.datetime",
        "amount: decimal.Decimal",
      ],
    },
    {
      lang: "csharp",
      snippets: ["Guid id", "DateTimeOffset createdAt", "decimal amount"],
    },
  ])("emits native scalar types for $lang with exit 0", async ({ lang, snippets }) => {
    const { code, stdout, stderr } = await run([fixturePath("scalars.td"), "--to", lang]);
    expect(stderr).toBe("");
    expect(code).toBe(0);
    for (const snippet of snippets) {
      expect(stdout).toContain(snippet);
    }
  });

  // [SWR-VERSION-CLI-OUTPUT] [SWR-VERSION-JSON-OUTPUT] [SWR-VERSION-TEST-REQ]
  const cliPkgVersion = async (): Promise<string> => {
    const raw = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as {
      version: string;
    }; // safety: package.json shape is owned by this repo
    return raw.version;
  };

  it("--version prints 'typediagram <version>' from package metadata, exits 0, no stderr", async () => {
    const { code, stdout, stderr } = await run(["--version"]);
    expect(code).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toBe(`typediagram ${await cliPkgVersion()}\n`);
  });

  it("--version --json emits version-manifest JSON (manifestVersion/name/version/kind/language)", async () => {
    const { code, stdout, stderr } = await run(["--version", "--json"]);
    expect(code).toBe(0);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      manifestVersion: 1,
      name: "typediagram",
      version: await cliPkgVersion(),
      kind: "cli",
      language: "typescript",
    });
  });

  it("--json without --version is rejected with exit 1", async () => {
    const { code, stderr } = await run(["--json"]);
    expect(code).toBe(1);
    expect(stderr).toContain("--json requires --version");
  });

  it("version helpers fail loudly when package metadata is broken or unreadable", () => {
    const noField = versionText(() => ({}));
    expect(noField.ok).toBe(false);
    expect(!noField.ok && noField.error.message).toContain("no version field");
    const thrown = versionJson(() => {
      throw new Error("corrupted install");
    });
    expect(thrown.ok).toBe(false);
    expect(!thrown.ok && thrown.error.message).toContain("cannot read package.json");
    const jsonOk = versionJson(() => ({ version: "1.2.3" }));
    expect(jsonOk.ok && JSON.parse(jsonOk.value)).toEqual({
      manifestVersion: 1,
      name: "typediagram",
      version: "1.2.3",
      kind: "cli",
      language: "typescript",
    });
  });
});
