// [CONV-EMIT-DECLS] Shared decl-walking scaffold for language emitters.
//
// The control flow "take the target-visible decls, dispatch each on d.kind to
// a per-language record/union/alias emitter, collect the lines, then join" is
// identical across brace-style converters (C#, Dart, Protobuf). Only the
// per-language emit callbacks and the file prelude differ, so those are
// parameters; the walking is centralised here so no converter re-implements it.
import {
  type Model,
  type ResolvedAlias,
  type ResolvedRecord,
  type ResolvedUnion,
  visibleDeclsForTarget,
} from "../model/types.js";
import type { Language } from "./types.js";

/** Per-decl emitters. Each returns the source lines for one declaration. */
export interface DeclEmitters {
  readonly record: (d: ResolvedRecord) => string[];
  readonly union: (d: ResolvedUnion) => string[];
  readonly alias: (d: ResolvedAlias) => string[];
}

export interface EmitDeclsOptions {
  /** Lines emitted before any decl (syntax pragma, imports, …). */
  readonly prelude?: string[];
  /** Collapse trailing blank lines into a single newline when true. */
  readonly trimTrailing?: boolean;
}

const emitOne = (d: Model["decls"][number], emit: DeclEmitters): string[] =>
  d.kind === "record" ? emit.record(d) : d.kind === "union" ? emit.union(d) : emit.alias(d);

/**
 * Walk `model`'s decls visible to `language`, emit each via `emit` (a blank
 * line separates consecutive declarations), and join into a single string.
 */
export const emitDecls = (
  model: Model,
  language: Language,
  emit: DeclEmitters,
  options: EmitDeclsOptions = {}
): string => {
  const lines = [...(options.prelude ?? [])];
  for (const d of visibleDeclsForTarget(model.decls, language)) {
    lines.push(...emitOne(d, emit), "");
  }
  const joined = lines.join("\n");
  return options.trimTrailing === true ? joined.replace(/\n+$/, "\n") : joined;
};
