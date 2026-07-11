// [CONV-TEST-HELPERS] Shared test utilities for converter tests.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";
import { generateRustModule, type RustCodecOptions } from "../../src/converters/rust-tdbin.js";
import type { Converter } from "../../src/converters/types.js";
import { buildModel, printSource } from "../../src/model/index.js";
import { parse } from "../../src/parser/index.js";
import { HOME_PAGE_SAMPLE } from "../../src/sample.js";

export function unwrap<T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!r.ok) {
    throw new Error(`expected ok: ${JSON.stringify(r.error)}`);
  }
  return r.value;
}

// rustfmt only rewraps, adds trailing commas, and drops the comma after a
// block-bodied match arm; compare generated Rust as a token stream with
// whitespace, trailing commas, and after-block commas normalized away.
const normalizeRust = (s: string) =>
  s
    .replace(/\s+/g, "")
    .replace(/,(?=[)}\]])/g, "")
    .replace(/(?<=}),/g, "");

/**
 * Drift guard for a committed GENERATED Rust crate module: the text after its
 * `// <<<GENERATED` marker must equal fresh `generateRustModule` output for
 * `td` (whitespace-normalized so rustfmt rewraps are tolerated). `relPath`
 * resolves relative to this directory.
 */
export function expectRustModuleReproduces(td: string, relPath: string, options?: RustCodecOptions) {
  const generated = unwrap(generateRustModule(unwrap(buildModel(unwrap(parse(td)))), options));
  const committed = readFileSync(fileURLToPath(new URL(relPath, import.meta.url)), "utf8");
  const marker = committed.indexOf("// <<<GENERATED");
  expect(marker).toBeGreaterThan(-1);
  const body = committed.slice(committed.indexOf("\n", marker) + 1);
  expect(normalizeRust(body)).toBe(normalizeRust(generated));
}

/**
 * Asserts TD -> language -> TD is a byte-for-byte lossless round-trip for the
 * HOME_PAGE_SAMPLE. Any converter claiming lossless round-trip must preserve
 * this exact string.
 *
 * Language-specific behavior is injected via the `converter` argument; the
 * helper itself is language-agnostic.
 */
export function expectLosslessRoundTrip(converter: Converter, source: string = HOME_PAGE_SAMPLE): void {
  const originalModel = unwrap(buildModel(unwrap(parse(source))));
  const langCode = converter.toSource(originalModel);
  const roundTripModel = unwrap(converter.fromSource(langCode));
  const roundTripTd = printSource(roundTripModel);

  expect(roundTripTd).toBe(source);
}
