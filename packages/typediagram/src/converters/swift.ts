// [CONV-SWIFT] Logical models only: native shared-memory views have a separate ABI.
import { visibleDeclsForTarget, walkDeclRefs, type Model, type ResolvedTypeRef } from "../model/types.js";
import type { Diagnostic } from "../parser/diagnostics.js";
import { err, ok, type Result } from "../result.js";
import { emitDecls, type DeclEmitters } from "./emit-decls.js";

const PRIMITIVES: Readonly<Record<string, string>> = {
  Int: "Int64",
  Float: "Double",
  Bool: "Bool",
  String: "String",
  Unit: "Void",
  Uuid: "UUID",
};
const identifier = (name: string) => `\`${name}\``;
const typeName = (type: ResolvedTypeRef): string => {
  const builtin = type.resolution.kind === "primitive" || type.resolution.kind === "external";
  const inner = type.args[0];
  return builtin && inner !== undefined && type.name === "List"
    ? `[${typeName(inner)}]`
    : builtin && inner !== undefined && type.name === "Option"
      ? `${typeName(inner)}?`
      : builtin
        ? (PRIMITIVES[type.name] ?? identifier(type.name))
        : identifier(type.name);
};

const hasCycle = (model: Model, name: string, path = new Set<string>(), done = new Set<string>()): boolean => {
  if (path.has(name)) {
    return true;
  }
  if (done.has(name)) {
    return false;
  }
  path.add(name);
  const cyclic = model.edges
    .filter((edge) => edge.sourceDeclName === name)
    .some((edge) => hasCycle(model, edge.targetDeclName, path, done));
  path.delete(name);
  done.add(name);
  return cyclic;
};

const unsupported = (model: Model): Diagnostic[] => {
  const messages = new Set<string>();
  for (const decl of visibleDeclsForTarget(model.decls, "swift")) {
    if (decl.kind === "function" || decl.generics.length > 0 || hasCycle(model, decl.name)) {
      messages.add(`swift: unsupported declaration '${decl.name}'`);
    }
    walkDeclRefs(decl, (type) => {
      const builtin = type.resolution.kind === "primitive" || type.resolution.kind === "external";
      const container = type.name === "List" || type.name === "Option";
      if (
        builtin &&
        (container ? type.args.length !== 1 : PRIMITIVES[type.name] === undefined || type.args.length !== 0)
      ) {
        messages.add(`swift: unsupported type '${type.name}'`);
      }
    });
  }
  return [...messages].map((message) => ({ severity: "error", message, line: 0, col: 0, length: 0 }));
};

const EMITTERS: DeclEmitters = {
  record: (decl) => [
    `public struct ${identifier(decl.name)} {`,
    ...decl.fields.map((field) => `    public let ${identifier(field.name)}: ${typeName(field.type)}`),
    `    public init(${decl.fields.map((field) => `${identifier(field.name)}: ${typeName(field.type)}`).join(", ")}) {`,
    ...decl.fields.map((field) => `        self.${identifier(field.name)} = ${identifier(field.name)}`),
    "    }",
    "}",
  ],
  union: (decl) => [
    `public enum ${identifier(decl.name)} {`,
    ...decl.variants.map((variant) => {
      const fields = variant.fields.map((field) => `${identifier(field.name)}: ${typeName(field.type)}`).join(", ");
      return `    case ${identifier(variant.name)}${fields.length > 0 ? `(${fields})` : ""}`;
    }),
    "}",
  ],
  alias: (decl) => [`public typealias ${identifier(decl.name)} = ${typeName(decl.target)}`],
};

/** Generate monomorphic Swift model declarations; no binary layout is promised. */
export const generateSwiftModule = (model: Model): Result<string, Diagnostic[]> => {
  const diagnostics = unsupported(model);
  return diagnostics.length > 0
    ? err(diagnostics)
    : ok(
        emitDecls(model, "swift", EMITTERS, {
          prelude: ["// Generated from typeDiagram [CONV-SWIFT].", "import Foundation"],
          trimTrailing: true,
        })
      );
};
