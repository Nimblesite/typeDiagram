// [CLI-ARGS-TEST] argv parsing.
import { describe, expect, it } from "vitest";
import { parseArgs } from "../src/args.js";

describe("[CLI-ARGS] parseArgs", () => {
  it("defaults to light theme, no file (stdin), no font-size", () => {
    const r = parseArgs([]);
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    expect(r.value).toEqual({
      file: null,
      tdbinCommand: null,
      theme: "light",
      fontSize: null,
      from: null,
      to: null,
      emit: "svg",
      help: false,
      version: false,
      json: false,
    });
  });

  it("accepts positional file", () => {
    const r = parseArgs(["foo.td"]);
    expect(r.ok && r.value.file).toBe("foo.td");
  });

  it("parses TDBIN command plus optional file", () => {
    const r = parseArgs(["encode", "schema.td"]);
    expect(r.ok && r.value.tdbinCommand).toBe("encode");
    expect(r.ok && r.value.file).toBe("schema.td");
  });

  it("parses TDBIN verify command without a file", () => {
    const r = parseArgs(["verify"]);
    expect(r.ok && r.value.tdbinCommand).toBe("verify");
    expect(r.ok && r.value.file).toBeNull();
  });

  it("rejects TDBIN commands combined with --to", () => {
    const r = parseArgs(["decode", "--to", "rust"]);
    expect(r.ok).toBe(false);
  });

  it("parses --theme dark", () => {
    const r = parseArgs(["--theme", "dark", "foo.td"]);
    expect(r.ok && r.value.theme).toBe("dark");
  });

  it("parses --font-size 14", () => {
    const r = parseArgs(["--font-size", "14", "foo.td"]);
    expect(r.ok && r.value.fontSize).toBe(14);
  });

  it("rejects unknown flag", () => {
    const r = parseArgs(["--bogus"]);
    expect(r.ok).toBe(false);
  });

  it("rejects invalid theme", () => {
    const r = parseArgs(["--theme", "neon"]);
    expect(r.ok).toBe(false);
  });

  it("rejects non-positive font-size", () => {
    const r = parseArgs(["--font-size", "0"]);
    expect(r.ok).toBe(false);
  });

  it("supports -h/--help", () => {
    expect(parseArgs(["-h"]).ok && parseArgs(["-h"])).toBeTruthy();
    const r = parseArgs(["--help"]);
    expect(r.ok && r.value.help).toBe(true);
  });

  it("rejects duplicate positional file", () => {
    const r = parseArgs(["one.td", "two.td"]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.message).toContain("unexpected positional");
    }
  });

  it("rejects --theme without a value", () => {
    const r = parseArgs(["--theme"]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.message).toContain("--theme expects");
    }
  });

  it("rejects --font-size without a value", () => {
    const r = parseArgs(["--font-size"]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.message).toContain("--font-size expects");
    }
  });

  it("parses --from typescript", () => {
    const r = parseArgs(["--from", "typescript"]);
    expect(r.ok && r.value.from).toBe("typescript");
  });

  it("parses --to rust", () => {
    const r = parseArgs(["--to", "rust"]);
    expect(r.ok && r.value.to).toBe("rust");
  });

  it("rejects --from and --to together", () => {
    const r = parseArgs(["--from", "typescript", "--to", "rust"]);
    expect(r.ok).toBe(false);
  });

  it("rejects invalid --from language", () => {
    const r = parseArgs(["--from", "java"]);
    expect(r.ok).toBe(false);
  });

  it("rejects --from without value", () => {
    const r = parseArgs(["--from"]);
    expect(r.ok).toBe(false);
  });

  it("rejects --to without value", () => {
    const r = parseArgs(["--to"]);
    expect(r.ok).toBe(false);
  });

  it("rejects invalid --to language", () => {
    const r = parseArgs(["--to", "swift"]);
    expect(r.ok).toBe(false);
  });

  it("rejects non-numeric font-size", () => {
    const r = parseArgs(["--font-size", "abc"]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.message).toContain("positive number");
    }
  });

  it("parses --emit td", () => {
    const r = parseArgs(["--emit", "td"]);
    expect(r.ok && r.value.emit).toBe("td");
  });

  it("parses --emit td+svg", () => {
    const r = parseArgs(["--emit", "td+svg"]);
    expect(r.ok && r.value.emit).toBe("td+svg");
  });

  it("defaults --emit to svg", () => {
    const r = parseArgs([]);
    expect(r.ok && r.value.emit).toBe("svg");
  });

  it("rejects invalid --emit value", () => {
    const r = parseArgs(["--emit", "json"]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.message).toContain("--emit expects");
    }
  });

  it("rejects --emit without value", () => {
    const r = parseArgs(["--emit"]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.message).toContain("--emit expects");
    }
  });
});
