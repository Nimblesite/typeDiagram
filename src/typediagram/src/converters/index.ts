// [CONV] Barrel export for all language converters.
import { typescript } from "./typescript.js";
import { python } from "./python.js";
import { typeshed } from "./typeshed.js";
import { rust } from "./rust.js";
import { go } from "./go.js";
import { csharp } from "./csharp.js";
import { fsharp } from "./fsharp.js";
import { dart } from "./dart.js";
import { protobuf } from "./protobuf.js";
import { php } from "./php.js";
import type { Converter, Language } from "./types.js";

export { typescript, python, typeshed, rust, go, csharp, fsharp, dart, protobuf, php };
export type { TypeshedAnalysis, TypeshedConverter } from "./typeshed.js";
export type { TypeshedStats } from "./typeshed-decls.js";
export { parseTypeRef, printTypeRef } from "./parse-typeref.js";
export type { Converter, Language } from "./types.js";

// [CONV-REGISTRY] Canonical language→converter map. Typing it Record<Language, Converter>
// makes a missing entry a COMPILE error, so the advertised language set can never drift
// from what actually emits. Single source of truth for CLI/web/vscode language lists.
export const byLanguage: Record<Language, Converter> = {
  typescript,
  python,
  typeshed,
  rust,
  go,
  csharp,
  fsharp,
  dart,
  protobuf,
  php,
};

// Keys of a Record<Language, …> are exactly the Language members, so this cast is sound.
export const LANGUAGES = Object.keys(byLanguage) as readonly Language[];
