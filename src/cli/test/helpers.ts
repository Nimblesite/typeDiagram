// [CLI-TEST-HELPERS] Shared black-box harness for the CLI e2e suites. Every
// suite drives the real `main(argv, out, err)` entry point through these helpers
// instead of re-inlining the Writable capture stream, the fixture path resolver,
// and the stdin-swap dance. Keeps the tests black-box (bin API only) with one
// canonical implementation of the harness.
import { Readable, Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { main } from "../src/cli.js";

/** Resolve a fixtures/ file to an absolute path. */
export const fixturePath = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

/** A Writable that accumulates written chunks as a single UTF-8 string. */
export const makeStream = () => {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk));
      cb();
    },
  });
  return { stream, text: () => chunks.join("") };
};

/** Run the CLI with `argv`, capturing exit code, stdout and stderr. */
export const run = async (argv: ReadonlyArray<string>): Promise<{ code: number; stdout: string; stderr: string }> => {
  const out = makeStream();
  const err = makeStream();
  const code = await main([...argv], out.stream, err.stream);
  return { code, stdout: out.text(), stderr: err.text() };
};

/** Run the CLI with `argv`, feeding `source` via a fake stdin (no file arg). */
export const runStdin = async (argv: ReadonlyArray<string>, source: string) => {
  const fakeStdin = new Readable({
    read() {
      this.push(source);
      this.push(null);
    },
  });
  const original = process.stdin;
  Object.defineProperty(process, "stdin", { value: fakeStdin, writable: true, configurable: true });
  try {
    return await run(argv);
  } finally {
    Object.defineProperty(process, "stdin", { value: original, writable: true, configurable: true });
  }
};
