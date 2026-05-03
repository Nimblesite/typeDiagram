import type { DiagnosticBag } from "./diagnostics.js";

export type TokenKind =
  | "TypeKw"
  | "UnionKw"
  | "AliasKw"
  | "TypeDiagramKw"
  | "Ident"
  | "LBrace"
  | "RBrace"
  | "LParen"
  | "RParen"
  | "LAngle"
  | "RAngle"
  | "Comma"
  | "Colon"
  | "Equals"
  | "Newline"
  | "EOF";

export interface Token {
  kind: TokenKind;
  value: string;
  line: number;
  col: number;
  offset: number;
  length: number;
}

const KEYWORDS: Record<string, TokenKind> = {
  type: "TypeKw",
  union: "UnionKw",
  alias: "AliasKw",
  typeDiagram: "TypeDiagramKw",
};

const SINGLE_CHAR: Record<string, TokenKind> = {
  "{": "LBrace",
  "}": "RBrace",
  "(": "LParen",
  ")": "RParen",
  "<": "LAngle",
  ">": "RAngle",
  ",": "Comma",
  ":": "Colon",
  "=": "Equals",
};

function isIdentStart(c: string): boolean {
  return (c >= "A" && c <= "Z") || (c >= "a" && c <= "z") || c === "_";
}

function isIdentCont(c: string): boolean {
  return isIdentStart(c) || (c >= "0" && c <= "9");
}

export function tokenize(source: string, diagnostics: DiagnosticBag): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  let col = 1;
  const len = source.length;

  const emit = (kind: TokenKind, value: string, startLine: number, startCol: number, startOffset: number): void => {
    tokens.push({ kind, value, line: startLine, col: startCol, offset: startOffset, length: value.length });
  };

  while (i < len) {
    const c = source.charAt(i);

    if (c === " " || c === "\t") {
      i++;
      col++;
      continue;
    }

    if (c === "\r") {
      const startLine = line;
      const startCol = col;
      const startOffset = i;
      i++;
      if (i < len && source[i] === "\n") {
        i++;
      }
      emit("Newline", "\n", startLine, startCol, startOffset);
      line++;
      col = 1;
      continue;
    }

    if (c === "\n") {
      emit("Newline", "\n", line, col, i);
      i++;
      line++;
      col = 1;
      continue;
    }

    if (c === "#") {
      while (i < len && source[i] !== "\n" && source[i] !== "\r") {
        i++;
        col++;
      }
      continue;
    }

    if (isIdentStart(c)) {
      const startLine = line;
      const startCol = col;
      const startOffset = i;
      let end = i + 1;
      while (end < len && isIdentCont(source.charAt(end))) {
        end++;
      }
      const value = source.slice(i, end);
      const kind = KEYWORDS[value] ?? "Ident";
      emit(kind, value, startLine, startCol, startOffset);
      col += end - i;
      i = end;
      continue;
    }

    const single = SINGLE_CHAR[c];
    if (single !== undefined) {
      emit(single, c, line, col, i);
      i++;
      col++;
      continue;
    }

    diagnostics.error(`unexpected character '${c}'`, line, col, 1);
    i++;
    col++;
  }

  tokens.push({ kind: "EOF", value: "", line, col, offset: i, length: 0 });
  return tokens;
}
