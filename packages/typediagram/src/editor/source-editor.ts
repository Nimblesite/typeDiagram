// [EDITOR-SOURCE] Model-backed source mutations used by every visual-editor host.
import { parse, formatDiagnostics } from "../parser/index.js";
import type { TypeRef } from "../parser/ast.js";
import { buildModel } from "../model/build.js";
import { printSource } from "../model/print.js";
import { walkDeclRefs, type Model, type ResolvedDecl, type ResolvedTypeRef } from "../model/types.js";
import { err, ok } from "../result.js";
import { runWhen, runWhenDefined } from "./effects.js";

export type EditorFailure = { message: string };
export type RowPatch = { name?: string; type?: string };
export type DeclarationKind = Exclude<ResolvedDecl["kind"], "function">;

const editorModel = (source: string) => {
  const parsed = parse(source);
  const built = parsed.ok ? buildModel(parsed.value) : undefined;
  return !parsed.ok
    ? err<EditorFailure>({ message: formatDiagnostics([...parsed.error]) })
    : built?.ok === true
      ? ok(built.value)
      : err<EditorFailure>({ message: formatDiagnostics([...(built?.error ?? [])]) });
};

const modelOrFailure = (source: string) => {
  const built = editorModel(source);
  return built.ok ? ok(built.value) : err<EditorFailure>({ message: built.error.message });
};

const findDecl = (model: Model, name: string) => model.decls.find((decl) => decl.name === name);

const missingDecl = (name: string) => err<EditorFailure>({ message: `Unknown declaration '${name}'` });

const sourceResult = (model: Model, decl: ResolvedDecl | undefined, name: string) => {
  const source = printSource(model);
  const validated = modelOrFailure(source);
  return decl === undefined ? missingDecl(name) : validated.ok ? ok(source) : validated;
};

const unresolvedRef = (ref: TypeRef): ResolvedTypeRef => ({
  name: ref.name,
  args: ref.args.map(unresolvedRef),
  resolution: { kind: "external" },
});

const parseTypeRef = (source: string) => {
  const parsed = parse(`typeDiagram\ntype __EditorProbe { value: ${source} }`);
  const decl = parsed.ok ? parsed.value.decls[0] : undefined;
  const field = decl?.kind === "record" ? decl.fields[0] : undefined;
  return field === undefined
    ? err<EditorFailure>({
        message: parsed.ok ? `Invalid type '${source}'` : formatDiagnostics([...parsed.error]),
      })
    : ok(unresolvedRef(field.type));
};

const renameRef = (ref: ResolvedTypeRef, before: string, after: string) => {
  ref.name = ref.name === before ? after : ref.name;
  ref.args.forEach((arg) => {
    renameRef(arg, before, after);
  });
  ref.resolution =
    ref.resolution.kind === "declared" && ref.resolution.declName === before
      ? { kind: "declared", declName: after }
      : ref.resolution;
};

const visitRefs = (decl: ResolvedDecl, visit: (ref: ResolvedTypeRef) => void) => {
  walkDeclRefs(decl, visit);
};

const uniqueName = (names: readonly string[], base: string) =>
  Array.from({ length: names.length + 1 }, (_, index) => (index === 0 ? base : `${base}${String(index + 1)}`)).find(
    (name) => !names.includes(name)
  ) ?? base;

const stringRef = (): ResolvedTypeRef => ({
  name: "String",
  args: [],
  resolution: { kind: "primitive" },
});

const newDeclaration = (model: Model, kind: DeclarationKind): ResolvedDecl => {
  const names = model.decls.map((decl) => decl.name);
  switch (kind) {
    case "record":
      return {
        kind,
        name: uniqueName(names, "NewRecord"),
        generics: [],
        fields: [{ name: "field", type: stringRef() }],
      };
    case "union":
      return {
        kind,
        name: uniqueName(names, "NewUnion"),
        generics: [],
        variants: [{ name: "Variant", fields: [] }],
      };
    case "alias":
      return {
        kind,
        name: uniqueName(names, "NewAlias"),
        generics: [],
        target: stringRef(),
      };
  }
};

export const addDeclaration = (source: string, kind: DeclarationKind) => {
  const result = modelOrFailure(source);
  const model = result.ok ? result.value : undefined;
  runWhenDefined(model, (current) => {
    current.decls.push(newDeclaration(current, kind));
  });
  return result.ok ? ok(printSource(result.value)) : result;
};

export const removeDeclaration = (source: string, name: string) => {
  const result = modelOrFailure(source);
  const model = result.ok ? result.value : undefined;
  const index = model?.decls.findIndex((decl) => decl.name === name) ?? -1;
  runWhenDefined(model !== undefined && index >= 0 ? model : undefined, (current) => {
    current.decls.splice(index, 1);
  });
  return !result.ok ? result : index < 0 ? missingDecl(name) : ok(printSource(result.value));
};

export const renameDeclaration = (source: string, before: string, after: string) => {
  const result = modelOrFailure(source);
  const decl = result.ok ? findDecl(result.value, before) : undefined;
  const valid = after.trim().length > 0;
  return !result.ok
    ? result
    : decl === undefined || !valid
      ? missingDecl(before)
      : renameInModel(result.value, decl, before, after.trim());
};

const renameInModel = (model: Model, decl: ResolvedDecl, before: string, after: string) => {
  decl.name = after;
  model.decls.forEach((candidate) => {
    visitRefs(candidate, (ref) => {
      renameRef(ref, before, after);
    });
  });
  return ok(printSource(model));
};

const replaceRowType = (decl: ResolvedDecl, rowIndex: number, type: ResolvedTypeRef) => {
  const row = decl.kind === "record" ? decl.fields[rowIndex] : undefined;
  const variant = decl.kind === "union" ? decl.variants[rowIndex] : undefined;
  runWhenDefined(row, (current) => {
    current.type = type;
  });
  runWhen(decl.kind === "alias", () => {
    switch (decl.kind) {
      case "alias":
        decl.target = type;
        break;
    }
  });
  runWhenDefined(variant, (current) => {
    replaceVariantType(current, type);
  });
};

const replaceVariantType = (
  variant: Extract<ResolvedDecl, { kind: "union" }>["variants"][number],
  type: ResolvedTypeRef
) => {
  switch (variant.fields.length) {
    case 0:
      variant.fields.push({ name: "_0", type });
      break;
    default:
      variant.fields[0] = { name: variant.fields[0]?.name ?? "_0", type };
  }
};

const renameRow = (decl: ResolvedDecl, rowIndex: number, name: string) => {
  const row = decl.kind === "record" ? decl.fields[rowIndex] : undefined;
  const variant = decl.kind === "union" ? decl.variants[rowIndex] : undefined;
  runWhenDefined(row, (current) => {
    current.name = name;
  });
  runWhenDefined(variant, (current) => {
    current.name = name;
  });
};

const applyRowPatch = (decl: ResolvedDecl, rowIndex: number, patch: RowPatch) => {
  runWhenDefined(patch.name, (name) => {
    renameRow(decl, rowIndex, name.trim());
  });
  return patch.type === undefined ? ok(undefined) : applyTypePatch(decl, rowIndex, patch.type);
};

const applyTypePatch = (decl: ResolvedDecl, rowIndex: number, typeSource: string) => {
  const parsed = parseTypeRef(typeSource.trim());
  switch (parsed.ok) {
    case true:
      replaceRowType(decl, rowIndex, parsed.value);
      break;
  }
  return parsed;
};

export const editRow = (source: string, declName: string, rowIndex: number, patch: RowPatch) => {
  const result = modelOrFailure(source);
  const decl = result.ok ? findDecl(result.value, declName) : undefined;
  const edited = decl === undefined ? missingDecl(declName) : applyRowPatch(decl, rowIndex, patch);
  return !result.ok ? result : !edited.ok ? edited : sourceResult(result.value, decl, declName);
};

const anyRef = (): ResolvedTypeRef => ({ name: "Any", args: [], resolution: { kind: "external" } });

const targetRef = (name: string, genericCount = 0): ResolvedTypeRef => ({
  name,
  args: Array.from({ length: genericCount }, anyRef),
  resolution: { kind: "declared", declName: name },
});

const fieldNameFor = (target: string) => `${target.slice(0, 1).toLowerCase()}${target.slice(1)}`;

const appendConnection = (decl: ResolvedDecl, target: string, genericCount: number) => {
  const type = targetRef(target, genericCount);
  switch (decl.kind) {
    case "record":
      decl.fields.push({ name: fieldNameFor(target), type });
      break;
    case "union":
      decl.variants.push({ name: target, fields: [{ name: "_0", type }] });
      break;
    case "alias":
      decl.target = type;
  }
};

export const connectDeclarations = (source: string, from: string, rowIndex: number, target: string) => {
  const result = modelOrFailure(source);
  const decl = result.ok ? findDecl(result.value, from) : undefined;
  const targetDecl = result.ok ? findDecl(result.value, target) : undefined;
  const exists = decl !== undefined && targetDecl !== undefined;
  const genericCount = targetDecl?.generics.length ?? 0;
  runWhenDefined(exists && rowIndex < 0 ? decl : undefined, (current) => {
    appendConnection(current, target, genericCount);
  });
  runWhenDefined(exists && rowIndex >= 0 ? decl : undefined, (current) => {
    replaceRowType(current, rowIndex, targetRef(target, genericCount));
  });
  return !result.ok ? result : exists ? ok(printSource(result.value)) : missingDecl(decl === undefined ? from : target);
};

const newRecordRow = (names: readonly string[]) => ({ name: uniqueName(names, "field"), type: stringRef() });

const newUnionVariant = (names: readonly string[]) => ({ name: uniqueName(names, "Variant"), fields: [] });

export const addRow = (source: string, declName: string) => {
  const result = modelOrFailure(source);
  const decl = result.ok ? findDecl(result.value, declName) : undefined;
  runWhenDefined(decl, (current) => {
    switch (current.kind) {
      case "record":
        current.fields.push(newRecordRow(current.fields.map((field) => field.name)));
        break;
      case "union":
        current.variants.push(newUnionVariant(current.variants.map((variant) => variant.name)));
    }
  });
  return !result.ok ? result : sourceResult(result.value, decl, declName);
};

export const removeRow = (source: string, declName: string, rowIndex: number) => {
  const result = modelOrFailure(source);
  const decl = result.ok ? findDecl(result.value, declName) : undefined;
  runWhenDefined(decl, (current) => {
    switch (current.kind) {
      case "record":
        current.fields.splice(rowIndex, 1);
        break;
      case "union":
        current.variants.splice(rowIndex, 1);
    }
  });
  return !result.ok ? result : sourceResult(result.value, decl, declName);
};
