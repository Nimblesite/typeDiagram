import type { Edge, ResolvedAlias, ResolvedDecl, ResolvedRecord, ResolvedTypeRef, ResolvedUnion } from "./types.js";

interface DeclaredRef {
  declName: string;
  isHead: boolean;
}

/** Walk a resolved typeRef and yield every declared decl reached, with the first (the head) flagged. */
function* walkDeclaredRefs(t: ResolvedTypeRef): Generator<DeclaredRef> {
  if (t.resolution.kind === "declared") {
    yield { declName: t.resolution.declName, isHead: true };
  }
  for (const a of t.args) {
    if (a.resolution.kind === "declared") {
      yield { declName: a.resolution.declName, isHead: false };
    }
    // recurse into deeper args (e.g. List<Option<X>>); the immediate arg head is yielded above.
    for (const inner of walkDeclaredRefs(a)) {
      if (!inner.isHead) {
        yield inner;
      }
    }
  }
}

function edgeKey(e: Edge): string {
  const variant = String(e.sourceVariantFieldIndex ?? -1);
  return `${e.sourceDeclName}|${String(e.sourceRowIndex)}|${variant}|${e.targetDeclName}|${e.kind}`;
}

function recordEdges(d: ResolvedRecord): Edge[] {
  return d.fields.flatMap((f, i) =>
    [...walkDeclaredRefs(f.type)].map((ref) => ({
      sourceDeclName: d.name,
      sourceRowIndex: i,
      sourceVariantFieldIndex: null,
      targetDeclName: ref.declName,
      label: f.name,
      kind: ref.isHead ? ("field" as const) : ("genericArg" as const),
    }))
  );
}

function unionEdges(d: ResolvedUnion): Edge[] {
  return d.variants.flatMap((v, vi) =>
    v.fields.flatMap((f, fi) =>
      [...walkDeclaredRefs(f.type)].map((ref) => ({
        sourceDeclName: d.name,
        sourceRowIndex: vi,
        sourceVariantFieldIndex: fi,
        targetDeclName: ref.declName,
        label: `${v.name}.${f.name}`,
        kind: ref.isHead ? ("variantPayload" as const) : ("genericArg" as const),
      }))
    )
  );
}

function aliasEdges(d: ResolvedAlias): Edge[] {
  return [...walkDeclaredRefs(d.target)].map((ref) => ({
    sourceDeclName: d.name,
    sourceRowIndex: -1,
    sourceVariantFieldIndex: null,
    targetDeclName: ref.declName,
    label: "",
    kind: ref.isHead ? ("field" as const) : ("genericArg" as const),
  }));
}

function declEdges(d: ResolvedDecl): Edge[] {
  return d.kind === "record" ? recordEdges(d) : d.kind === "union" ? unionEdges(d) : aliasEdges(d);
}

/** Collect the deduplicated edge set for a resolved decl list. Shared by build.ts and builder.ts. */
export function collectDeclEdges(decls: readonly ResolvedDecl[]): Edge[] {
  const seen = new Set<string>();
  const edges: Edge[] = [];
  for (const d of decls) {
    for (const e of declEdges(d)) {
      const key = edgeKey(e);
      if (!seen.has(key)) {
        seen.add(key);
        edges.push(e);
      }
    }
  }
  return edges;
}
