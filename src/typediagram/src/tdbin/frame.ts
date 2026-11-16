import { ok, type Result } from "../result.js";
import { tdbinErr } from "./error.js";
import { decodePacked, encodePacked } from "./pack.js";
import type { FrameMessage, TdbinError } from "./types.js";

const MAGIC = [0x54, 0x44, 0x42, 0x31] as const;
const VERSION = 1;
const BASE_HEADER_LEN = 12;
const HASH_HEADER_LEN = 20;
const FLAG_PACKED = 0b0000_0001;
const FLAG_HASH = 0b0000_0010;
const KNOWN_FLAGS = FLAG_PACKED | FLAG_HASH;

export interface FrameOptions {
  readonly packed?: boolean;
  readonly schemaHash?: bigint | null;
}

export const encodeFrame = (body: Uint8Array, options: FrameOptions = {}): Result<Uint8Array, TdbinError> => {
  const flags = optionFlags(options);
  const headerLen = hasFlag(flags, FLAG_HASH) ? HASH_HEADER_LEN : BASE_HEADER_LEN;
  const out = new Uint8Array(headerLen + body.length);
  const view = new DataView(out.buffer);
  out.set(MAGIC, 0);
  out[4] = VERSION;
  out[5] = flags;
  view.setUint16(6, 0, true);
  view.setUint32(8, body.length, true);
  if (options.schemaHash !== undefined && options.schemaHash !== null) {
    view.setBigUint64(BASE_HEADER_LEN, BigInt.asUintN(64, options.schemaHash), true);
  }
  out.set(body, headerLen);
  return ok(out);
};

export const encodePackedFrame = (
  body: Uint8Array,
  schemaHash: bigint | null = null
): Result<Uint8Array, TdbinError> => {
  const packed = encodePacked(body);
  return packed.ok ? encodeFrame(packed.value, { packed: true, schemaHash }) : packed;
};

export const decodeFrame = (bytes: Uint8Array): Result<FrameMessage, TdbinError> => {
  if (bytes.length < BASE_HEADER_LEN) {
    return tdbinErr("LengthMismatch");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const flags = Number(bytes[5]);
  const bodyLen = view.getUint32(8, true);
  const headerLen = hasFlag(flags, FLAG_HASH) ? HASH_HEADER_LEN : BASE_HEADER_LEN;
  return decodeFrameBody(bytes, view, flags, bodyLen, headerLen);
};

export const unpackFrameBody = (message: FrameMessage): Result<Uint8Array, TdbinError> =>
  message.packed ? decodePacked(message.body) : ok(message.body);

export const looksFramed = (bytes: Uint8Array): boolean =>
  bytes.length >= MAGIC.length && MAGIC.every((byte, offset) => bytes[offset] === byte);

const optionFlags = (options: FrameOptions): number =>
  (options.packed === true ? FLAG_PACKED : 0) |
  (options.schemaHash === undefined || options.schemaHash === null ? 0 : FLAG_HASH);

const decodeFrameBody = (
  bytes: Uint8Array,
  view: DataView,
  flags: number,
  bodyLen: number,
  headerLen: number
): Result<FrameMessage, TdbinError> => {
  if (!MAGIC.every((byte, offset) => bytes[offset] === byte)) {
    return tdbinErr("BadMagic");
  }
  if (bytes[4] !== VERSION) {
    return tdbinErr("BadVersion", { version: Number(bytes[4]) });
  }
  if ((flags & ~KNOWN_FLAGS) !== 0 || view.getUint16(6, true) !== 0) {
    return tdbinErr("ReservedBits");
  }
  return readBody(bytes, view, flags, bodyLen, headerLen);
};

const readBody = (bytes: Uint8Array, view: DataView, flags: number, bodyLen: number, headerLen: number) => {
  const end = headerLen + bodyLen;
  if (end !== bytes.length) {
    return tdbinErr<FrameMessage>("LengthMismatch");
  }
  return ok({
    body: bytes.slice(headerLen, end),
    packed: hasFlag(flags, FLAG_PACKED),
    schemaHash: hasFlag(flags, FLAG_HASH) ? view.getBigUint64(BASE_HEADER_LEN, true) : null,
  });
};

const hasFlag = (flags: number, flag: number): boolean => (flags & flag) === flag;
