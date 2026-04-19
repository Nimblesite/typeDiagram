// [CONV-PHP] PHP DTO <-> typeDiagram bidirectional converter.
import type { Diagnostic } from "../parser/diagnostics.js";
import { type Result, err } from "../result.js";
import type { Model, ResolvedTypeRef } from "../model/types.js";
import { ModelBuilder, alias, record, union } from "../model/builder.js";
import type { Converter } from "./types.js";
import { parseTypeRef } from "./parse-typeref.js";

const TD_TO_PHP_NATIVE: Record<string, string> = {
  Bool: "bool",
  Int: "int",
  Float: "float",
  String: "string",
  Bytes: "string",
  Unit: "null",
};

const TD_TO_PHP_DOC: Record<string, string> = {
  Bool: "bool",
  Int: "int",
  Float: "float",
  String: "string",
  Bytes: "string",
  Unit: "null",
};

const PHP_TO_TD: Record<string, string> = {
  bool: "Bool",
  int: "Int",
  float: "Float",
  string: "String",
  null: "Unit",
  void: "Unit",
};

const NO_SUPPORTED_DEFINITIONS: Diagnostic[] = [
  {
    severity: "error",
    message: "No supported PHP DTO definitions found",
    line: 0,
    col: 0,
    length: 0,
  },
];

interface PhpTypeSpec {
  nativeType: string;
  docType: string | null;
}

interface RenderedParam extends PhpTypeSpec {
  name: string;
}

type ParsedParam = RenderedParam;

interface ParsedInterface {
  declType: "interface";
  name: string;
  docblock: string | null;
  body: string;
}

interface ParsedClass {
  declType: "class";
  name: string;
  docblock: string | null;
  body: string;
  implementsName: string | null;
}

type ParsedDecl = ParsedInterface | ParsedClass;

const isOptionType = (type: ResolvedTypeRef) => type.name === "Option" && type.args[0] !== undefined;

const unwrapOptionType = (type: ResolvedTypeRef) => type.args[0] ?? type;

const usesGenericType = (type: ResolvedTypeRef, generics: ReadonlySet<string>): boolean =>
  generics.has(type.name) || type.args.some((arg) => usesGenericType(arg, generics));

const adjustDepth = (depth: number, char: string, openChar: string, closeChar: string) => {
  if (char === openChar) {
    return depth + 1;
  }
  if (char === closeChar) {
    return depth - 1;
  }
  return depth;
};

interface PhpScanState {
  depth: number;
  quote: '"' | "'" | null;
  escaping: boolean;
  lineComment: boolean;
  blockComment: boolean;
}

const DEFAULT_SCAN_STATE: PhpScanState = {
  depth: 0,
  quote: null,
  escaping: false,
  lineComment: false,
  blockComment: false,
};

const advancePhpScanState = (
  source: string,
  index: number,
  state: PhpScanState,
  openChar: string,
  closeChar: string
): PhpScanState => {
  const char = source.charAt(index);
  const nextChar = source.charAt(index + 1);
  if (state.lineComment) {
    return char === "\n" ? { ...state, lineComment: false } : state;
  }
  if (state.blockComment) {
    return char === "*" && nextChar === "/" ? { ...state, blockComment: false } : state;
  }
  if (state.quote !== null) {
    if (state.escaping) {
      return { ...state, escaping: false };
    }
    if (char === "\\") {
      return { ...state, escaping: true };
    }
    return char === state.quote ? { ...state, quote: null } : state;
  }
  if (char === "/" && nextChar === "/") {
    return { ...state, lineComment: true };
  }
  if (char === "/" && nextChar === "*") {
    return { ...state, blockComment: true };
  }
  if (char === '"' || char === "'") {
    return { ...state, quote: char, escaping: false };
  }
  return { ...state, depth: adjustDepth(state.depth, char, openChar, closeChar) };
};

const splitTopLevel = (source: string, openChar: string, closeChar: string): string[] => {
  const parts: string[] = [];
  let state = DEFAULT_SCAN_STATE;
  let start = 0;
  for (let i = 0; i < source.length; i++) {
    state = advancePhpScanState(source, i, state, openChar, closeChar);
    if (
      source.charAt(i) === "," &&
      state.depth === 0 &&
      state.quote === null &&
      !state.lineComment &&
      !state.blockComment
    ) {
      const part = source.slice(start, i).trim();
      if (part.length > 0) {
        parts.push(part);
      }
      start = i + 1;
    }
  }
  const last = source.slice(start).trim();
  return last.length > 0 ? [...parts, last] : parts;
};

const splitGenericArgs = (source: string) => splitTopLevel(source, "<", ">");

const splitParams = (source: string) => splitTopLevel(source, "(", ")");

const mapTdToPhpDocType = (type: ResolvedTypeRef): string => {
  if (type.name === "List" && type.args[0] !== undefined) {
    return `list<${mapTdToPhpDocType(type.args[0])}>`;
  }
  if (type.name === "Map" && type.args[0] !== undefined && type.args[1] !== undefined) {
    return `array<${mapTdToPhpDocType(type.args[0])}, ${mapTdToPhpDocType(type.args[1])}>`;
  }
  if (type.name === "Option" && type.args[0] !== undefined) {
    return `${mapTdToPhpDocType(type.args[0])}|null`;
  }
  return TD_TO_PHP_DOC[type.name] ?? type.name;
};

const getBasePhpTypeSpec = (type: ResolvedTypeRef, generics: ReadonlySet<string>): PhpTypeSpec => {
  if (generics.has(type.name)) {
    return { nativeType: "mixed", docType: type.name };
  }
  if (type.name === "List" || type.name === "Map") {
    return { nativeType: "array", docType: mapTdToPhpDocType(type) };
  }
  if (type.name === "Unit") {
    return { nativeType: "null", docType: null };
  }
  return { nativeType: TD_TO_PHP_NATIVE[type.name] ?? type.name, docType: null };
};

const getPhpTypeSpec = (type: ResolvedTypeRef, generics: ReadonlySet<string>): PhpTypeSpec => {
  if (!isOptionType(type)) {
    return getBasePhpTypeSpec(type, generics);
  }
  const inner = unwrapOptionType(type);
  if (generics.has(inner.name)) {
    return { nativeType: "mixed", docType: `${inner.name}|null` };
  }
  if (inner.name === "Unit") {
    return { nativeType: "null", docType: null };
  }
  const base = getBasePhpTypeSpec(inner, generics);
  if (base.nativeType === "array") {
    return { nativeType: "?array", docType: `${mapTdToPhpDocType(inner)}|null` };
  }
  if (base.nativeType === "mixed") {
    return { nativeType: "mixed", docType: `${mapTdToPhpDocType(inner)}|null` };
  }
  return {
    nativeType: `?${base.nativeType}`,
    docType: base.docType === null ? null : `${base.docType}|null`,
  };
};

const renderDocblock = (lines: readonly string[], indent = "") =>
  lines.length === 0 ? [] : [`${indent}/**`, ...lines.map((line) => `${indent} * ${line}`), `${indent} */`];

const renderConstructor = (params: readonly RenderedParam[], bodyLines: readonly string[]) => {
  const docLines = params
    .filter((param): param is RenderedParam & { docType: string } => param.docType !== null)
    .map((param) => `@param ${param.docType} $${param.name}`);
  const renderedDoc = renderDocblock(docLines, "    ");
  const renderedParams = params.map((param) => `        public ${param.nativeType} $${param.name},`);

  if (bodyLines.length === 0) {
    return [
      ...renderedDoc,
      ...(renderedParams.length === 0
        ? ["    public function __construct() {}"]
        : ["    public function __construct(", ...renderedParams, "    ) {}"]),
    ];
  }

  return [
    ...renderedDoc,
    ...(renderedParams.length === 0
      ? ["    public function __construct()"]
      : ["    public function __construct(", ...renderedParams, "    )"]),
    "    {",
    ...bodyLines.map((line) => `        ${line}`),
    "    }",
  ];
};

const renderRecord = (
  name: string,
  generics: readonly string[],
  fields: readonly { name: string; type: ResolvedTypeRef }[]
) => {
  const genericSet = new Set(generics);
  const params = fields.map((field) => ({ name: field.name, ...getPhpTypeSpec(field.type, genericSet) }));
  return [
    ...renderDocblock(generics.map((generic) => `@template ${generic}`)),
    `final readonly class ${name}`,
    "{",
    ...renderConstructor(params, []),
    "}",
  ].join("\n");
};

const renderUnion = (
  name: string,
  generics: readonly string[],
  variants: readonly { name: string; fields: readonly { name: string; type: ResolvedTypeRef }[] }[]
) => {
  const genericSet = new Set(generics);
  const blocks: string[] = [
    [...renderDocblock(generics.map((generic) => `@template ${generic}`)), `interface ${name}`, "{", "}"].join("\n"),
  ];

  for (const variant of variants) {
    const variantUsesGeneric = variant.fields.some((field) => usesGenericType(field.type, genericSet));
    const params = variant.fields.map((field) => ({
      name: field.name,
      ...getPhpTypeSpec(field.type, genericSet),
    }));
    const classDoc = variantUsesGeneric
      ? renderDocblock([
          ...generics.map((generic) => `@template ${generic}`),
          `@implements ${name}<${generics.join(", ")}>`,
        ])
      : [];
    blocks.push(
      [
        ...classDoc,
        `final readonly class ${variant.name} implements ${name}`,
        "{",
        `    /** @var '${variant.name}' */`,
        "    public string $kind;",
        "",
        ...renderConstructor(params, [`$this->kind = '${variant.name}';`]),
        "}",
      ].join("\n")
    );
  }

  return blocks;
};

const renderAlias = (name: string, generics: readonly string[], target: ResolvedTypeRef) => {
  const params = [{ name: "value", ...getPhpTypeSpec(target, new Set(generics)) }];
  return [
    ...renderDocblock([...generics.map((generic) => `@template ${generic}`), "@typediagram-kind alias"]),
    `final readonly class ${name}`,
    "{",
    ...renderConstructor(params, []),
    "}",
  ].join("\n");
};

const toPhp = (model: Model): string => {
  const blocks = model.decls.flatMap((decl) => {
    if (decl.kind === "record") {
      return [renderRecord(decl.name, decl.generics, decl.fields)];
    }
    if (decl.kind === "union") {
      return renderUnion(decl.name, decl.generics, decl.variants);
    }
    return [renderAlias(decl.name, decl.generics, decl.target)];
  });
  return [
    "<?php",
    "",
    "declare(strict_types=1);",
    "",
    ...blocks.flatMap((block, index) => (index === 0 ? [block] : ["", block])),
    "",
  ].join("\n");
};

const findMatchingDelimiter = (source: string, openIndex: number, openChar: string, closeChar: string) => {
  let state = DEFAULT_SCAN_STATE;
  for (let index = openIndex; index < source.length; index++) {
    state = advancePhpScanState(source, index, state, openChar, closeChar);
    if (state.depth === 0 && state.quote === null && !state.lineComment && !state.blockComment) {
      return index;
    }
  }
  return -1;
};

const extractDocblockBeforeOffset = (source: string, offset: number) => {
  const prefix = source.slice(0, offset).replace(/\s+$/, "");
  if (!prefix.endsWith("*/")) {
    return null;
  }
  const start = prefix.lastIndexOf("/**");
  return start === -1 ? null : prefix.slice(start);
};

const parseTemplatesFromDocblock = (docblock: string | null) =>
  [...(docblock?.matchAll(/@template\s+([A-Za-z_][A-Za-z0-9_]*)/g) ?? [])].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]]
  );

const parseParamDocsFromDocblock = (docblock: string | null) =>
  new Map(
    [...(docblock?.matchAll(/@param\s+(.+?)\s+\$(\w+)/g) ?? [])].flatMap((match) =>
      match[1] === undefined || match[2] === undefined ? [] : [[match[2], match[1]] as const]
    )
  );

const parseDeclarations = (source: string): ParsedDecl[] => {
  const declarations: ParsedDecl[] = [];
  const declarationRe = /interface\s+(\w+)\s*\{|final readonly class\s+(\w+)(?:\s+implements\s+(\w+))?\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = declarationRe.exec(source)) !== null) {
    const [, interfaceName, className, implementsName] = match;
    const openIndex = source.indexOf("{", match.index);
    const closeIndex = findMatchingDelimiter(source, openIndex, "{", "}");
    if (closeIndex === -1) {
      continue;
    }
    const body = source.slice(openIndex + 1, closeIndex);
    const docblock = extractDocblockBeforeOffset(source, match.index);
    declarations.push(
      interfaceName !== undefined
        ? { declType: "interface", name: interfaceName, docblock, body }
        : { declType: "class", name: className ?? "", docblock, body, implementsName: implementsName ?? null }
    );
    declarationRe.lastIndex = closeIndex + 1;
  }
  return declarations;
};

const parseParams = (source: string, constructorDoc: string | null): ParsedParam[] => {
  const docTypes = parseParamDocsFromDocblock(constructorDoc);
  return splitParams(source)
    .map((part) => {
      const trimmed = part.trim();
      if (!trimmed.startsWith("public ")) {
        return null;
      }
      const afterPublic = trimmed.slice("public ".length).trimStart();
      const dollarIndex = afterPublic.indexOf("$");
      if (dollarIndex === -1) {
        return null;
      }
      const nativeType = afterPublic.slice(0, dollarIndex).trim();
      const name = /^(\w+)/.exec(afterPublic.slice(dollarIndex + 1))?.[1];
      return nativeType.length === 0 || name === undefined
        ? null
        : {
            name,
            nativeType,
            docType: docTypes.get(name) ?? null,
          };
    })
    .filter((param): param is ParsedParam => param !== null);
};

const parseConstructor = (body: string) => {
  const start = body.indexOf("public function __construct(");
  if (start === -1) {
    return { params: [] as ParsedParam[], body: "" };
  }
  const constructorDoc = extractDocblockBeforeOffset(body, start);
  const openParen = body.indexOf("(", start);
  const closeParen = findMatchingDelimiter(body, openParen, "(", ")");
  const openBrace = body.indexOf("{", closeParen);
  const closeBrace = findMatchingDelimiter(body, openBrace, "{", "}");
  return {
    params: parseParams(body.slice(openParen + 1, closeParen), constructorDoc),
    body: body.slice(openBrace + 1, closeBrace).trim(),
  };
};

const mapPhpNativeTypeToTd = (nativeType: string): string => {
  const trimmed = nativeType.trim();
  if (trimmed.startsWith("?")) {
    return `Option<${mapPhpNativeTypeToTd(trimmed.slice(1))}>`;
  }
  return PHP_TO_TD[trimmed] ?? trimmed;
};

const mapPhpDocTypeToTd = (docType: string): string => {
  const trimmed = docType.trim();
  if (trimmed.endsWith("|null")) {
    return `Option<${mapPhpDocTypeToTd(trimmed.slice(0, -5))}>`;
  }
  if (trimmed.startsWith("list<") && trimmed.endsWith(">")) {
    return `List<${mapPhpDocTypeToTd(trimmed.slice(5, -1))}>`;
  }
  if (trimmed.startsWith("array<") && trimmed.endsWith(">")) {
    const args = splitGenericArgs(trimmed.slice(6, -1));
    // splitGenericArgs (via splitTopLevel) only produces non-empty strings, so
    // index accesses are safe — the as-string casts replace unreachable undefined guards.
    return args.length === 1
      ? `List<${mapPhpDocTypeToTd(args[0] as string)}>`
      : args.length === 2
        ? `Map<${mapPhpDocTypeToTd(args[0] as string)}, ${mapPhpDocTypeToTd(args[1] as string)}>`
        : "Map<String, String>";
  }
  return PHP_TO_TD[trimmed] ?? trimmed;
};

const toTypeRef = (param: ParsedParam) =>
  parseTypeRef(param.docType === null ? mapPhpNativeTypeToTd(param.nativeType) : mapPhpDocTypeToTd(param.docType));

const parseKindLiteral = (body: string) => {
  const propertyIndex = body.indexOf("public string $kind;");
  const varIndex = body.indexOf("@var ");
  if (propertyIndex === -1 || varIndex === -1 || varIndex > propertyIndex) {
    return null;
  }
  const literalStart = varIndex + "@var ".length;
  const quote = body.charAt(literalStart);
  if (quote !== "'" && quote !== '"') {
    return null;
  }
  const close = body.indexOf(quote, literalStart + 1);
  return close === -1 ? null : body.slice(literalStart + 1, close);
};

const fromPhp = (source: string): Result<Model, Diagnostic[]> => {
  const declarations = parseDeclarations(source);
  const interfaces = new Map(
    declarations
      .filter((decl): decl is ParsedInterface => decl.declType === "interface")
      .map((decl) => [decl.name, decl] as const)
  );
  const variantMap = new Map<string, Array<{ name: string; fields: Array<{ name: string; type: ResolvedTypeRef }> }>>();
  const variantNames = new Set<string>();

  for (const declaration of declarations) {
    if (
      declaration.declType !== "class" ||
      declaration.implementsName === null ||
      !interfaces.has(declaration.implementsName)
    ) {
      continue;
    }
    const kindLiteral = parseKindLiteral(declaration.body);
    if (kindLiteral !== declaration.name) {
      continue;
    }
    const constructor = parseConstructor(declaration.body);
    variantNames.add(declaration.name);
    variantMap.set(declaration.implementsName, [
      ...(variantMap.get(declaration.implementsName) ?? []),
      {
        name: declaration.name,
        fields: constructor.params.map((param) => ({ name: param.name, type: toTypeRef(param) })),
      },
    ]);
  }

  const builder = new ModelBuilder();
  let found = false;

  for (const declaration of declarations) {
    if (declaration.declType === "interface") {
      const variants = variantMap.get(declaration.name);
      if (variants === undefined) {
        continue;
      }
      found = true;
      builder.add(union(declaration.name, variants, parseTemplatesFromDocblock(declaration.docblock)));
      continue;
    }

    if (variantNames.has(declaration.name)) {
      continue;
    }

    const constructor = parseConstructor(declaration.body);
    const generics = parseTemplatesFromDocblock(declaration.docblock);
    const isAlias = /@typediagram-kind\s+alias/.test(declaration.docblock ?? "");
    if (isAlias) {
      const valueParam = constructor.params[0];
      if (valueParam?.name !== "value") {
        continue;
      }
      found = true;
      builder.add(alias(declaration.name, toTypeRef(valueParam), generics));
      continue;
    }

    found = true;
    builder.add(
      record(
        declaration.name,
        constructor.params.map((param) => ({ name: param.name, type: toTypeRef(param) })),
        generics
      )
    );
  }

  return found ? builder.build() : err(NO_SUPPORTED_DEFINITIONS);
};

export const php: Converter = {
  language: "php",
  fromSource: fromPhp,
  toSource: toPhp,
};
