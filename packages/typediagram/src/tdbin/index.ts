import { ok, type Result } from "../result.js";
import { tdbinErr } from "./error.js";
import { decodeFrame, encodeFrame, encodePackedFrame, looksFramed, unpackFrameBody } from "./frame.js";
import { message as readMessage } from "./reader.js";
import type { StructCodec, TdbinError } from "./types.js";
import { message as writeMessage } from "./writer.js";

export { err, ok, type Result } from "../result.js";
export type { FrameMessage, Reader, StructCodec, TdbinError, TdbinErrorCode, Writer } from "./types.js";
export * as frame from "./frame.js";
export * as pack from "./pack.js";
export * as pointer from "./pointer.js";
export * as reader from "./reader.js";
export * as scalar from "./word.js";
export * as writer from "./writer.js";
export const readerError = tdbinErr;

export const encode = <T>(codec: StructCodec<T>, value: T): Result<Uint8Array, TdbinError> =>
  writeMessage(codec, value);

export const decode = <T>(codec: StructCodec<T>, bytes: Uint8Array): Result<T, TdbinError> => readMessage(codec, bytes);

const pinnedHash = <T>(codec: StructCodec<T>): bigint | null => codec.layoutHash ?? null;

/** Frame-level hash guard ([TDBIN-SCHEMA-HASH]): an explicit `expected` hash is
 *  required outright; otherwise an advertised hash must not contradict the
 *  codec's pinned hash. Mirrors the Rust runtime's `decode_framed`. */
const checkHash = <T>(
  codec: StructCodec<T>,
  got: bigint | null,
  expected: bigint | null
): Result<undefined, TdbinError> => {
  const pinned = pinnedHash(codec);
  const want = expected ?? (got === null ? null : pinned);
  return want === null || got === want ? ok(undefined) : tdbinErr("HashMismatch", { expectedHash: want, gotHash: got });
};

const decodeFrameWith = <T>(
  codec: StructCodec<T>,
  bytes: Uint8Array,
  expected: bigint | null
): Result<T, TdbinError> => {
  const framed = decodeFrame(bytes);
  if (!framed.ok) {
    return framed;
  }
  const hashed = checkHash(codec, framed.value.schemaHash, expected);
  const body = hashed.ok ? unpackFrameBody(framed.value) : hashed;
  return body.ok ? decode(codec, body.value) : body;
};

/** Encode a framed message advertising `schemaHash` (default: the codec's pinned hash). */
export const encodeFramed = <T>(
  codec: StructCodec<T>,
  value: T,
  schemaHash: bigint | null = pinnedHash(codec)
): Result<Uint8Array, TdbinError> => {
  const body = encode(codec, value);
  return body.ok ? encodeFrame(body.value, { schemaHash }) : body;
};

/** Encode a packed framed message advertising `schemaHash` (default: the codec's pinned hash). */
export const encodePackedFramed = <T>(
  codec: StructCodec<T>,
  value: T,
  schemaHash: bigint | null = pinnedHash(codec)
): Result<Uint8Array, TdbinError> => {
  const body = encode(codec, value);
  return body.ok ? encodePackedFrame(body.value, schemaHash) : body;
};

/** Decode a REQUIRED frame whose hash must equal `expectedHash` (default: the
 *  codec's pinned hash). A missing or different hash is `HashMismatch` — the
 *  typed wire-mismatch signal ([TDBIN-SCHEMA-HASH]). */
export const decodeFramed = <T>(
  codec: StructCodec<T>,
  bytes: Uint8Array,
  expectedHash: bigint | null = pinnedHash(codec)
): Result<T, TdbinError> => decodeFrameWith(codec, bytes, expectedHash);

/** Decode framed or raw bytes; a framed hash must agree with `expectedHash` or the pinned hash. */
export const decodeAuto = <T>(
  codec: StructCodec<T>,
  bytes: Uint8Array,
  expectedHash: bigint | null = null
): Result<T, TdbinError> => (looksFramed(bytes) ? decodeFrameWith(codec, bytes, expectedHash) : decode(codec, bytes));

/** Packed framed message as base64 text, for payloads that ride inside JSON
 *  (e.g. a JSON-RPC/LSP envelope) ([TDBIN-FRAME-BASE64]). */
export const encodeFramedBase64 = <T>(codec: StructCodec<T>, value: T): Result<string, TdbinError> => {
  const framed = encodePackedFramed(codec, value);
  return framed.ok ? ok(toBase64(framed.value)) : framed;
};

/** Inverse of {@link encodeFramedBase64}: `BadBase64`, `BadMagic`, `HashMismatch`… as typed errors. */
export const decodeFramedBase64 = <T>(codec: StructCodec<T>, text: string): Result<T, TdbinError> => {
  const bytes = fromBase64(text);
  return bytes.ok ? decodeFramed(codec, bytes.value) : bytes;
};

const BASE64_CHUNK = 0x8000;

export const toBase64 = (bytes: Uint8Array): string => {
  const parts: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK) {
    parts.push(String.fromCharCode(...bytes.subarray(offset, offset + BASE64_CHUNK)));
  }
  return btoa(parts.join(""));
};

export const fromBase64 = (text: string): Result<Uint8Array, TdbinError> => {
  try {
    const binary = atob(text);
    return ok(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
  } catch {
    return tdbinErr("BadBase64");
  }
};

export const fromHex = (hex: string): Result<Uint8Array, TdbinError> => {
  if (hex.length % 2 !== 0) {
    return tdbinErr("BadLength");
  }
  const bytes: number[] = [];
  for (let offset = 0; offset < hex.length; offset += 2) {
    const byte = Number.parseInt(hex.slice(offset, offset + 2), 16);
    if (!Number.isInteger(byte)) {
      return tdbinErr("BadLength");
    }
    bytes.push(byte);
  }
  return ok(Uint8Array.from(bytes));
};

export const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
