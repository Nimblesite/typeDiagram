// [CONV-TYPES] Shared interface for all language converters.
import type { Diagnostic } from "../parser/diagnostics.js";
import type { Result } from "../result.js";
import type { Model } from "../model/types.js";

export type Language =
  "typescript" | "python" | "typeshed" | "rust" | "go" | "csharp" | "fsharp" | "dart" | "protobuf" | "php";

export interface PythonOpts {
  readonly style?: "dataclass" | "pydantic";
}

export interface CSharpOpts {
  /** Use 64-bit integers for native identity/counter models. */
  readonly integerWidth?: 32 | 64;
  readonly namespace?: string;
}

/** Emit bigint integer types; this does not generate runtime range checks or codecs. */
export interface TypeScriptOpts {
  readonly integerType?: "number" | "bigint";
}

export interface ConverterOpts {
  readonly typescript?: TypeScriptOpts;
  readonly python?: PythonOpts;
  readonly csharp?: CSharpOpts;
}

export interface Converter {
  readonly language: Language;
  /** Parse language source into a typeDiagram Model. */
  fromSource(source: string): Result<Model, Diagnostic[]>;
  /** Emit language source from a typeDiagram Model. */
  toSource(model: Model, opts?: PythonOpts | CSharpOpts | TypeScriptOpts): string;
}
