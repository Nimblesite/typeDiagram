import { err, type Result } from "../result.js";
import type { TdbinError, TdbinErrorCode } from "./types.js";

const MESSAGES: Record<TdbinErrorCode, string> = {
  BadLength: "wire length is zero or not word-aligned",
  BadMagic: "frame magic is not TDB1",
  BadVersion: "frame version is not supported",
  ReservedBits: "frame reserved bits or fields were nonzero",
  LengthMismatch: "frame body length does not match available bytes",
  PackedTruncated: "packed body ended mid-element",
  PointerOutOfBounds: "pointer references an out-of-bounds word",
  ReservedPointerKind: "pointer used a reserved kind",
  PointerKindMismatch: "pointer kind does not match the field type",
  DepthExceeded: "struct nesting exceeded the depth cap",
  AmplificationExceeded: "traversal exceeded the amplification budget",
  InvalidUtf8: "string field held invalid UTF-8",
  LimitExceeded: "value exceeds a TDBIN wire-format limit",
  UnknownVariant: "union discriminant has no variant",
  UnexpectedNull: "required pointer field was null",
  NullRoot: "root pointer was null",
  OffsetOutOfRange: "pointer offset does not fit the signed 30-bit field",
};

export const tdbinError = (code: TdbinErrorCode, details: Omit<TdbinError, "code" | "message"> = {}) => ({
  code,
  message: MESSAGES[code],
  ...details,
});

export const tdbinErr = <T>(
  code: TdbinErrorCode,
  details: Omit<TdbinError, "code" | "message"> = {}
): Result<T, TdbinError> => err(tdbinError(code, details));
