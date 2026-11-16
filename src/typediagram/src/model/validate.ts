import { DiagnosticBag, type Diagnostic } from "../parser/diagnostics.js";
import { BUILTIN_GENERICS, visibleDeclsForTarget, walkDeclRefs, type Model } from "./types.js";

const NULL_SPAN = { line: 0, col: 0 } as const;

/** Validate a Model independently of the parser. Used for hand-built or JSON-loaded models. */
export function validate(model: Model): Diagnostic[] {
  const bag = new DiagnosticBag();

  // Duplicate decl names
  const seen = new Map<string, number>();
  for (const d of model.decls) {
    seen.set(d.name, (seen.get(d.name) ?? 0) + 1);
  }
  for (const [name, count] of seen) {
    if (count > 1) {
      bag.error(`duplicate declaration '${name}'`, NULL_SPAN.line, NULL_SPAN.col);
    }
  }

  // Generic-arity mismatches when a decl name is referenced
  const arity = new Map<string, number>();
  for (const d of model.decls) {
    arity.set(d.name, d.generics.length);
  }

  for (const d of model.decls) {
    walkDeclRefs(d, (t) => {
      if (t.resolution.kind === "declared") {
        const expected = arity.get(t.resolution.declName);
        if (expected !== undefined && t.args.length !== expected) {
          bag.error(
            `type '${t.name}' takes ${String(expected)} type argument(s), got ${String(t.args.length)}`,
            NULL_SPAN.line,
            NULL_SPAN.col
          );
        }
      }
    });
  }

  return bag.items;
}

/**
 * [MODEL-CODEGEN-UNKNOWN] Codegen-blocking validation (GH issue #38): every
 * type name reachable from decls visible to `target` must be a primitive,
 * builtin generic, declared decl, or type param. Unknown names would otherwise
 * pass through verbatim into target-language source that cannot compile.
 */
export function validateForCodegen(model: Model, target: string): Diagnostic[] {
  const bag = new DiagnosticBag();
  const reported = new Set<string>();
  for (const d of visibleDeclsForTarget(model.decls, target)) {
    walkDeclRefs(d, (t) => {
      const unknown = t.resolution.kind === "external" && !BUILTIN_GENERICS.has(t.name) && !reported.has(t.name);
      if (unknown) {
        reported.add(t.name);
        bag.error(
          `unknown type '${t.name}': not a primitive, builtin, or declared type — declare it or use a builtin scalar`,
          NULL_SPAN.line,
          NULL_SPAN.col
        );
      }
    });
  }
  return bag.items;
}
