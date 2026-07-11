// [CONV-RUST-TDBIN] Generate the TDBIN binary codec (`impl tdbin::Struct`) for
// typeDiagram records and unions. This is the serialization half of the
// "typeDiagram ADT <-> binary" code generator: rust.ts emits the ADT types,
// this emits their codec. The reflective schema model is NOT involved — the
// layout is baked into the generated impl at generation time ([TDBIN-REC-ALLOC],
// [TDBIN-UNION-DISC]), including its compatibility-major LAYOUT_HASH
// ([TDBIN-SCHEMA-HASH]). Layout major 2 additionally emits column groups for
// every columnar-reachable record/union ([TDBIN-COL-POLICY]). Classification
// lives in rust-tdbin-plan.ts, row-wise emission in rust-tdbin-fields.ts,
// columnar emission in rust-tdbin-columnar.ts / rust-tdbin-columns.ts, and
// the layout manifest/hash in rust-tdbin-hash.ts.
import type { Diagnostic } from "../parser/diagnostics.js";
import { type Model, type ResolvedDecl, visibleDeclsForTarget } from "../model/types.js";
import { emitRustDecl } from "./rust.js";
import { err, ok, type Result } from "../result.js";
import { classifyRecord, classifyUnion, diag, type Layout } from "./rust-tdbin-plan.js";
import { emitRecordCodec, emitUnionCodec, emitUnionDefault } from "./rust-tdbin-fields.js";
import { columnarReachable, emitColumnGroup } from "./rust-tdbin-columnar.js";
import { fnv1a64, layoutHashLiteral, layoutManifest } from "./rust-tdbin-hash.js";

/** Codec generation options. */
export interface RustCodecOptions {
  /** Layout major: 1 = row-wise lists (default), 2 = columnar lists ([TDBIN-COL-POLICY]). */
  layout?: Layout;
  /** Append-compatible republishing ([TDBIN-EVOLVE-APPEND]): when set, every
   *  emitted `LAYOUT_HASH` is FNV-1a 64 of THIS frozen manifest text instead of
   *  each type's freshly derived manifest, so a republished schema keeps its
   *  original compatibility-major identity ([TDBIN-SCHEMA-HASH]). */
  frozenManifest?: string;
}

interface EmitCtx {
  decls: readonly ResolvedDecl[];
  layout: Layout;
  columnar: ReadonlySet<string>;
  frozenManifest: string | undefined;
}

/** The `LAYOUT_HASH` literal for `d`: FNV-1a 64 of its canonical manifest, or
 *  of the frozen manifest when republishing ([TDBIN-SCHEMA-HASH]). */
const hashLiteralFor = (ctx: EmitCtx, d: ResolvedDecl): Result<string, Diagnostic[]> => {
  const manifest = ctx.frozenManifest === undefined ? layoutManifest(ctx.decls, d, ctx.layout) : ok(ctx.frozenManifest);
  if (!manifest.ok) {
    return manifest;
  }
  const hash = fnv1a64(manifest.value);
  return hash === 0n
    ? err(diag(`tdbin: layout manifest for '${d.name}' hashes to the reserved unpinned value 0`))
    : ok(layoutHashLiteral(hash));
};

const appendGroup = (
  ctx: EmitCtx,
  d: Extract<ResolvedDecl, { kind: "record" | "union" }>,
  blocks: string[]
): Result<string[], Diagnostic[]> => {
  if (!ctx.columnar.has(d.name)) {
    return ok(blocks);
  }
  const group = emitColumnGroup(ctx.decls, d);
  return group.ok ? ok([...blocks, group.value]) : group;
};

const recordBlocks = (ctx: EmitCtx, d: Extract<ResolvedDecl, { kind: "record" }>): Result<string[], Diagnostic[]> => {
  const plan = classifyRecord(ctx.decls, d, ctx.layout);
  if (!plan.ok) {
    return plan;
  }
  const hash = hashLiteralFor(ctx, d);
  return hash.ok ? appendGroup(ctx, d, [emitRecordCodec(d, plan.value, hash.value)]) : hash;
};

const unionBlocks = (ctx: EmitCtx, d: Extract<ResolvedDecl, { kind: "union" }>): Result<string[], Diagnostic[]> => {
  const plan = classifyUnion(d);
  if (!plan.ok) {
    return plan;
  }
  const dflt = emitUnionDefault(d, plan.value);
  if (!dflt.ok) {
    return dflt;
  }
  const hash = hashLiteralFor(ctx, d);
  return hash.ok ? appendGroup(ctx, d, [dflt.value, emitUnionCodec(d, plan.value, hash.value)]) : hash;
};

const declBlocks = (ctx: EmitCtx, d: ResolvedDecl): Result<string[], Diagnostic[]> => {
  if (d.generics.length > 0) {
    // [TDBIN-SCHEMA-MONO] generics never reach the wire; [TDBIN-SCHEMA-ALIAS]
    // aliases are transparent and emit no codec of their own.
    return err(diag(`tdbin: generic decl '${d.name}' must be monomorphized before codec generation`));
  }
  return d.kind === "record" ? recordBlocks(ctx, d) : d.kind === "union" ? unionBlocks(ctx, d) : ok([]);
};

/** Emit the TDBIN codec (`impl tdbin::Struct` with its pinned LAYOUT_HASH,
 *  union `impl Default`, and at layout 2 `impl tdbin::ColumnGroup`) for every
 *  record and union in the model. Aliases need no codec; generics must be
 *  monomorphized first. */
export const emitRustCodec = (model: Model, options?: RustCodecOptions): Result<string, Diagnostic[]> => {
  const layout: Layout = options?.layout ?? 1;
  const visible = visibleDeclsForTarget(model.decls, "rust");
  const ctx: EmitCtx = {
    decls: model.decls,
    layout,
    columnar: layout === 2 ? columnarReachable(model.decls, visible) : new Set<string>(),
    frozenManifest: options?.frozenManifest,
  };
  const blocks: string[] = [];
  for (const d of visible) {
    const emitted = declBlocks(ctx, d);
    if (!emitted.ok) {
      return emitted;
    }
    blocks.push(...emitted.value);
  }
  return ok(blocks.join("\n\n"));
};

/** Records derive `Default` so required pointer fields can decode null as the
 *  schema default ([TDBIN-PTR-NULL]); unions get a generated `impl Default`. */
const deriveFor = (d: ResolvedDecl): string =>
  d.kind === "record"
    ? "#[derive(Debug, Clone, PartialEq, Default)]\n"
    : d.kind === "union"
      ? "#[derive(Debug, Clone, PartialEq)]\n"
      : "";

/** Emit one ADT type with its doc comment first, then the derive, then the body
 *  (from the shared Rust converter) — the order rustc/clippy expect. */
const emitTypeWithDocs = (d: ResolvedDecl): string => {
  const [doc, ...rest] = emitRustDecl(d, true);
  return `${doc ?? ""}\n${deriveFor(d)}${rest.join("\n")}`;
};

/** Emit a self-contained Rust module: derived ADT types (from the existing
 *  Rust converter) plus their TDBIN codec — deny-all-clean (doc comments,
 *  derives). Everything the crate needs to round-trip a typeDiagram model,
 *  generated end to end. */
export const generateRustModule = (model: Model, options?: RustCodecOptions): Result<string, Diagnostic[]> => {
  const codec = emitRustCodec(model, options);
  if (!codec.ok) {
    return codec;
  }
  const types = visibleDeclsForTarget(model.decls, "rust").map(emitTypeWithDocs).join("\n");
  return ok(`${types}\n${codec.value}\n`);
};
