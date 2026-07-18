// [TYPESHED-DECLS] Extract module declarations from the Python syntax tree.
import type { Diagnostic } from "../parser/diagnostics.js";
import { type Result, err, ok } from "../result.js";
import {
  ModelBuilder,
  alias,
  functionDecl,
  ref,
  record,
  union,
  type FieldSpec,
  type FunctionSignatureSpec,
} from "../model/builder.js";
import {
  walkDeclRefs,
  type Model,
  type ResolvedDecl,
  type ResolvedFunctionSignature,
  type ResolvedTypeRef,
} from "../model/types.js";
import { isClassVar, pythonTypeRef } from "./typeshed-type-ref.js";
import {
  childOf,
  childrenOf,
  classMembers,
  definitionOf,
  descendantNames,
  firstErrorNode,
  firstNamedChild,
  isTypeDiagramKeyword,
  moduleNodes,
  namedChildrenOf,
  parsePythonStub,
  safeTypeName,
  textOf,
  type PythonNode,
} from "./typeshed-tree.js";

export interface TypeshedStats {
  declarationsSeen: number;
  declarationsConverted: number;
  methodsSkipped: number;
}

export interface TypeshedAnalysis {
  model: Model;
  stats: TypeshedStats;
}

interface Candidate {
  decl: ResolvedDecl;
  offset: number;
}

export const analyzeTypeshedSource = (source: string): Result<TypeshedAnalysis, Diagnostic[]> => {
  const tree = parsePythonStub(source);
  const parseError = firstErrorNode(tree.topNode);
  if (parseError !== undefined) {
    return err([syntaxDiagnostic(source, parseError)]);
  }
  const extracted = extractCandidates(moduleNodes(tree.topNode), source);
  if (extracted.candidates.length === 0) {
    return err([emptyDiagnostic()]);
  }
  const builder = new ModelBuilder();
  const decls = mergeCandidates(extracted.candidates).map((candidate) => candidate.decl);
  normalizeDeclaredArities(decls).forEach((decl) => builder.add(decl));
  const built = builder.build();
  return built.ok ? ok({ model: built.value, stats: extracted.stats }) : built;
};

const extractCandidates = (nodes: PythonNode[], source: string) => {
  const candidates = nodes.flatMap((node) => candidateFor(node, source));
  const classes = nodes.map(definitionOf).filter((node): node is PythonNode => node?.name === "ClassDefinition");
  const methodsSkipped = classes.reduce((total, node) => total + countMethods(node), 0);
  const stats = { declarationsSeen: candidates.length, declarationsConverted: candidates.length, methodsSkipped };
  return { candidates, stats };
};

const candidateFor = (node: PythonNode, source: string): Candidate[] => {
  const definition = definitionOf(node);
  return definition?.name === "ClassDefinition"
    ? [classCandidate(definition, source)]
    : definition?.name === "FunctionDefinition"
      ? [functionCandidate(definition, source)]
      : node.name === "TypeDefinition"
        ? [typeAliasCandidate(node, source)]
        : node.name === "AssignStatement"
          ? assignmentCandidate(node, source)
          : [];
};

const classCandidate = (node: PythonNode, source: string): Candidate => {
  const name = definitionName(node, source);
  const generics = definitionGenerics(node, source);
  const bases = classBases(node, source);
  const decl = bases.some(isEnumBase)
    ? union(name, enumVariants(node, source), generics)
    : record(name, classFields(node, source), generics);
  return { decl, offset: node.from };
};

const definitionName = (node: PythonNode, source: string) =>
  safeTypeName(textOf(source, childrenOf(node).find((child) => child.name === "VariableName") ?? node));

const definitionGenerics = (node: PythonNode, source: string) => {
  const modern = childOf(node, "TypeParamList");
  if (modern !== undefined) {
    return genericNames(modern, source);
  }
  const genericBase = classBases(node, source).find((base) => base.name === "Generic");
  return genericBase?.args.map((arg) => arg.name) ?? [];
};

const genericNames = (node: PythonNode, source: string) =>
  childrenOf(node)
    .filter((child) => child.name === "TypeParam")
    .flatMap((param) => descendantNames(param, "VariableName").slice(0, 1))
    .map((name) => textOf(source, name));

const classBases = (node: PythonNode, source: string) => {
  const args = childOf(node, "ArgList");
  return args === undefined ? [] : namedChildrenOf(args).map((child) => pythonTypeRef(child, source));
};

const isEnumBase = (base: ResolvedTypeRef) => ["Enum", "IntEnum", "StrEnum", "Flag", "IntFlag"].includes(base.name);

const classFields = (node: PythonNode, source: string) =>
  classMembers(node).flatMap((member) => (member.name === "AssignStatement" ? annotatedField(member, source) : []));

const annotatedField = (node: PythonNode, source: string): FieldSpec[] => {
  const name = childrenOf(node).find((child) => child.name === "VariableName");
  const type = childOf(node, "TypeDef");
  return name === undefined || type === undefined || isClassVar(firstNamedChild(type), source)
    ? []
    : [{ name: safeMemberName(textOf(source, name)), type: pythonTypeRef(type, source) }];
};

const enumVariants = (node: PythonNode, source: string) =>
  classMembers(node).flatMap((member) => {
    const name = member.name === "AssignStatement" ? childOf(member, "VariableName") : undefined;
    return name === undefined || textOf(source, name).startsWith("_")
      ? []
      : [{ name: safeMemberName(textOf(source, name)), fields: [] }];
  });

const functionCandidate = (node: PythonNode, source: string): Candidate => ({
  decl: functionDecl(definitionName(node, source), [functionSignature(node, source)], definitionGenerics(node, source)),
  offset: node.from,
});

const functionSignature = (node: PythonNode, source: string): FunctionSignatureSpec => ({
  params: functionParams(childOf(node, "ParamList"), source),
  returns: pythonTypeRef(childOf(node, "TypeDef"), source),
  ...(childrenOf(node).some((child) => child.name === "async") ? { async: true } : {}),
});

const functionParams = (params: PythonNode | undefined, source: string) => {
  const children = params === undefined ? [] : childrenOf(params);
  return children.flatMap((child, index) => paramFor(children, child, index, source));
};

const paramFor = (siblings: PythonNode[], node: PythonNode, index: number, source: string): FieldSpec[] => {
  if (node.name !== "VariableName") {
    return [];
  }
  const typeNode = siblings.at(index + 1)?.name === "TypeDef" ? siblings.at(index + 1) : undefined;
  const type = pythonTypeRef(typeNode, source);
  const marker = siblings.at(index - 1)?.name;
  const wrapped = marker === "**" ? mapParam(type) : marker === "*" ? listParam(type) : type;
  return [{ name: safeMemberName(textOf(source, node)), type: wrapped }];
};

const listParam = (type: ResolvedTypeRef) => ({ ...type, name: "List", args: [type] });

const mapParam = (type: ResolvedTypeRef) => ({ ...type, name: "Map", args: [ref("String"), type] });

const typeAliasCandidate = (node: PythonNode, source: string): Candidate => {
  const named = namedChildrenOf(node);
  const name = named.find((child) => child.name === "VariableName");
  const target = named.at(-1);
  const generics = childOf(node, "TypeParamList");
  return {
    decl: alias(
      safeTypeName(textOf(source, name ?? node)),
      pythonTypeRef(target, source),
      generics === undefined ? [] : genericNames(generics, source)
    ),
    offset: node.from,
  };
};

const assignmentCandidate = (node: PythonNode, source: string): Candidate[] => {
  const name = childOf(node, "VariableName");
  const target = assignmentTarget(node);
  const annotation = childOf(node, "TypeDef");
  const explicit = pythonTypeRef(annotation, source).name === "TypeAlias";
  return name === undefined || target === undefined || (!explicit && !isImplicitAlias(name, target, source))
    ? []
    : [{ decl: alias(safeTypeName(textOf(source, name)), pythonTypeRef(target, source)), offset: node.from }];
};

const assignmentTarget = (node: PythonNode) => {
  const children = childrenOf(node);
  const assign = children.findIndex((child) => child.name === "AssignOp");
  return children.slice(assign + 1).find((child) => !child.type.isAnonymous);
};

const isImplicitAlias = (name: PythonNode, target: PythonNode, source: string) => {
  const value = textOf(source, name);
  const allCaps = value === value.toUpperCase() && value !== value.toLowerCase();
  const callee = target.name === "CallExpression" ? textOf(source, firstNamedChild(target) ?? target) : "";
  const typeShape = ["VariableName", "MemberExpression", "BinaryExpression", "String"].includes(target.name);
  return !allCaps && (typeShape || callee.endsWith("NewType") || callee.endsWith("TypeAliasType"));
};

const countMethods = (node: PythonNode) =>
  classMembers(node).filter((member) => definitionOf(member)?.name === "FunctionDefinition").length;

const safeMemberName = (name: string) => (isTypeDiagramKeyword(name) ? `${name}_` : name);

const mergeCandidates = (candidates: Candidate[]) => {
  const merged = new Map<string, Candidate>();
  candidates
    .sort((left, right) => left.offset - right.offset)
    .forEach((candidate) => {
      mergeCandidate(merged, candidate);
    });
  return [...merged.values()];
};

const mergeCandidate = (merged: Map<string, Candidate>, candidate: Candidate) => {
  const current = merged.get(candidate.decl.name);
  merged.set(
    candidate.decl.name,
    current === undefined ? candidate : { ...current, decl: mergeDecl(current.decl, candidate.decl) }
  );
};

const mergeDecl = (left: ResolvedDecl, right: ResolvedDecl): ResolvedDecl =>
  left.kind === "function" && right.kind === "function"
    ? { ...left, signatures: uniqueSignatures([...left.signatures, ...right.signatures]) }
    : left.kind === "record" && right.kind === "record"
      ? { ...left, fields: uniqueNamed([...left.fields, ...right.fields]) }
      : left.kind === "union" && right.kind === "union"
        ? { ...left, variants: uniqueNamed([...left.variants, ...right.variants]) }
        : left;

const uniqueNamed = <T extends { name: string }>(values: T[]) =>
  values.filter((value, index) => values.findIndex((candidate) => candidate.name === value.name) === index);

const uniqueSignatures = (values: ResolvedFunctionSignature[]) =>
  values.filter(
    (value, index) => values.findIndex((candidate) => signatureKey(candidate) === signatureKey(value)) === index
  );

const signatureKey = (signature: ResolvedFunctionSignature) =>
  `${signature.async === true ? "async" : "sync"}|${signature.params.map((param) => `${param.name}:${refKey(param.type)}`).join(",")}|${refKey(signature.returns)}`;

const refKey = (type: ResolvedTypeRef): string => `${type.name}<${type.args.map(refKey).join(",")}>`;

const normalizeDeclaredArities = (decls: ResolvedDecl[]) => {
  const arities = new Map(decls.map((decl) => [decl.name, decl.generics.length]));
  decls.forEach((decl) => {
    walkDeclRefs(decl, (type) => {
      recordArity(arities, type);
    });
  });
  decls.forEach((decl) => {
    extendGenerics(decl, arities.get(decl.name) ?? decl.generics.length);
  });
  decls.forEach((decl) => {
    walkDeclRefs(decl, (type) => {
      padDeclaredRef(type, arities);
    });
  });
  return decls;
};

const recordArity = (arities: Map<string, number>, type: ResolvedTypeRef) => {
  const current = arities.get(type.name);
  switch (current) {
    case undefined:
      break;
    default:
      arities.set(type.name, Math.max(current, type.args.length));
  }
};

const extendGenerics = (decl: ResolvedDecl, arity: number) => {
  while (decl.generics.length < arity) {
    decl.generics.push(uniqueGeneric(decl.generics, decl.generics.length + 1));
  }
};

const uniqueGeneric = (generics: string[], index: number): string => {
  const candidate = `_T${String(index)}`;
  return generics.includes(candidate) ? uniqueGeneric(generics, index + 1) : candidate;
};

const padDeclaredRef = (type: ResolvedTypeRef, arities: ReadonlyMap<string, number>) => {
  const arity = arities.get(type.name) ?? type.args.length;
  while (type.args.length < arity) {
    type.args.push(ref("Any"));
  }
};

const syntaxDiagnostic = (source: string, node: PythonNode): Diagnostic => {
  const lines = source.slice(0, node.from).split("\n");
  return {
    severity: "error",
    message: "Invalid typeshed/Python stub syntax",
    line: lines.length,
    col: (lines.at(-1)?.length ?? 0) + 1,
    length: Math.max(1, node.to - node.from),
  };
};

const emptyDiagnostic = (): Diagnostic => ({
  severity: "error",
  message: "No typeshed declarations found",
  line: 0,
  col: 0,
  length: 0,
});
