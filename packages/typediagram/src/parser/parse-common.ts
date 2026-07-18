// [PARSER-COMMON] Shared token parsers used by data and function declarations.
import type { Span, TypeRef } from "./ast.js";
import type { DiagnosticBag } from "./diagnostics.js";
import type { Token, TokenKind } from "./lexer.js";

export interface TokenCursor {
  peek(offset?: number): Token;
  next(): Token;
  eat(kind: TokenKind): Token | null;
  eatNewlines(): void;
}

export const expectToken = (cur: TokenCursor, diags: DiagnosticBag, kind: TokenKind, what: string) => {
  const token = cur.peek();
  return token.kind === kind
    ? cur.next()
    : (diags.error(`expected ${what}, got ${describeToken(token)}`, token.line, token.col, token.length || 1), null);
};

export const parseCommaSeparated = <T>(cur: TokenCursor, closer: TokenKind, parseItem: () => T | null) => {
  const items: T[] = [];
  while (cur.peek().kind !== closer && cur.peek().kind !== "EOF") {
    const item = parseItem();
    items.push(...(item === null ? [] : [item]));
    if (item === null || cur.peek().kind !== "Comma") {
      break;
    }
    cur.next();
    cur.eatNewlines();
  }
  return items;
};

export const parseGenericParams = (cur: TokenCursor, diags: DiagnosticBag) => {
  if (cur.peek().kind !== "LAngle") {
    return [];
  }
  cur.next();
  const names = parseCommaSeparated(
    cur,
    "RAngle",
    () => expectToken(cur, diags, "Ident", "generic parameter name")?.value ?? null
  );
  expectToken(cur, diags, "RAngle", "'>'");
  return names;
};

export const parseTypeRef = (cur: TokenCursor, diags: DiagnosticBag): TypeRef | null => {
  const name = expectToken(cur, diags, "Ident", "type name");
  if (name === null) {
    return null;
  }
  const args = cur.peek().kind === "LAngle" ? parseTypeArgs(cur, diags) : [];
  return { name: name.value, args, span: spanBetween(name, cur.peek()) };
};

const parseTypeArgs = (cur: TokenCursor, diags: DiagnosticBag) => {
  cur.next();
  const args = parseCommaSeparated(cur, "RAngle", () => parseTypeRef(cur, diags));
  expectToken(cur, diags, "RAngle", "'>'");
  return args;
};

export const spanBetween = (start: Token, end: Token): Span => ({
  line: start.line,
  col: start.col,
  offset: start.offset,
  length: Math.max(0, end.offset + end.length - start.offset),
});

export const describeToken = (token: Token) =>
  token.kind === "EOF" ? "end of input" : token.kind === "Newline" ? "newline" : `${token.kind} "${token.value}"`;
