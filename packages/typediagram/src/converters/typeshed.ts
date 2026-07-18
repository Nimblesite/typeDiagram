// [TYPESHED-CONVERT] Bidirectional .pyi/typeDiagram converter.
import type { Model, ResolvedDecl, ResolvedFunctionSignature, ResolvedTypeRef } from "../model/types.js";
import { walkDeclRefs } from "../model/types.js";
import { visibleDeclsForTarget } from "../model/types.js";
import type { Converter } from "./types.js";
import { analyzeTypeshedSource, type TypeshedAnalysis } from "./typeshed-decls.js";

export interface TypeshedConverter extends Converter {
  analyzeSource: typeof analyzeTypeshedSource;
}

const TD_TO_PYI: Readonly<Record<string, string>> = {
  Bool: "bool",
  Int: "int",
  Float: "float",
  String: "str",
  Bytes: "bytes",
  Unit: "None",
  List: "list",
  Map: "dict",
  Option: "Optional",
};

const printRef = (type: ResolvedTypeRef): string => {
  const name = TD_TO_PYI[type.name] ?? type.name;
  return type.args.length === 0 ? name : `${name}[${type.args.map(printRef).join(", ")}]`;
};

const generics = (decl: ResolvedDecl) => (decl.generics.length === 0 ? "" : `[${decl.generics.join(", ")}]`);

const emitRecord = (decl: Extract<ResolvedDecl, { kind: "record" }>) => {
  const body =
    decl.fields.length === 0 ? ["    ..."] : decl.fields.map((field) => `    ${field.name}: ${printRef(field.type)}`);
  return [`class ${decl.name}${generics(decl)}:`, ...body];
};

const emitUnion = (decl: Extract<ResolvedDecl, { kind: "union" }>) => [
  `class ${decl.name}(Enum):`,
  ...(decl.variants.length === 0 ? ["    ..."] : decl.variants.map((variant) => `    ${variant.name} = ...`)),
];

const printSignature = (name: string, signature: ResolvedFunctionSignature) => {
  const params = signature.params.map((param) => `${param.name}: ${printRef(param.type)}`).join(", ");
  return `${signature.async === true ? "async " : ""}def ${name}(${params}) -> ${printRef(signature.returns)}: ...`;
};

const emitFunction = (decl: Extract<ResolvedDecl, { kind: "function" }>) =>
  decl.signatures.flatMap((signature) => [
    ...(decl.signatures.length > 1 ? ["@overload"] : []),
    printSignature(decl.name, signature),
  ]);

const emitDecl = (decl: ResolvedDecl) =>
  decl.kind === "record"
    ? emitRecord(decl)
    : decl.kind === "union"
      ? emitUnion(decl)
      : decl.kind === "alias"
        ? [`type ${decl.name}${generics(decl)} = ${printRef(decl.target)}`]
        : emitFunction(decl);

const importsFor = (decls: readonly ResolvedDecl[]) => {
  const names = [
    ...(decls.some((decl) => decl.kind === "union") ? ["from enum import Enum"] : []),
    ...(decls.some((decl) => decl.kind === "function" && decl.signatures.length > 1)
      ? ["from typing import overload"]
      : []),
    ...(decls.some((decl) => usesType(decl, "Option")) ? ["from typing import Optional"] : []),
  ];
  return names.length === 0 ? [] : [...names, ""];
};

const usesType = (decl: ResolvedDecl, name: string) => {
  let found = false;
  const visit = (type: ResolvedTypeRef) => {
    found = found || type.name === name;
    type.args.forEach(visit);
  };
  walkDeclRefs(decl, visit);
  return found;
};

const toTypeshed = (model: Model) => {
  const decls = visibleDeclsForTarget(model.decls, "typeshed");
  return [...importsFor(decls), ...decls.flatMap((decl) => [...emitDecl(decl), ""])].join("\n");
};

export type { TypeshedAnalysis };

export const typeshed: TypeshedConverter = {
  language: "typeshed",
  analyzeSource: analyzeTypeshedSource,
  fromSource: (source) => {
    const analyzed = analyzeTypeshedSource(source);
    return analyzed.ok ? { ok: true, value: analyzed.value.model } : analyzed;
  },
  toSource: toTypeshed,
};
