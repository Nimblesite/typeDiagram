import type { AliasDecl, Declaration, Diagram, Field, RecordDecl, Span, TypeRef, UnionDecl, Variant } from "./ast.js";
import { DiagnosticBag } from "./diagnostics.js";
import type { Token, TokenKind } from "./lexer.js";
import { tokenize } from "./lexer.js";
import { type Result, err, ok } from "../result.js";
import type { Diagnostic } from "./diagnostics.js";

class Cursor {
  private i = 0;
  constructor(private readonly tokens: Token[]) {}

  peek(offset = 0): Token {
    const t = this.tokens[this.i + offset] ?? this.tokens[this.tokens.length - 1];
    if (t === undefined) {
      throw new Error("Cursor.peek: empty token stream");
    }
    return t;
  }

  next(): Token {
    const t = this.peek();
    if (t.kind !== "EOF") {
      this.i++;
    }
    return t;
  }

  eat(kind: TokenKind): Token | null {
    if (this.peek().kind === kind) {
      return this.next();
    }
    return null;
  }

  eatNewlines(): void {
    while (this.peek().kind === "Newline") {
      this.next();
    }
  }
}

class Parser {
  constructor(
    private readonly cur: Cursor,
    private readonly diags: DiagnosticBag
  ) {}

  parseDiagram(): Diagram {
    const start = this.cur.peek();
    this.cur.eatNewlines();
    // optional `typeDiagram` header
    if (this.cur.peek().kind === "TypeDiagramKw") {
      this.cur.next();
      this.cur.eatNewlines();
    }

    const decls: Declaration[] = [];
    while (this.cur.peek().kind !== "EOF") {
      this.cur.eatNewlines();
      if (this.cur.peek().kind === "EOF") {
        break;
      }
      const decl = this.parseDeclaration();
      if (decl !== null) {
        decls.push(decl);
      }
      this.cur.eatNewlines();
    }

    const end = this.cur.peek();
    return {
      decls,
      span: spanBetween(start, end),
    };
  }

  private parseDeclaration(): Declaration | null {
    const t = this.cur.peek();
    if (t.kind === "TypeKw") {
      return this.parseRecord();
    }
    if (t.kind === "UnionKw") {
      return this.parseUnion();
    }
    if (t.kind === "AliasKw") {
      return this.parseAlias();
    }
    this.diags.error(`expected 'type', 'union', or 'alias', got ${describe(t)}`, t.line, t.col, t.length || 1);
    this.recoverToTopLevel();
    return null;
  }

  private parseRecord(): RecordDecl | null {
    const kw = this.cur.next(); // TypeKw
    const nameTok = this.expect("Ident", "type name");
    if (nameTok === null) {
      this.recoverToTopLevel();
      return null;
    }
    const generics = this.parseGenericParams();
    if (this.expect("LBrace", "'{'") === null) {
      this.recoverToTopLevel();
      return null;
    }
    const fields = this.parseFieldList();
    const closeTok = this.expect("RBrace", "'}'");
    return {
      kind: "record",
      name: nameTok.value,
      generics,
      fields,
      span: spanBetween(kw, closeTok ?? kw),
    };
  }

  private parseUnion(): UnionDecl | null {
    const kw = this.cur.next();
    const nameTok = this.expect("Ident", "union name");
    if (nameTok === null) {
      this.recoverToTopLevel();
      return null;
    }
    const generics = this.parseGenericParams();
    if (this.expect("LBrace", "'{'") === null) {
      this.recoverToTopLevel();
      return null;
    }
    const variants = this.parseVariantList();
    const closeTok = this.expect("RBrace", "'}'");
    return {
      kind: "union",
      name: nameTok.value,
      generics,
      variants,
      span: spanBetween(kw, closeTok ?? kw),
    };
  }

  private parseAlias(): AliasDecl | null {
    const kw = this.cur.next();
    const nameTok = this.expect("Ident", "alias name");
    if (nameTok === null) {
      this.recoverToTopLevel();
      return null;
    }
    const generics = this.parseGenericParams();
    if (this.expect("Equals", "'='") === null) {
      this.recoverToTopLevel();
      return null;
    }
    const target = this.parseTypeRef();
    if (target === null) {
      this.recoverToTopLevel();
      return null;
    }
    return {
      kind: "alias",
      name: nameTok.value,
      generics,
      target,
      span: spanBetween(kw, this.cur.peek()),
    };
  }

  private parseGenericParams(): string[] {
    if (this.cur.peek().kind !== "LAngle") {
      return [];
    }
    this.cur.next();
    const names: string[] = [];
    while (this.cur.peek().kind !== "RAngle" && this.cur.peek().kind !== "EOF") {
      const t = this.expect("Ident", "generic parameter name");
      if (t === null) {
        break;
      }
      names.push(t.value);
      if (this.cur.peek().kind === "Comma") {
        this.cur.next();
      } else {
        break;
      }
    }
    this.expect("RAngle", "'>'");
    return names;
  }

  private parseFieldList(): Field[] {
    const fields: Field[] = [];
    for (;;) {
      this.cur.eatNewlines();
      const t = this.cur.peek();
      if (t.kind === "RBrace" || t.kind === "EOF") {
        break;
      }
      const field = this.parseField();
      if (field !== null) {
        fields.push(field);
      }
      this.eatSeparator();
    }
    return fields;
  }

  private parseField(): Field | null {
    const nameTok = this.expect("Ident", "field name");
    if (nameTok === null) {
      this.skipToFieldBoundary();
      return null;
    }
    if (this.expect("Colon", "':'") === null) {
      this.skipToFieldBoundary();
      return null;
    }
    const type = this.parseTypeRef();
    if (type === null) {
      this.skipToFieldBoundary();
      return null;
    }
    return {
      name: nameTok.value,
      type,
      span: spanBetween(nameTok, this.cur.peek()),
    };
  }

  private parseVariantList(): Variant[] {
    const variants: Variant[] = [];
    for (;;) {
      this.cur.eatNewlines();
      const t = this.cur.peek();
      if (t.kind === "RBrace" || t.kind === "EOF") {
        break;
      }
      const v = this.parseVariant();
      if (v !== null) {
        variants.push(v);
      }
      this.eatSeparator();
    }
    return variants;
  }

  private parseVariant(): Variant | null {
    const nameTok = this.expect("Ident", "variant name");
    if (nameTok === null) {
      this.skipToFieldBoundary();
      return null;
    }
    let fields: Field[] = [];
    if (this.cur.peek().kind === "LBrace") {
      this.cur.next();
      fields = this.parseFieldList();
      this.expect("RBrace", "'}'");
    } else if (this.cur.peek().kind === "LParen") {
      this.cur.next();
      fields = this.parseTupleVariantFieldList();
      this.expect("RParen", "')'");
    }
    return {
      name: nameTok.value,
      fields,
      span: spanBetween(nameTok, this.cur.peek()),
    };
  }

  private parseTupleVariantFieldList(): Field[] {
    const fields: Field[] = [];
    for (;;) {
      this.cur.eatNewlines();
      if (this.cur.peek().kind === "RParen" || this.cur.peek().kind === "EOF") {
        return fields;
      }
      const type = this.parseTypeRef();
      if (type === null) {
        return fields;
      }
      fields.push({
        name: `_${String(fields.length)}`,
        type,
        span: type.span,
      });
      this.cur.eatNewlines();
      if (this.cur.peek().kind === "Comma") {
        this.cur.next();
      } else {
        return fields;
      }
    }
  }

  private parseTypeRef(): TypeRef | null {
    const nameTok = this.expect("Ident", "type name");
    if (nameTok === null) {
      return null;
    }
    const args: TypeRef[] = [];
    if (this.cur.peek().kind === "LAngle") {
      this.cur.next();
      while (this.cur.peek().kind !== "RAngle" && this.cur.peek().kind !== "EOF") {
        const arg = this.parseTypeRef();
        if (arg === null) {
          break;
        }
        args.push(arg);
        if (this.cur.peek().kind === "Comma") {
          this.cur.next();
        } else {
          break;
        }
      }
      this.expect("RAngle", "'>'");
    }
    return {
      name: nameTok.value,
      args,
      span: spanBetween(nameTok, this.cur.peek()),
    };
  }

  private expect(kind: TokenKind, what: string): Token | null {
    const t = this.cur.peek();
    if (t.kind === kind) {
      return this.cur.next();
    }
    this.diags.error(`expected ${what}, got ${describe(t)}`, t.line, t.col, t.length || 1);
    return null;
  }

  private eatSeparator(): void {
    // Comma and/or newline are both valid separators between fields/variants.
    if (this.cur.peek().kind === "Comma") {
      this.cur.next();
    }
    this.cur.eatNewlines();
  }

  private skipToFieldBoundary(): void {
    for (;;) {
      const t = this.cur.peek();
      if (t.kind === "Newline" || t.kind === "Comma" || t.kind === "RBrace" || t.kind === "EOF") {
        return;
      }
      this.cur.next();
    }
  }

  private recoverToTopLevel(): void {
    let depth = 0;
    for (;;) {
      const t = this.cur.peek();
      if (t.kind === "EOF") {
        return;
      }
      if (t.kind === "LBrace") {
        depth++;
      } else if (t.kind === "RBrace") {
        if (depth === 0) {
          this.cur.next();
          return;
        }
        depth--;
      } else if (depth === 0 && (t.kind === "TypeKw" || t.kind === "UnionKw" || t.kind === "AliasKw")) {
        return;
      }
      this.cur.next();
    }
  }
}

function spanBetween(a: Token, b: Token): Span {
  return {
    line: a.line,
    col: a.col,
    offset: a.offset,
    length: Math.max(0, b.offset + b.length - a.offset),
  };
}

function describe(t: Token): string {
  if (t.kind === "EOF") {
    return "end of input";
  }
  if (t.kind === "Newline") {
    return "newline";
  }
  return `${t.kind} "${t.value}"`;
}

export function parsePartial(source: string): { ast: Diagram; diagnostics: Diagnostic[] } {
  const bag = new DiagnosticBag();
  const tokens = tokenize(source, bag);
  const parser = new Parser(new Cursor(tokens), bag);
  const ast = parser.parseDiagram();
  return { ast, diagnostics: bag.items };
}

export function parse(source: string): Result<Diagram, Diagnostic[]> {
  const { ast, diagnostics } = parsePartial(source);
  const errors = diagnostics.filter((d) => d.severity === "error");
  return errors.length === 0 ? ok(ast) : err(diagnostics);
}

export function tokenizePartial(source: string): { tokens: Token[]; diagnostics: Diagnostic[] } {
  const bag = new DiagnosticBag();
  const tokens = tokenize(source, bag);
  return { tokens, diagnostics: bag.items };
}

export function tokenizeResult(source: string): Result<Token[], Diagnostic[]> {
  const { tokens, diagnostics } = tokenizePartial(source);
  const errors = diagnostics.filter((d) => d.severity === "error");
  return errors.length === 0 ? ok(tokens) : err(diagnostics);
}
