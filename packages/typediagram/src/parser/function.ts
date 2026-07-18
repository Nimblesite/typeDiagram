// [DSL-FUNCTION] Parser for free-function signatures and overload blocks.
import type { DeclTargeting, Field, FunctionDecl, FunctionSignature } from "./ast.js";
import type { DiagnosticBag } from "./diagnostics.js";
import type { Token } from "./lexer.js";
import {
  expectToken,
  parseCommaSeparated,
  parseGenericParams,
  parseTypeRef,
  spanBetween,
  type TokenCursor,
} from "./parse-common.js";

interface FunctionHead {
  start: Token;
  name: Token;
  generics: string[];
  async: boolean;
}

export const parseFunction = (
  cur: TokenCursor,
  diags: DiagnosticBag,
  targeting?: DeclTargeting
): FunctionDecl | null => {
  const head = parseHead(cur, diags);
  if (head === null) {
    return null;
  }
  const signatures = cur.peek().kind === "LBrace" ? parseOverloads(cur, diags) : oneSignature(cur, diags, head.async);
  return signatures === null ? null : makeFunction(head, signatures, targeting, cur.peek());
};

const parseHead = (cur: TokenCursor, diags: DiagnosticBag): FunctionHead | null => {
  const start = cur.peek();
  const async = cur.eat("AsyncKw") !== null;
  const keyword = expectToken(cur, diags, "FunctionKw", "'function'");
  const name = expectToken(cur, diags, "Ident", "function name");
  return keyword === null || name === null ? null : { start, name, generics: parseGenericParams(cur, diags), async };
};

const oneSignature = (cur: TokenCursor, diags: DiagnosticBag, async: boolean) => {
  const signature = parseSignature(cur, diags, async);
  return signature === null ? null : [signature];
};

const parseOverloads = (cur: TokenCursor, diags: DiagnosticBag) => {
  cur.next();
  const signatures: FunctionSignature[] = [];
  cur.eatNewlines();
  while (cur.peek().kind !== "RBrace" && cur.peek().kind !== "EOF") {
    const async = cur.eat("AsyncKw") !== null;
    const signature = parseSignature(cur, diags, async);
    switch (signature) {
      case null:
        recoverSignature(cur);
        break;
      default:
        signatures.push(signature);
    }
    cur.eat("Comma");
    cur.eatNewlines();
  }
  expectToken(cur, diags, "RBrace", "'}'");
  return signatures;
};

const parseSignature = (cur: TokenCursor, diags: DiagnosticBag, async: boolean): FunctionSignature | null => {
  const start = expectToken(cur, diags, "LParen", "'('");
  if (start === null) {
    return null;
  }
  const params = parseCommaSeparated(cur, "RParen", () => parseParam(cur, diags));
  const close = expectToken(cur, diags, "RParen", "')'");
  const arrow = expectToken(cur, diags, "Arrow", "'->'");
  const returns = parseTypeRef(cur, diags);
  return close === null || arrow === null || returns === null
    ? null
    : { params, returns, ...(async ? { async: true as const } : {}), span: spanBetween(start, cur.peek()) };
};

const parseParam = (cur: TokenCursor, diags: DiagnosticBag): Field | null => {
  const name = expectToken(cur, diags, "Ident", "parameter name");
  const colon = expectToken(cur, diags, "Colon", "':'");
  const type = parseTypeRef(cur, diags);
  return name === null || colon === null || type === null
    ? null
    : { name: name.value, type, span: spanBetween(name, cur.peek()) };
};

const recoverSignature = (cur: TokenCursor) => {
  while (!["Newline", "RBrace", "EOF"].includes(cur.peek().kind)) {
    cur.next();
  }
};

const makeFunction = (
  head: FunctionHead,
  signatures: FunctionSignature[],
  targeting: DeclTargeting | undefined,
  end: Token
): FunctionDecl => ({
  kind: "function",
  name: head.name.value,
  generics: head.generics,
  signatures,
  ...(targeting === undefined ? {} : { targeting }),
  span: spanBetween(head.start, end),
});
