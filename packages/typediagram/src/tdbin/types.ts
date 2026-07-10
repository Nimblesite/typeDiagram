import type { Result } from "../result.js";

export type TdbinErrorCode =
  | "BadLength"
  | "BadMagic"
  | "BadVersion"
  | "ReservedBits"
  | "LengthMismatch"
  | "HashMismatch"
  | "PackedTruncated"
  | "PointerOutOfBounds"
  | "ReservedPointerKind"
  | "PointerKindMismatch"
  | "MalformedCompositeTag"
  | "DepthExceeded"
  | "AmplificationExceeded"
  | "InvalidUtf8"
  | "LimitExceeded"
  | "UnknownVariant"
  | "UnexpectedNull"
  | "NullRoot"
  | "OffsetOutOfRange";

export interface TdbinError {
  readonly code: TdbinErrorCode;
  readonly message: string;
  readonly wordIndex?: number;
  readonly version?: number;
  readonly ordinal?: bigint;
  readonly expectedHash?: bigint;
  readonly gotHash?: bigint | null;
}

export interface StructCodec<T> {
  readonly dataWords: number;
  readonly ptrWords: number;
  readonly write: (writer: Writer, at: number, value: T) => Result<void, TdbinError>;
  readonly read: (reader: Reader, at: number) => Result<T, TdbinError>;
}

export interface Writer {
  readonly body: bigint[];
  readonly depth?: number;
}

export interface Budget {
  value: number;
}

export interface Reader {
  readonly bytes: Uint8Array;
  readonly view: DataView;
  readonly dataWords: number;
  readonly ptrWords: number;
  readonly depth: number;
  readonly budget: Budget;
}

export type Pointer =
  | { readonly kind: "null" }
  | {
      readonly kind: "struct";
      readonly offset: number;
      readonly dataWords: number;
      readonly ptrWords: number;
    }
  | {
      readonly kind: "list";
      readonly offset: number;
      readonly elem: number;
      readonly count: number;
    };

export interface FrameMessage {
  readonly body: Uint8Array;
  readonly packed: boolean;
  readonly schemaHash: bigint | null;
}
