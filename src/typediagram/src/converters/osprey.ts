// [CONV-OSPREY] One-way model emission; no parser or shared-memory ABI is implied.
import {
  visibleDeclsForTarget,
  walkDeclRefs,
  type Model,
  type ResolvedDecl,
  type ResolvedTypeRef,
} from "../model/types.js";
import type { Diagnostic } from "../parser/diagnostics.js";
import { err, ok, type Result } from "../result.js";
import { emitDecls, type DeclEmitters } from "./emit-decls.js";
import { mapBuiltinName } from "./parse-typeref.js";

const PRIMITIVES: Readonly<Record<string, string>> = {
  Int: "int",
  I32: "int",
  U8: "int",
  U16: "int",
  U32: "int",
  U64: "int",
  Size: "int",
  Path: "string",
  Float: "float",
  Bool: "bool",
  String: "string",
  Unit: "unit",
  Uuid: "string",
  List: "List",
  Option: "Option",
  Result: "Result",
};

// Osprey ML keyword spellings; reject rather than silently rename schema members.
const RESERVED = new Set(
  "mut true false match type extern spawn effect perform handle handler resume mask instance in await yield send recv select import namespace module signature export opaque state as do".split(
    " "
  )
);

const typeName = (type: ResolvedTypeRef): string => {
  const name = mapBuiltinName(type, PRIMITIVES);
  return type.args.length === 0 ? name : `${name}<${type.args.map(typeName).join(", ")}>`;
};

const header = (decl: { name: string; generics: string[] }): string =>
  `type ${[decl.name, ...decl.generics].join(" ")} =`;

const memberNames = (decl: ResolvedDecl) =>
  decl.kind === "record"
    ? decl.fields.map((field) => field.name)
    : decl.kind === "union"
      ? decl.variants.flatMap((variant) => [variant.name, ...variant.fields.map((field) => field.name)])
      : [];

const declarationErrors = (decl: ResolvedDecl) => [
  ...(decl.kind === "function" ||
  (decl.kind === "record" && decl.fields.length === 0) ||
  (decl.kind === "union" && decl.variants.length === 0)
    ? [`osprey: unsupported declaration '${decl.name}'`]
    : []),
  ...[decl.name, ...decl.generics, ...memberNames(decl)]
    .filter((name) => RESERVED.has(name))
    .map((name) => `osprey: reserved identifier '${name}'`),
];

const referenceErrors = (decl: ResolvedDecl) => {
  const messages: string[] = [];
  walkDeclRefs(decl, (type) => {
    const arity = type.name === "Result" ? 2 : type.name === "List" || type.name === "Option" ? 1 : 0;
    const builtin = type.resolution.kind === "external" || type.resolution.kind === "primitive";
    messages.push(
      ...(builtin && (PRIMITIVES[type.name] === undefined || type.args.length !== arity)
        ? [`osprey: unsupported type '${type.name}'`]
        : [])
    );
  });
  return messages;
};

const constructorErrors = (decls: readonly ResolvedDecl[]) => {
  const seen = new Set([...Object.keys(PRIMITIVES), ...decls.map((decl) => decl.name)]);
  return decls
    .flatMap((decl) => (decl.kind === "union" ? decl.variants : []))
    .flatMap((variant) => {
      const errors = seen.has(variant.name) ? [`osprey: constructor collision '${variant.name}'`] : [];
      seen.add(variant.name);
      return errors;
    });
};

const unsupported = (model: Model): Diagnostic[] => {
  const decls = visibleDeclsForTarget(model.decls, "osprey");
  const messages = new Set([
    ...constructorErrors(decls),
    ...decls.flatMap(declarationErrors),
    ...decls.flatMap(referenceErrors),
  ]);
  return [...messages].map((message) => ({ severity: "error", message, line: 0, col: 0, length: 0 }));
};

const EMITTERS: DeclEmitters = {
  record: (decl) => [header(decl), ...decl.fields.map((field) => `    ${field.name} : ${typeName(field.type)}`)],
  union: (decl) => [
    header(decl),
    ...decl.variants.flatMap((variant) => [
      `    ${variant.name}`,
      ...variant.fields.map((field) => `        ${field.name} : ${typeName(field.type)}`),
    ]),
  ],
  alias: (decl) => [`${header(decl)} ${typeName(decl.target)}`],
};

/** Emit Osprey ML model declarations, refusing types without a defined mapping. */
export const generateOspreyModule = (model: Model): Result<string, Diagnostic[]> => {
  const diagnostics = unsupported(model);
  return diagnostics.length > 0
    ? err(diagnostics)
    : ok(
        emitDecls(model, "osprey", EMITTERS, {
          prelude: ["// Generated from typeDiagram [CONV-OSPREY]."],
          trimTrailing: true,
        })
      );
};
