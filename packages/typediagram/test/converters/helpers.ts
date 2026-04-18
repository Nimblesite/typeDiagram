// [CONV-TEST-HELPERS] Shared test utilities for converter tests.
import { expect } from "vitest";
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
