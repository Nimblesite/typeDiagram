// [TYPESHED-AST] Browser-safe Python syntax-tree helpers; no source regex parsing.
import { parser as pythonParser } from "@lezer/python";

export type PythonNode = ReturnType<typeof pythonParser.parse>["topNode"];

export const parsePythonStub = (source: string) => pythonParser.parse(source);

const TYPE_DIAGRAM_KEYWORDS = new Set(["type", "union", "untagged", "alias", "function", "async", "typeDiagram"]);

export const isTypeDiagramKeyword = (name: string) => TYPE_DIAGRAM_KEYWORDS.has(name);

export const safeTypeName = (name: string) =>
  isTypeDiagramKeyword(name) ? `${name.charAt(0).toUpperCase()}${name.slice(1)}` : name;

export const childrenOf = (node: PythonNode) => {
  const children: PythonNode[] = [];
  for (let child = node.firstChild; child !== null; child = child.nextSibling) {
    children.push(child);
  }
  return children;
};

const SYNTAX_NODES = new Set([":", ",", ".", "(", ")", "[", "]", "{", "}"]);

export const namedChildrenOf = (node: PythonNode) =>
  childrenOf(node).filter((child) => !child.type.isAnonymous && !SYNTAX_NODES.has(child.name));

export const childOf = (node: PythonNode, name: string) => childrenOf(node).find((child) => child.name === name);

export const textOf = (source: string, node: PythonNode) => source.slice(node.from, node.to);

export const firstNamedChild = (node: PythonNode) => namedChildrenOf(node)[0];

export const descendantNames = (node: PythonNode, name: string) => {
  const found: PythonNode[] = [];
  walkNode(node, (candidate) => {
    found.push(...(candidate.name === name ? [candidate] : []));
  });
  return found;
};

export const walkNode = (node: PythonNode, visit: (node: PythonNode) => void) => {
  visit(node);
  childrenOf(node).forEach((child) => {
    walkNode(child, visit);
  });
};

export const firstErrorNode = (node: PythonNode) => {
  let error: PythonNode | undefined;
  walkNode(node, (candidate) => {
    error = error ?? (candidate.type.isError ? candidate : undefined);
  });
  return error;
};

export const definitionOf = (node: PythonNode) =>
  node.name === "DecoratedStatement"
    ? namedChildrenOf(node).find((child) => child.name === "ClassDefinition" || child.name === "FunctionDefinition")
    : node;

const moduleBodyNodes = (node: PythonNode): PythonNode[] =>
  node.name === "IfStatement"
    ? childrenOf(node)
        .filter((child) => child.name === "Body")
        .flatMap((body) => childrenOf(body).flatMap(moduleBodyNodes))
    : [node];

export const moduleNodes = (root: PythonNode) => childrenOf(root).flatMap(moduleBodyNodes);

const classBodyNodes = (node: PythonNode): PythonNode[] => {
  const body = childOf(node, "Body");
  return body === undefined ? [] : childrenOf(body).flatMap(moduleBodyNodes);
};

export const classMembers = (node: PythonNode) => classBodyNodes(node);
