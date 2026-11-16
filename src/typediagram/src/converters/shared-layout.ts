// [CONV-SHARED-LAYOUT] Exact shared-memory layout, never a tdbin wire layout.
import type { Model, ResolvedDecl, ResolvedField, ResolvedTypeRef } from "../model/types.js";
import type { Diagnostic } from "../parser/diagnostics.js";
import { err, ok, type Result } from "../result.js";
import { printTypeRef } from "./parse-typeref.js";

const WORD = 8;
const REFERENCE_BYTES = 40;
const INLINE_LIMIT = 64;
const RECORD_LIMIT = 65536;
const SCALARS: Readonly<Record<string, number>> = { Int: WORD, Float: WORD, Bool: WORD, Uuid: 16, Unit: 0 };
interface Shape {
  readonly type: string;
  readonly storage: string;
  readonly bytes: number;
  readonly inline: boolean;
  readonly value?: Shape;
}
interface Field extends Shape {
  readonly name: string;
  readonly offset: number;
}
interface Variant {
  readonly name: string;
  readonly tag: number;
  readonly fields: readonly Field[];
}
interface Declaration {
  readonly name: string;
  readonly kind: string;
  readonly bytes: number;
  readonly inline: boolean;
  readonly fields?: readonly Field[];
  readonly variants?: readonly Variant[];
  readonly target?: Shape;
}
interface Context {
  readonly decls: ReadonlyMap<string, ResolvedDecl>;
  readonly layouts: Map<string, Declaration>;
}
const failure = (message: string) =>
  err<Diagnostic[]>([{ severity: "error", message: `shared-layout: ${message}`, line: 0, col: 0, length: 0 }]);
const reference = (type: string): Shape => ({ type, storage: "reference", bytes: REFERENCE_BYTES, inline: false });

const fieldsLayout = (
  ctx: Context,
  fields: readonly ResolvedField[],
  path: readonly string[],
  start = 0
): Result<Field[], Diagnostic[]> => {
  const result: Field[] = [];
  let offset = start;
  for (const field of fields) {
    const shape = shapeOf(ctx, field.type, path);
    if (!shape.ok) {
      return shape;
    }
    result.push({ name: field.name, offset, ...shape.value });
    offset += shape.value.bytes;
    if (offset > RECORD_LIMIT) {
      return failure("record exceeds 64 KiB");
    }
  }
  return ok(result);
};
const endOf = (fields: readonly Field[], start = 0) =>
  fields.reduce((end, field) => Math.max(end, field.offset + field.bytes), start);

const recordLayout = (
  ctx: Context,
  decl: Extract<ResolvedDecl, { kind: "record" }>,
  path: readonly string[]
): Result<Declaration, Diagnostic[]> => {
  const fields = fieldsLayout(ctx, decl.fields, path);
  if (!fields.ok) {
    return fields;
  }
  const bytes = Math.max(WORD, endOf(fields.value));
  return ok({
    name: decl.name,
    kind: "record",
    bytes,
    inline: bytes <= INLINE_LIMIT && fields.value.every((field) => field.inline),
    fields: fields.value,
  });
};

const unionLayout = (
  ctx: Context,
  decl: Extract<ResolvedDecl, { kind: "union" }>,
  path: readonly string[]
): Result<Declaration, Diagnostic[]> => {
  const variants: Variant[] = [];
  let bytes = WORD;
  for (const variant of decl.variants) {
    const fields = fieldsLayout(ctx, variant.fields, path, WORD);
    if (!fields.ok) {
      return fields;
    }
    variants.push({ name: variant.name, tag: variants.length, fields: fields.value });
    bytes = Math.max(bytes, endOf(fields.value, WORD));
  }
  return variants.length === 0
    ? failure(`empty union '${decl.name}'`)
    : ok({
        name: decl.name,
        kind: "union",
        bytes,
        inline: bytes <= INLINE_LIMIT && variants.every((variant) => variant.fields.every((field) => field.inline)),
        variants,
      });
};

const declarationLayout = (
  ctx: Context,
  decl: ResolvedDecl,
  path: readonly string[]
): Result<Declaration, Diagnostic[]> => {
  const cached = ctx.layouts.get(decl.name);
  if (cached !== undefined) {
    return ok(cached);
  }
  if (decl.generics.length > 0 || decl.kind === "function") {
    return failure(`unsupported declaration '${decl.name}'`);
  }
  const next = [...path, decl.name];
  const layout =
    decl.kind === "record"
      ? recordLayout(ctx, decl, next)
      : decl.kind === "union"
        ? unionLayout(ctx, decl, next)
        : aliasLayout(ctx, decl, next);
  if (layout.ok) {
    ctx.layouts.set(decl.name, layout.value);
  }
  return layout;
};
const aliasLayout = (
  ctx: Context,
  decl: Extract<ResolvedDecl, { kind: "alias" }>,
  path: readonly string[]
): Result<Declaration, Diagnostic[]> => {
  const target = shapeOf(ctx, decl.target, path);
  return target.ok
    ? ok({
        name: decl.name,
        kind: "alias",
        bytes: target.value.bytes,
        inline: target.value.inline,
        target: target.value,
      })
    : target;
};

const declaredShape = (ctx: Context, type: ResolvedTypeRef, path: readonly string[]): Result<Shape, Diagnostic[]> => {
  const decl = ctx.decls.get(type.name);
  if (decl === undefined || type.args.length > 0) {
    return failure(`unknown or generic type '${type.name}'`);
  }
  if (path.includes(decl.name)) {
    // Aliases stay transparent through record cycles; alias-only cycles hit the traversal bound.
    const target = decl.kind === "alias" ? shapeOf(ctx, decl.target, [...path, decl.name]) : ok(reference(type.name));
    return target.ok ? ok({ ...target.value, type: type.name }) : target;
  }
  const layout = declarationLayout(ctx, decl, path);
  if (!layout.ok) {
    return layout;
  }
  if (layout.value.target !== undefined) {
    return ok({ ...layout.value.target, type: type.name });
  }
  return ok(
    layout.value.inline
      ? { type: type.name, storage: "inline", bytes: layout.value.bytes, inline: true }
      : reference(type.name)
  );
};

const shapeOf = (ctx: Context, type: ResolvedTypeRef, path: readonly string[]): Result<Shape, Diagnostic[]> => {
  if (path.length > 64) {
    return failure("type traversal exceeds 64 levels");
  }
  if (type.resolution.kind === "declared") {
    return declaredShape(ctx, type, path);
  }
  const bytes = SCALARS[type.name];
  if (bytes !== undefined && type.args.length === 0) {
    return ok({ type: type.name, storage: "scalar", bytes, inline: true });
  }
  if ((type.name === "String" || type.name === "Bytes") && type.args.length === 0) {
    return ok({ type: type.name, storage: "bytes", bytes: REFERENCE_BYTES + WORD, inline: false });
  }
  const inner = type.args[0];
  return inner !== undefined && type.args.length === 1 && (type.name === "Option" || type.name === "List")
    ? containerShape(ctx, type, inner, path)
    : failure(`unsupported type '${printTypeRef(type)}'`);
};
const containerShape = (
  ctx: Context,
  type: ResolvedTypeRef,
  inner: ResolvedTypeRef,
  path: readonly string[]
): Result<Shape, Diagnostic[]> => {
  const value = shapeOf(ctx, inner, [...path, type.name]);
  if (!value.ok) {
    return value;
  }
  return ok({
    type: printTypeRef(type),
    storage: type.name === "List" ? "list" : "optional",
    bytes: type.name === "List" ? REFERENCE_BYTES + WORD : WORD + value.value.bytes,
    inline: type.name === "Option" && value.value.inline,
    value: value.value,
  });
};

/** Build the exact manifest and SHA-256 identity for a shared-memory profile. */
export const generateSharedLayout = async (model: Model, pointerBytes: number) => {
  if (pointerBytes !== 4 && pointerBytes !== 8) {
    return failure("unsupported pointer profile");
  }
  const ctx: Context = { decls: new Map(model.decls.map((decl) => [decl.name, decl])), layouts: new Map() };
  for (const decl of [...model.decls].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const layout = declarationLayout(ctx, decl, []);
    if (!layout.ok) {
      return layout;
    }
  }
  const manifest = {
    abiMajor: 1,
    endian: "little",
    alignment: WORD,
    pointerBytes,
    referenceBytes: REFERENCE_BYTES,
    inlineLimit: INLINE_LIMIT,
    declarations: [...ctx.layouts.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
  } as const;
  return fingerprint(manifest);
};
const fingerprint = async <T extends { declarations: Declaration[]; pointerBytes: 4 | 8 }>(manifest: T) => {
  try {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(manifest)));
    const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    return ok({ ...manifest, fingerprint: hash });
  } catch {
    return failure("SHA-256 unavailable");
  }
};
