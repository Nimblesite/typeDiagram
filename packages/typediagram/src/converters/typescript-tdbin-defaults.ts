// [CONV-TS-TDBIN] Shared plan types and the [TDBIN-PTR-NULL] default-factory
// emission for the TypeScript TDBIN generator: required pointer fields decode
// a null pointer as the schema default instead of erroring ([TDBIN-REC-SHORT]),
// so every codec that can hit a null required slot gets a `default<Type>()`
// factory — empty string/bytes, default record, or the union's FIRST variant.
import type { Diagnostic } from "../parser/diagnostics.js";
import type { ResolvedRecord, ResolvedUnion } from "../model/types.js";
import { type Result, err, ok } from "../result.js";

export type FieldPlan =
  | { kind: "int"; slot: number }
  | { kind: "float"; slot: number }
  | { kind: "bool"; slot: number; bit: number }
  | { kind: "optInt"; presenceSlot: number; presenceBit: number; valueSlot: number }
  | { kind: "optFloat"; presenceSlot: number; presenceBit: number; valueSlot: number }
  | { kind: "optBool"; presenceSlot: number; presenceBit: number; valueSlot: number; valueBit: number }
  | { kind: "string"; slot: number; optional: boolean }
  | { kind: "bytes"; slot: number; optional: boolean }
  | { kind: "child"; slot: number; optional: boolean; typeName: string };

export interface RecordPlan {
  readonly dataWords: number;
  readonly ptrWords: number;
  readonly fields: readonly { readonly name: string; readonly plan: FieldPlan }[];
}

export type VariantPlan = null | { readonly kind: "child"; readonly typeName: string } | { readonly kind: "string" };

export interface UnionPlan {
  readonly ptrWords: number;
  readonly variants: readonly { readonly name: string; readonly ordinal: number; readonly payload: VariantPlan }[];
}

export type DeclPlan =
  | { readonly kind: "record"; readonly decl: ResolvedRecord; readonly plan: RecordPlan }
  | { readonly kind: "union"; readonly decl: ResolvedUnion; readonly plan: UnionPlan };

export type PointerPlan = Extract<FieldPlan, { optional: boolean }>;

export const diag = (message: string): Diagnostic[] => [{ severity: "error", message, line: 0, col: 0, length: 0 }];

export const pointerDefault = (plan: PointerPlan): string =>
  plan.kind === "string" ? `""` : plan.kind === "bytes" ? "new Uint8Array(0)" : `default${plan.typeName}()`;

const fieldDefault = (plan: FieldPlan): string => {
  switch (plan.kind) {
    case "int":
    case "float":
      return "0";
    case "bool":
      return "false";
    case "optInt":
    case "optFloat":
    case "optBool":
      return "undefined";
    default:
      return plan.optional ? "undefined" : pointerDefault(plan);
  }
};

export const variantPayloadDefault = (payload: NonNullable<VariantPlan>): string =>
  payload.kind === "string" ? `""` : `default${payload.typeName}()`;

const emitRecordDefault = (record: ResolvedRecord, plan: RecordPlan): string => {
  const fields = plan.fields.map(({ name, plan: fieldPlan }) => `${name}: ${fieldDefault(fieldPlan)}`).join(", ");
  return `const default${record.name} = (): ${record.name} => (${fields === "" ? "{}" : `{ ${fields} }`});`;
};

const emitUnionDefault = (union: ResolvedUnion, plan: UnionPlan): Result<string, Diagnostic[]> => {
  const first = plan.variants[0];
  if (first === undefined) {
    return err(diag(`tdbin-ts: union '${union.name}' has no variants; cannot derive its [TDBIN-PTR-NULL] default`));
  }
  const value =
    first.payload === null
      ? `{ kind: "${first.name}" }`
      : `{ kind: "${first.name}", _0: ${variantPayloadDefault(first.payload)} }`;
  return ok(`const default${union.name} = (): ${union.name} => (${value});`);
};

const requiredChildNames = (plan: RecordPlan): string[] =>
  plan.fields.flatMap(({ plan: fieldPlan }) =>
    fieldPlan.kind === "child" && !fieldPlan.optional ? [fieldPlan.typeName] : []
  );

const childPayloadNames = (plan: UnionPlan): string[] =>
  plan.variants.flatMap((variant) =>
    variant.payload !== null && variant.payload.kind === "child" ? [variant.payload.typeName] : []
  );

const codecDefaultRefs = (plan: DeclPlan): string[] =>
  plan.kind === "record" ? requiredChildNames(plan.plan) : childPayloadNames(plan.plan);

const defaultDeps = (plan: DeclPlan): string[] => {
  const payload = plan.kind === "union" ? plan.plan.variants[0]?.payload : undefined;
  return plan.kind === "record" ? requiredChildNames(plan.plan) : payload?.kind === "child" ? [payload.typeName] : [];
};

const findDefaultCycle = (
  byName: ReadonlyMap<string, DeclPlan>,
  name: string,
  path: readonly string[]
): readonly string[] | null => {
  if (path.includes(name)) {
    return [...path, name];
  }
  const plan = byName.get(name);
  for (const dep of plan === undefined ? [] : defaultDeps(plan)) {
    const cycle = findDefaultCycle(byName, dep, [...path, name]);
    if (cycle !== null) {
      return cycle;
    }
  }
  return null;
};

const emitDefaultFactory = (plan: DeclPlan): Result<string, Diagnostic[]> =>
  plan.kind === "record" ? ok(emitRecordDefault(plan.decl, plan.plan)) : emitUnionDefault(plan.decl, plan.plan);

/** Emit `default<Type>()` factories for every type reachable from a required
 *  child slot, rejecting non-terminating (recursive) defaults loudly. */
export const emitDefaultFactories = (plans: readonly DeclPlan[]): Result<string[], Diagnostic[]> => {
  const byName: ReadonlyMap<string, DeclPlan> = new Map(plans.map((plan) => [plan.decl.name, plan]));
  const needed = new Set(plans.flatMap(codecDefaultRefs));
  const blocks: string[] = [];
  for (const plan of plans.filter((candidate) => needed.has(candidate.decl.name))) {
    const cycle = findDefaultCycle(byName, plan.decl.name, []);
    if (cycle !== null) {
      const trail = cycle.join(" -> ");
      return err(
        diag(`tdbin-ts: cannot derive [TDBIN-PTR-NULL] default for recursive type '${plan.decl.name}' (${trail})`)
      );
    }
    const block = emitDefaultFactory(plan);
    if (!block.ok) {
      return block;
    }
    blocks.push(block.value);
  }
  return ok(blocks);
};
