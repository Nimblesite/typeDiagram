export interface Span {
  line: number;
  col: number;
  offset: number;
  length: number;
}

export interface Diagram {
  decls: Declaration[];
  span: Span;
}

export type Declaration = RecordDecl | UnionDecl | AliasDecl | FunctionDecl;

export interface DeclTargeting {
  targets?: string[];
  skipTargets?: string[];
}

export interface RecordDecl {
  kind: "record";
  name: string;
  generics: string[];
  fields: Field[];
  targeting?: DeclTargeting;
  span: Span;
}

export interface UnionDecl {
  kind: "union";
  name: string;
  generics: string[];
  untagged?: true;
  variants: Variant[];
  targeting?: DeclTargeting;
  span: Span;
}

export interface AliasDecl {
  kind: "alias";
  name: string;
  generics: string[];
  target: TypeRef;
  targeting?: DeclTargeting;
  span: Span;
}

/** [DSL-FUNCTION] A named free function with one or more overload signatures. */
export interface FunctionDecl {
  kind: "function";
  name: string;
  generics: string[];
  signatures: FunctionSignature[];
  targeting?: DeclTargeting;
  span: Span;
}

export interface FunctionSignature {
  params: Field[];
  returns: TypeRef;
  async?: true;
  span: Span;
}

export interface Field {
  name: string;
  type: TypeRef;
  span: Span;
}

export interface Variant {
  name: string;
  discriminant?: string;
  fields: Field[];
  span: Span;
}

export interface TypeRef {
  name: string;
  args: TypeRef[];
  span: Span;
}
