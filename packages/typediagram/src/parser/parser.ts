import type {
  AliasDecl,
  DeclTargeting,
  Declaration,
  Diagram,
  Field,
  RecordDecl,
  Span,
  TypeRef,
  UnionDecl,
  Variant,
} from "./ast.js";
import { DiagnosticBag } from "./diagnostics.js";
import type { Token, TokenKind } from "./lexer.js";
import { tokenize } from "./lexer.js";
import { type Result, err, ok } from "../result.js";
import type { Diagnostic } from "./diagnostics.js";
import { withDiscriminant } from "../variant.js";

/** The keyword, name token, and generic parameters shared by every decl form. */
interface DeclHeader {
  kw: Token;
  nameTok: Token;
  generics: string[];
}

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
    const targeting = this.parseTargetingAnnotations();
    const t = this.cur.peek();
    if (t.kind === "TypeKw") {
      return this.parseRecord(targeting);
    }
    if (t.kind === "UnionKw") {
      return this.parseUnion(false, targeting);
    }
    if (t.kind === "UntaggedKw") {
      const next = this.cur.peek(1);
      if (next.kind !== "UnionKw") {
        return this.errorAndRecover(`expected 'union' after 'untagged', got ${describe(next)}`, next);
      }
      return this.parseUnion(true, targeting);
    }
    if (t.kind === "AliasKw") {
      return this.parseAlias(targeting);
    }
    return this.errorAndRecover(`expected 'type', 'union', 'untagged union', or 'alias', got ${describe(t)}`, t);
  }

  /** Emit an error diagnostic anchored at `tok`, recover to the next decl, return null. */
  private errorAndRecover(message: string, tok: Token): null {
    this.diags.error(message, tok.line, tok.col, tok.length || 1);
    this.recoverToTopLevel();
    return null;
  }

  private parseTargetingAnnotations(): DeclTargeting | undefined {
    let targeting: DeclTargeting | undefined;
    while (this.cur.peek().kind === "At") {
      this.cur.next();
      const nameTok = this.expect("Ident", "annotation name");
      if (nameTok === null) {
        return targeting;
      }
      if (this.expect("LParen", "'('") === null) {
        return targeting;
      }
      const values = this.parseCommaSeparated("RParen", () => this.expect("Ident", "target name")?.value ?? null);
      this.expect("RParen", "')'");

      targeting ??= {};
      if (nameTok.value === "targets") {
        targeting.targets = values;
      } else if (nameTok.value === "skipTargets") {
        targeting.skipTargets = values;
      } else {
        this.diags.error(`unknown annotation '@${nameTok.value}'`, nameTok.line, nameTok.col - 1, nameTok.length + 1);
      }
      this.cur.eatNewlines();
    }
    return targeting;
  }

  /** Consume a decl keyword's name + generics, recovering on a missing name.
   * Shared opening of parseRecord/parseUnion/parseAlias. */
  private parseDeclHeader(kw: Token, nameLabel: string): DeclHeader | null {
    const nameTok = this.expect("Ident", nameLabel);
    if (nameTok === null) {
      this.recoverToTopLevel();
      return null;
    }
    return { kw, nameTok, generics: this.parseGenericParams() };
  }

  private parseRecord(targeting?: DeclTargeting): RecordDecl | null {
    const header = this.parseDeclHeader(this.cur.next(), "type name");
    if (header === null) {
      return null;
    }
    if (this.expect("LBrace", "'{'") === null) {
      this.recoverToTopLevel();
      return null;
    }
    const fields = this.parseFieldList();
    const closeTok = this.expect("RBrace", "'}'");
    return {
      kind: "record",
      name: header.nameTok.value,
      generics: header.generics,
      fields,
      ...(targeting === undefined ? {} : { targeting }),
      span: spanBetween(header.kw, closeTok ?? header.kw),
    };
  }

  private parseUnion(untagged = false, targeting?: DeclTargeting): UnionDecl | null {
    const start = untagged ? this.cur.next() : this.cur.peek();
    const header = this.parseDeclHeader(this.cur.next(), "union name");
    if (header === null) {
      return null;
    }
    if (this.expect("LBrace", "'{'") === null) {
      this.recoverToTopLevel();
      return null;
    }
    const variants = this.parseVariantList();
    const closeTok = this.expect("RBrace", "'}'");
    return {
      kind: "union",
      name: header.nameTok.value,
      generics: header.generics,
      ...(untagged ? { untagged: true as const } : {}),
      variants,
      ...(targeting === undefined ? {} : { targeting }),
      span: spanBetween(start, closeTok ?? header.kw),
    };
  }

  private parseAlias(targeting?: DeclTargeting): AliasDecl | null {
    const header = this.parseDeclHeader(this.cur.next(), "alias name");
    if (header === null) {
      return null;
    }
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
      name: header.nameTok.value,
      generics: header.generics,
      target,
      ...(targeting === undefined ? {} : { targeting }),
      span: spanBetween(header.kw, this.cur.peek()),
    };
  }

  private parseCommaSeparated<T>(closer: TokenKind, parseItem: () => T | null): T[] {
    const items: T[] = [];
    while (this.cur.peek().kind !== closer && this.cur.peek().kind !== "EOF") {
      const item = parseItem();
      if (item === null) {
        break;
      }
      items.push(item);
      if (this.cur.peek().kind === "Comma") {
        this.cur.next();
      } else {
        break;
      }
    }
    return items;
  }

  private parseGenericParams(): string[] {
    if (this.cur.peek().kind !== "LAngle") {
      return [];
    }
    this.cur.next();
    const names = this.parseCommaSeparated(
      "RAngle",
      () => this.expect("Ident", "generic parameter name")?.value ?? null
    );
    this.expect("RAngle", "'>'");
    return names;
  }

  private parseBraceList<T>(parseItem: () => T | null): T[] {
    const items: T[] = [];
    for (;;) {
      this.cur.eatNewlines();
      const t = this.cur.peek();
      if (t.kind === "RBrace" || t.kind === "EOF") {
        break;
      }
      const item = parseItem();
      if (item !== null) {
        items.push(item);
      }
      this.eatSeparator();
    }
    return items;
  }

  private parseFieldList(): Field[] {
    return this.parseBraceList(() => this.parseField());
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
    return this.parseBraceList(() => this.parseVariant());
  }

  private parseVariant(): Variant | null {
    const nameTok = this.expect("Ident", "variant name");
    if (nameTok === null) {
      this.skipToFieldBoundary();
      return null;
    }
    const discriminant = this.parseVariantDiscriminant();
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
    return withDiscriminant<Variant>(
      {
        name: nameTok.value,
        fields,
        span: spanBetween(nameTok, this.cur.peek()),
      },
      discriminant
    );
  }

  private parseVariantDiscriminant(): string | undefined {
    if (this.cur.peek().kind !== "Equals") {
      return undefined;
    }
    this.cur.next();
    const valueTok = this.expect("Number", "numeric discriminant");
    return valueTok?.value;
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
    let args: TypeRef[] = [];
    if (this.cur.peek().kind === "LAngle") {
      this.cur.next();
      args = this.parseCommaSeparated("RAngle", () => this.parseTypeRef());
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

/** Lift a parsed value + its diagnostics into a Result: `err` iff any diagnostic
 * has error severity. Shared by `parse` and `tokenizeResult`. */
function toResult<T>(value: T, diagnostics: Diagnostic[]): Result<T, Diagnostic[]> {
  return diagnostics.some((d) => d.severity === "error") ? err(diagnostics) : ok(value);
}

export function parse(source: string): Result<Diagram, Diagnostic[]> {
  const { ast, diagnostics } = parsePartial(source);
  return toResult(ast, diagnostics);
}

export function tokenizePartial(source: string): { tokens: Token[]; diagnostics: Diagnostic[] } {
  const bag = new DiagnosticBag();
  const tokens = tokenize(source, bag);
  return { tokens, diagnostics: bag.items };
}

export function tokenizeResult(source: string): Result<Token[], Diagnostic[]> {
  const { tokens, diagnostics } = tokenizePartial(source);
  return toResult(tokens, diagnostics);
}
