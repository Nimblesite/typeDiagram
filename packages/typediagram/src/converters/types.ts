// [CONV-TYPES] Shared interface for all language converters.
import type { Diagnostic } from "../parser/diagnostics.js";
import type { Result } from "../result.js";
import type { Model } from "../model/types.js";

export type Language = "typescript" | "python" | "rust" | "go" | "csharp" | "fsharp" | "dart" | "protobuf";

export interface PythonOpts {
  readonly style?: "dataclass" | "pydantic";
}

export interface CSharpOpts {
  readonly namespace?: string;
}

export interface ConverterOpts {
  readonly python?: PythonOpts;
  readonly csharp?: CSharpOpts;
}

export interface Converter {
  readonly language: Language;
  /** Parse language source into a typeDiagram Model. */
  fromSource(source: string): Result<Model, Diagnostic[]>;
  /** Emit language source from a typeDiagram Model. */
  toSource(model: Model, opts?: PythonOpts | CSharpOpts): string;
}
