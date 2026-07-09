import { ok, type Result } from "../result.js";
import { tdbinErr } from "./error.js";
import { decodeFrame, encodeFrame, encodePackedFrame, looksFramed, unpackFrameBody } from "./frame.js";
import { message as readMessage } from "./reader.js";
import type { StructCodec, TdbinError } from "./types.js";
import { message as writeMessage } from "./writer.js";

export type { FrameMessage, Reader, StructCodec, TdbinError, TdbinErrorCode, Writer } from "./types.js";
export * as frame from "./frame.js";
export * as pack from "./pack.js";
export * as pointer from "./pointer.js";
export * as reader from "./reader.js";
export * as scalar from "./word.js";
export * as writer from "./writer.js";
export const readerError = tdbinErr;

export const encode = <T>(codec: StructCodec<T>, value: T): Result<Uint8Array, TdbinError> => writeMessage(codec, value);

export const decode = <T>(codec: StructCodec<T>, bytes: Uint8Array): Result<T, TdbinError> => readMessage(codec, bytes);

export const encodeFramed = <T>(
  codec: StructCodec<T>,
  value: T,
  schemaHash: bigint | null = null
): Result<Uint8Array, TdbinError> => {
  const body = encode(codec, value);
  return body.ok ? encodeFrame(body.value, { schemaHash }) : body;
};

export const encodePackedFramed = <T>(
  codec: StructCodec<T>,
  value: T,
  schemaHash: bigint | null = null
): Result<Uint8Array, TdbinError> => {
  const body = encode(codec, value);
  return body.ok ? encodePackedFrame(body.value, schemaHash) : body;
};

export const decodeAuto = <T>(codec: StructCodec<T>, bytes: Uint8Array): Result<T, TdbinError> => {
  if (!looksFramed(bytes)) {
    return decode(codec, bytes);
  }
  const framed = decodeFrame(bytes);
  const body = framed.ok ? unpackFrameBody(framed.value) : framed;
  return body.ok ? decode(codec, body.value) : body;
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
