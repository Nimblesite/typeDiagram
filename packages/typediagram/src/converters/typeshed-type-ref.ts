// [TYPESHED-TYPES] Python annotation AST -> unresolved typeDiagram TypeRef.
import { ref } from "../model/builder.js";
import type { ResolvedTypeRef } from "../model/types.js";
import {
  childrenOf,
  firstNamedChild,
  namedChildrenOf,
  safeTypeName,
  textOf,
  type PythonNode,
} from "./typeshed-tree.js";

const NAME_MAP: Readonly<Record<string, string>> = {
  bool: "Bool",
  int: "Int",
  float: "Float",
  complex: "Float",
  str: "String",
  bytes: "Bytes",
  bytearray: "Bytes",
  None: "Unit",
  list: "List",
  List: "List",
  dict: "Map",
  Dict: "Map",
  Mapping: "Map",
  Optional: "Option",
  Any: "Any",
  type: "Type",
};

const WRAPPERS = new Set(["Annotated", "ClassVar", "Final", "Required", "NotRequired", "ReadOnly"]);

export const pythonTypeRef = (node: PythonNode | undefined, source: string): ResolvedTypeRef =>
  node === undefined
    ? ref("Any")
    : node.name === "TypeDef"
      ? pythonTypeRef(firstNamedChild(node), source)
      : typeRefForNode(node, source);

const typeRefForNode = (node: PythonNode, source: string): ResolvedTypeRef => {
  switch (node.name) {
    case "VariableName":
    case "PropertyName":
      return nameRef(textOf(source, node));
    case "None":
      return ref("Unit");
    case "String":
      return forwardRef(textOf(source, node));
    case "Number":
      return ref("Int");
    case "Boolean":
      return ref("Bool");
    case "MemberExpression":
      return memberRef(node, source);
    case "BinaryExpression":
      return unionRef(node, source);
    case "TupleExpression":
    case "ListExpression":
      return ref(
        "List",
        namedChildrenOf(node).map((child) => pythonTypeRef(child, source))
      );
    case "ArrayExpression":
      return ref(
        "Args",
        namedChildrenOf(node).map((child) => pythonTypeRef(child, source))
      );
    case "Ellipsis":
      return ref("Any");
    case "UnaryExpression":
      return ref("Int");
    case "CallExpression":
      return callRef(node, source);
    default:
      return fallbackRef(node, source);
  }
};

const nameRef = (name: string) => {
  const last = lastSegment(name);
  const mapped = Object.hasOwn(NAME_MAP, last) ? NAME_MAP[last] : undefined;
  return ref(mapped ?? safeTypeName(isIdentifier(last) ? last : "Any"));
};

const lastSegment = (name: string) => name.split(".").at(-1) ?? name;

const isIdentifier = (name: string) => {
  const first = name.charAt(0);
  const starts = isLetter(first) || first === "_";
  return (
    starts && Array.from(name.slice(1)).every((char) => isLetter(char) || char === "_" || (char >= "0" && char <= "9"))
  );
};

const isLetter = (char: string) => (char >= "A" && char <= "Z") || (char >= "a" && char <= "z");

const forwardRef = (quoted: string) => {
  const first = quoted.charAt(0);
  const unquoted = first === "'" || first === '"' ? quoted.slice(1, -1) : quoted;
  return nameRef(unquoted);
};

const memberRef = (node: PythonNode, source: string) => {
  const children = childrenOf(node);
  const bracket = children.findIndex((child) => child.name === "[");
  return bracket < 0 ? nameRef(textOf(source, node)) : genericRef(children, bracket, source);
};

const genericRef = (children: PythonNode[], bracket: number, source: string) => {
  const base = pythonTypeRef(children[0], source).name;
  const args = children
    .slice(bracket + 1)
    .filter(isTypeChild)
    .map((child) => pythonTypeRef(child, source));
  return normalizeGeneric(base, args);
};

const isTypeChild = (node: PythonNode) =>
  !node.type.isAnonymous && !["Comment", "[", "]", ",", "(", ")"].includes(node.name);

const normalizeGeneric = (base: string, args: ResolvedTypeRef[]) =>
  WRAPPERS.has(base) && args[0] !== undefined
    ? args[0]
    : base === "Literal"
      ? (args[0] ?? ref("Any"))
      : base === "Union"
        ? unionFromRefs(args)
        : ref(Object.hasOwn(NAME_MAP, base) ? (NAME_MAP[base] ?? base) : safeTypeName(base), args);

const unionRef = (node: PythonNode, source: string) =>
  unionFromRefs(
    namedChildrenOf(node)
      .filter((child) => child.name !== "BitOp")
      .map((child) => pythonTypeRef(child, source))
  );

const unionFromRefs = (refs: ResolvedTypeRef[]) => {
  const values = refs.flatMap((item) => (item.name === "Union" ? item.args : [item]));
  const nonUnit = values.filter((item) => item.name !== "Unit");
  const value = nonUnit.length === 1 ? nonUnit[0] : ref("Union", nonUnit);
  return nonUnit.length < values.length && value !== undefined ? ref("Option", [value]) : (value ?? ref("Any"));
};

const callRef = (node: PythonNode, source: string) => {
  const named = namedChildrenOf(node);
  const callee = pythonTypeRef(named[0], source).name;
  const args = named.slice(1).flatMap((child) => namedChildrenOf(child));
  const typeArg = callee === "NewType" ? args[1] : callee === "TypeAliasType" ? args[1] : undefined;
  return typeArg === undefined ? ref("Any") : pythonTypeRef(typeArg, source);
};

const fallbackRef = (node: PythonNode, source: string) => {
  const child = firstNamedChild(node);
  return child === undefined ? nameRef(textOf(source, node)) : pythonTypeRef(child, source);
};

export const isClassVar = (node: PythonNode | undefined, source: string): boolean => {
  if (node === undefined) {
    return false;
  }
  if (node.name === "TypeDef") {
    return isClassVar(firstNamedChild(node), source);
  }
  const first = node.name === "MemberExpression" ? childrenOf(node)[0] : node;
  return first !== undefined && pythonTypeRef(first, source).name === "ClassVar";
};
