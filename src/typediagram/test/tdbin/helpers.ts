import { expect } from "vitest";
import type { Result } from "../../src/result.js";
import type { TdbinError } from "../../src/tdbin/index.js";

/** Unwrap a successful TDBIN result while retaining its error message on failure. */
export const expectOk = <T>(result: Result<T, TdbinError>): T => {
  expect(result.ok, result.ok ? "" : result.error.message).toBe(true);
  return result.ok ? result.value : (undefined as never);
};
