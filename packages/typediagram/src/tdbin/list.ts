// [TDBIN-TS-LIST] Element conversions the generated TypeScript list codecs
// share, so generated modules stay small: `List<Int>` words with range checks,
// and `List<enum-union>` as one ordinal byte per element ([TDBIN-LIST-ELEM]).
import { ok, type Result } from "../result.js";
import { tdbinErr } from "./error.js";
import type { TdbinError } from "./types.js";
import { i64Bits } from "./word.js";

/** `List<Int>` → i64 words; any value outside the i64 domain is `LimitExceeded`. */
export const i64Words = (values: readonly (number | bigint)[]): Result<bigint[], TdbinError> => {
  const words: bigint[] = [];
  for (const value of values) {
    const bits = i64Bits(value);
    if (!bits.ok) {
      return bits;
    }
    words.push(bits.value);
  }
  return ok(words);
};

/** `List<enum-union>` → declaration ordinals, one byte each. */
export const enumOrdinals = (values: readonly { readonly kind: string }[], names: readonly string[]): Uint8Array =>
  Uint8Array.from(values, (value) => names.indexOf(value.kind));

/** Ordinal bytes → enum values; an ordinal with no variant is `UnknownVariant`. */
export const enumValues = <K extends string>(
  bytes: Uint8Array,
  names: readonly K[]
): Result<{ kind: K }[], TdbinError> => {
  const values: { kind: K }[] = [];
  for (const ordinal of bytes) {
    const kind = names[ordinal];
    if (kind === undefined) {
      return tdbinErr("UnknownVariant", { ordinal: BigInt(ordinal) });
    }
    values.push({ kind });
  }
  return ok(values);
};
