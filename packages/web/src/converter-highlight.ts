// [WEB-CONV-HIGHLIGHT] Regex-based syntax highlighting for converter input languages.
// Returns HTML with <span class="hl-*"> tokens, reusing the same CSS classes
// as the typeDiagram highlighter so no extra CSS is needed.
//
// Every language table is composed from shared rule descriptors (comments, the
// capitalised-type rule, colon-field rule) plus a `kw`/`builtin` builder over a
// per-language word list — so the identical rule shapes live in exactly one place
// and each language contributes only its distinct keyword/builtin/punct data.

import { type Rule, runHighlight, initHighlightOverlay } from "./highlight-engine.js";

// Shared rule shapes reused verbatim across languages (earlier rules win on overlap).
const SLASH_LINE_COMMENT: Rule = { re: /\/\/.*$/gm, cls: "hl-comment" };
const BLOCK_COMMENT: Rule = { re: /\/\*[\s\S]*?\*\//gm, cls: "hl-comment" };
const HASH_COMMENT: Rule = { re: /#.*$/gm, cls: "hl-comment" };
const C_COMMENTS: readonly Rule[] = [SLASH_LINE_COMMENT, BLOCK_COMMENT];
const TYPE_RULE: Rule = { re: /\b([A-Z][A-Za-z0-9_]*)\b/g, cls: "hl-type" };
const COLON_FIELD: Rule = { re: /\b([a-z_][A-Za-z0-9_]*)\s*(?=:)/g, cls: "hl-field", group: 1 };

// Build a `\b(word|word|…)\b` rule for `cls` from a space-delimited word list.
const wordRule = (words: string, cls: string): Rule => ({
  re: new RegExp(`\\b(${words.trim().split(/\s+/).join("|")})\\b`, "g"),
  cls,
});
const kw = (words: string): Rule => wordRule(words, "hl-keyword");
const builtin = (words: string): Rule => wordRule(words, "hl-builtin");

// A per-language table: comment/keyword/builtin/field prelude, then the shared
// capitalised-type rule, then the language's punctuation set (distinct per language).
const table = (head: readonly Rule[], punct: RegExp): readonly Rule[] => [
  ...head,
  TYPE_RULE,
  { re: punct, cls: "hl-punct" },
];

const TYPESCRIPT_RULES = table(
  [
    ...C_COMMENTS,
    kw("interface type enum export import const let extends implements class readonly"),
    builtin("string number boolean void null undefined never any unknown bigint"),
    { re: /\b([a-z_][A-Za-z0-9_]*)\s*(?=[?:])/g, cls: "hl-field", group: 1 },
  ],
  /[<>{}:;,=|&?]/g
);

const RUST_RULES = table(
  [
    ...C_COMMENTS,
    kw("struct enum type pub fn impl trait use mod crate self super let mut const where"),
    builtin(
      "bool i8 i16 i32 i64 i128 u8 u16 u32 u64 u128 f32 f64 usize isize str String Vec HashMap Option Result Box"
    ),
    COLON_FIELD,
  ],
  /[<>{}:;,=|&]/g
);

const PYTHON_RULES = table(
  [
    HASH_COMMENT,
    { re: /"""[\s\S]*?"""/gm, cls: "hl-comment" },
    kw("class def from import return pass if else elif with as raise yield lambda async await"),
    { re: /@\w+/g, cls: "hl-keyword" },
    builtin("bool int float str list dict tuple set None True False Optional List Dict Tuple Set Union"),
    COLON_FIELD,
  ],
  /[<>{}:;,=|()[\]]/g
);

const GO_RULES = table(
  [
    ...C_COMMENTS,
    kw("package import type struct interface func var const map chan go defer return range for if else switch case"),
    builtin(
      "bool int int8 int16 int32 int64 uint uint8 uint16 uint32 uint64 float32 float64 string byte rune error any"
    ),
    { re: /\b([A-Z][A-Za-z0-9_]*)\s+/g, cls: "hl-field", group: 1 },
  ],
  /[<>{}:;,=|*&[\]]/g
);

const CSHARP_RULES = table(
  [
    ...C_COMMENTS,
    kw(
      "class record struct enum interface public private protected internal static readonly sealed abstract virtual override new namespace using get set init"
    ),
    builtin("bool int long float double decimal string char byte void object dynamic var"),
  ],
  /[<>{}:;,=|?()[\]]/g
);

const FSHARP_RULES = table(
  [
    SLASH_LINE_COMMENT,
    { re: /\(\*[\s\S]*?\*\)/gm, cls: "hl-comment" },
    kw(
      "type let mutable module open of match with and rec if then else member static abstract override interface inherit"
    ),
    builtin("bool int int64 float double decimal string unit byte char option list seq Map Set Result"),
    COLON_FIELD,
  ],
  /[<>{}:;,=|*()[\]]/g
);

const DART_RULES = table(
  [
    ...C_COMMENTS,
    kw(
      "class sealed final abstract extends implements with enum typedef const late static var void new factory this super return if else switch case default import library part of"
    ),
    builtin("bool int double num String List Map Set Object dynamic Null Never"),
    { re: /\b([a-z_][A-Za-z0-9_]*)\s*(?=;)/g, cls: "hl-field", group: 1 },
  ],
  /[<>{}:;,=|?()[\]]/g
);

const PHP_RULES = table(
  [
    SLASH_LINE_COMMENT,
    HASH_COMMENT,
    BLOCK_COMMENT,
    kw(
      "class interface abstract final readonly extends implements public private protected static function new return namespace use const enum match self parent this"
    ),
    builtin("bool int float string array object null void mixed never iterable callable true false"),
    { re: /\$[A-Za-z_][A-Za-z0-9_]*/g, cls: "hl-field" },
  ],
  /[<>{}:;,=|?()[\]]/g
);

const PROTOBUF_RULES = table(
  [
    ...C_COMMENTS,
    kw(
      "syntax message enum oneof service rpc returns package import option reserved repeated optional required map group"
    ),
    builtin("bool int32 int64 uint32 uint64 sint32 sint64 fixed32 fixed64 sfixed32 sfixed64 float double string bytes"),
    { re: /\b([a-z_][A-Za-z0-9_]*)\s*=\s*\d+/g, cls: "hl-field", group: 1 },
  ],
  /[<>{}:;,=()[\]]/g
);

type SupportedLang = "typescript" | "rust" | "python" | "go" | "csharp" | "fsharp" | "dart" | "protobuf" | "php";

const LANG_RULES: Record<SupportedLang, readonly Rule[]> = {
  typescript: TYPESCRIPT_RULES,
  rust: RUST_RULES,
  python: PYTHON_RULES,
  go: GO_RULES,
  csharp: CSHARP_RULES,
  fsharp: FSHARP_RULES,
  dart: DART_RULES,
  protobuf: PROTOBUF_RULES,
  php: PHP_RULES,
};

export const highlightLang = (source: string, lang: SupportedLang): string => runHighlight(source, LANG_RULES[lang]);

export const initLangHighlight = (textarea: HTMLTextAreaElement, backdrop: HTMLElement, getLang: () => SupportedLang) =>
  initHighlightOverlay(textarea, backdrop, () => highlightLang(textarea.value, getLang()), false);
