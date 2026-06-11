// [CLI-E2E] Full CLI: argv -> parse -> renderToString -> stdout / diagnostics -> stderr, exit code.
import { readFile } from "node:fs/promises";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { main } from "../src/cli.js";
import { versionJson, versionText } from "../src/version.js";

const fixtureUrl = (name: string) => new URL(`./fixtures/${name}`, import.meta.url);
const fixturePath = (name: string) => fileURLToPath(fixtureUrl(name));

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
    const out = makeStream();
    const err = makeStream();
    const code = await main([fixturePath(file)], out.stream, err.stream);
    expect(err.text()).toBe("");
    expect(code).toBe(0);
    expect(out.text()).toMatch(/^<svg[\s>]/);
    const txt = out.text();
    for (const name of names) {
      expect(txt).toContain(name);
    }
  });

  it("reports parse errors to stderr with exit 1", async () => {
    const out = makeStream();
    const err = makeStream();
    const code = await main([fixturePath("bad.td")], out.stream, err.stream);
    expect(code).toBe(1);
    expect(err.text().length).toBeGreaterThan(0);
  });

  it("fails cleanly when file is missing", async () => {
    const out = makeStream();
    const err = makeStream();
    const code = await main(["/no/such/path.td"], out.stream, err.stream);
    expect(code).toBe(1);
    expect(err.text()).toMatch(/cannot read/);
  });

  it("--help prints usage and exits 0", async () => {
    const out = makeStream();
    const err = makeStream();
    const code = await main(["--help"], out.stream, err.stream);
    expect(code).toBe(0);
    expect(out.text()).toContain("typediagram");
    expect(err.text()).toBe("");
  });

  it("renders with --font-size option", async () => {
    const out = makeStream();
    const err = makeStream();
    const code = await main(["--font-size", "16", fixturePath("small.td")], out.stream, err.stream);
    expect(code).toBe(0);
    expect(out.text()).toMatch(/^<svg[\s>]/);
    expect(out.text()).toContain('font-size="16"');
  });

  it("rejects unknown flag with exit 1", async () => {
    const out = makeStream();
    const err = makeStream();
    const code = await main(["--bogus"], out.stream, err.stream);
    expect(code).toBe(1);
  });
});

describe("[CLI-E2E-FROM] --from language conversion", () => {
  it("--from typescript converts TS interfaces to SVG", async () => {
    const out = makeStream();
    const errS = makeStream();
    const code = await main(["--from", "typescript", fixturePath("types.ts")], out.stream, errS.stream);
    expect(errS.text()).toBe("");
    expect(code).toBe(0);
    expect(out.text()).toMatch(/^<svg[\s>]/);
    expect(out.text()).toContain("User");
    expect(out.text()).toContain("Address");
  });

  it("--from with bad source returns exit 1", async () => {
    const out = makeStream();
    const err = makeStream();
    const code = await main(["--from", "typescript", fixturePath("bad.td")], out.stream, err.stream);
    expect(code).toBe(1);
  });

  it("--from with missing file returns exit 1", async () => {
    const out = makeStream();
    const err = makeStream();
    const code = await main(["--from", "typescript", "/no/such/file.ts"], out.stream, err.stream);
    expect(code).toBe(1);
    expect(err.text()).toMatch(/cannot read/);
  });

  it("--from --emit td outputs typeDiagram source (not SVG)", async () => {
    const out = makeStream();
    const errS = makeStream();
    const code = await main(["--from", "rust", "--emit", "td", fixturePath("types.rs")], out.stream, errS.stream);
    expect(errS.text()).toBe("");
    expect(code).toBe(0);
    expect(out.text()).not.toMatch(/^<svg/);
    expect(out.text()).toContain("type User");
    expect(out.text()).toContain("union Shape");
  });

  it("--from --emit td+svg outputs td then separator then SVG", async () => {
    const out = makeStream();
    const errS = makeStream();
    const code = await main(["--from", "rust", "--emit", "td+svg", fixturePath("types.rs")], out.stream, errS.stream);
    expect(errS.text()).toBe("");
    expect(code).toBe(0);
    const text = out.text();
    const parts = text.split("\n---\n");
    expect(parts.length).toBe(2);
    expect(parts[0]).toContain("type User");
    expect(parts[1]).toMatch(/^<svg[\s>]/);
  });
});

describe("[CLI-E2E-TO] --to language export", () => {
  it("--to typescript converts typeDiagram to TS source", async () => {
    const out = makeStream();
    const err = makeStream();
    const code = await main(["--to", "typescript", fixturePath("small.td")], out.stream, err.stream);
    expect(code).toBe(0);
    expect(out.text()).toContain("export interface User");
    expect(out.text()).toContain("name: string");
  });

  it("--to rust converts typeDiagram to Rust source", async () => {
    const out = makeStream();
    const err = makeStream();
    const code = await main(["--to", "rust", fixturePath("small.td")], out.stream, err.stream);
    expect(code).toBe(0);
    expect(out.text()).toContain("pub struct User");
    expect(out.text()).toContain("pub enum");
  });

  it("--to python converts typeDiagram to Python source", async () => {
    const out = makeStream();
    const err = makeStream();
    const code = await main(["--to", "python", fixturePath("small.td")], out.stream, err.stream);
    expect(code).toBe(0);
    expect(out.text()).toContain("@dataclass");
    expect(out.text()).toContain("class User:");
  });

  it("--to go converts typeDiagram to Go source", async () => {
    const out = makeStream();
    const err = makeStream();
    const code = await main(["--to", "go", fixturePath("small.td")], out.stream, err.stream);
    expect(code).toBe(0);
    expect(out.text()).toContain("type User struct");
  });

  it("--to with bad typeDiagram source returns exit 1", async () => {
    const out = makeStream();
    const err = makeStream();
    const code = await main(["--to", "typescript", fixturePath("bad.td")], out.stream, err.stream);
    expect(code).toBe(1);
  });

  it("--to with missing file returns exit 1", async () => {
    const out = makeStream();
    const err = makeStream();
    const code = await main(["--to", "typescript", "/no/such/file.td"], out.stream, err.stream);
    expect(code).toBe(1);
    expect(err.text()).toMatch(/cannot read/);
  });

  it("--to with duplicate declarations fails model build", async () => {
    const out = makeStream();
    const err = makeStream();
    const code = await main(["--to", "typescript", fixturePath("duplicate.td")], out.stream, err.stream);
    expect(code).toBe(1);
    expect(err.text()).toContain("duplicate");
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
    const { Readable } = await import("node:stream");
    const src = await readFile(fixturePath("small.td"), "utf8");
    const fakeStdin = new Readable({
      read() {
        this.push(src);
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
      const out = makeStream();
      const err = makeStream();
      const code = await main([], out.stream, err.stream);
      expect(code).toBe(0);
      expect(out.text()).toMatch(/^<svg[\s>]/);
    } finally {
      Object.defineProperty(process, "stdin", {
        value: original,
        writable: true,
        configurable: true,
      });
    }
  });
});

// [CLI-CODEGEN-UNKNOWN] GH issue #38: --to must hard-fail on unknown type
// identifiers instead of silently emitting them into target source, and
// [CONV-SCALARS] semantic scalars must reach codegen output end-to-end.
describe("[CLI-CODEGEN-UNKNOWN] --to rejects unknown type identifiers", () => {
  it("exits 1, emits nothing, and lists every unknown type on stderr", async () => {
    const out = makeStream();
    const err = makeStream();
    const code = await main([fixturePath("unknown-types.td"), "--to", "python"], out.stream, err.stream);
    expect(code).toBe(1);
    expect(out.text()).toBe("");
    expect(err.text()).toMatch(/unknown type/i);
    expect(err.text()).toContain("Timestamp");
    expect(err.text()).toContain("Instant");
    expect(err.text()).not.toContain("DateTime");
    expect(err.text()).not.toContain("Uuid");
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
    const out = makeStream();
    const err = makeStream();
    const code = await main([fixturePath("scalars.td"), "--to", lang], out.stream, err.stream);
    expect(err.text()).toBe("");
    expect(code).toBe(0);
    for (const snippet of snippets) {
      expect(out.text()).toContain(snippet);
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
    const out = makeStream();
    const err = makeStream();
    const code = await main(["--version"], out.stream, err.stream);
    expect(code).toBe(0);
    expect(err.text()).toBe("");
    expect(out.text()).toBe(`typediagram ${await cliPkgVersion()}\n`);
  });

  it("--version --json emits version-manifest JSON (manifestVersion/name/version/kind/language)", async () => {
    const out = makeStream();
    const err = makeStream();
    const code = await main(["--version", "--json"], out.stream, err.stream);
    expect(code).toBe(0);
    expect(err.text()).toBe("");
    expect(JSON.parse(out.text())).toEqual({
      manifestVersion: 1,
      name: "typediagram",
      version: await cliPkgVersion(),
      kind: "cli",
      language: "typescript",
    });
  });

  it("--json without --version is rejected with exit 1", async () => {
    const out = makeStream();
    const err = makeStream();
    const code = await main(["--json"], out.stream, err.stream);
    expect(code).toBe(1);
    expect(err.text()).toContain("--json requires --version");
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
