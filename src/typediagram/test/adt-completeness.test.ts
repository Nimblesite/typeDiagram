// [TD-ADT-COMPLETENESS] Runs the real checker over the encoding proved in
// docs/research/proofs/AdtCompleteness.lean: random ADT signatures are printed as
// typeDiagram, parsed, resolved for code generation and decoded back exactly.
import { describe, expect, it } from "vitest";
import { parse } from "../src/parser/index.js";
import type { Diagram, TypeRef } from "../src/parser/index.js";
import { buildModel, validateForCodegen } from "../src/model/index.js";
import { unwrap } from "./helpers.js";

type Ty = { var: string; args: Ty[] } | { con: string; args: Ty[] };
interface Data {
  name: string;
  params: string[];
  ctors: { name: string; args: Ty[] }[];
}

const CASES = 400;

const rng = (seed: number) => () => {
  seed = (seed * 1103515245 + 12345) % 2 ** 31;
  return seed / 2 ** 31;
};

// Well-kinded generation: constructors get their declared arity; parameter
// parameters `a0`, `a1` have kind * and `f` has kind * -> *.
type Kinds = Map<string, number>;
const BUILTINS: Kinds = new Map([
  ["Int", 0],
  ["String", 0],
  ["Bool", 0],
  ["List", 1],
  ["Option", 1],
  ["Map", 2],
]);
const pick = <T>(r: () => number, xs: T[]): T => xs[Math.floor(r() * xs.length)] as T;

function genTy(r: () => number, ps: string[], cs: Kinds, depth: number): Ty {
  const kind = (p: string): number => (p === "f" ? 1 : 0);
  const vars = ps.filter((p) => depth > 0 || kind(p) === 0);
  const cons = [...cs].filter(([, k]) => depth > 0 || k === 0);
  const useVar = vars.length > 0 && r() < 0.4;
  const [head, arity] = useVar ? ((v: string): [string, number] => [v, kind(v)])(pick(r, vars)) : pick(r, cons);
  const args = Array.from({ length: arity }, () => genTy(r, ps, cs, depth - 1));
  return useVar ? { var: head, args } : { con: head, args };
}

function genSig(r: () => number, n: number): Data[] {
  const heads = Array.from({ length: 1 + Math.floor(r() * 4) }, (_, i) => ({
    name: `T${String(n)}x${String(i)}`,
    params: Array.from({ length: Math.floor(r() * 4) }, (_p, j) => ["a0", "a1", "f"][j] ?? ""),
  }));
  const cs: Kinds = new Map([...BUILTINS, ...heads.map((h): [string, number] => [h.name, h.params.length])]);
  return heads.map(({ name, params }, i) => ({
    name,
    params,
    ctors: Array.from({ length: Math.floor(r() * 5) }, (_, k) => ({
      name: `C${String(i)}y${String(k)}`,
      args: Array.from({ length: Math.floor(r() * 4) }, () => genTy(r, params, cs, 3)),
    })),
  }));
}

const printTy = (t: Ty): string => {
  const head = "var" in t ? t.var : t.con;
  return t.args.length === 0 ? head : `${head}<${t.args.map(printTy).join(", ")}>`;
};

// Three concrete syntaxes for one variant; the proof says all mean posFields.
function printCtor(c: Data["ctors"][number], style: number): string {
  if (c.args.length === 0) {
    return c.name;
  }
  return style % 2 === 0
    ? `${c.name}(${c.args.map(printTy).join(", ")})`
    : `${c.name} { ${c.args.map((t, i) => `_${String(i)}: ${printTy(t)}`).join(", ")} }`;
}

const encode = (s: Data[]): string =>
  s
    .map((d, i) => {
      const gs = d.params.length === 0 ? "" : `<${d.params.join(", ")}>`;
      return `union ${d.name}${gs} {\n${d.ctors.map((c, k) => `  ${printCtor(c, i + k)}`).join("\n")}\n}`;
    })
    .join("\n");

const decTy = (ps: string[], t: TypeRef): Ty => {
  const args = t.args.map((a) => decTy(ps, a));
  return ps.includes(t.name) ? { var: t.name, args } : { con: t.name, args };
};

const decode = (g: Diagram): Data[] =>
  g.decls.map((d) => {
    if (d.kind !== "union") {
      throw new Error(`unexpected ${d.kind}`);
    }
    return {
      name: d.name,
      params: [...d.generics],
      ctors: d.variants.map((v) => ({ name: v.name, args: v.fields.map((f) => decTy(d.generics, f.type)) })),
    };
  });

function check(sig: Data[]): void {
  const ast = unwrap(parse(encode(sig)));
  expect(decode(ast)).toEqual(sig);
  const model = unwrap(buildModel(ast));
  expect(validateForCodegen(model, "rust")).toEqual([]);
  expect(validateForCodegen(model, "typescript")).toEqual([]);
}

const A: Ty = { var: "A", args: [] };
const con = (c: string, ...args: Ty[]): Ty => ({ con: c, args });

describe("[TD-ADT-COMPLETENESS] every ADT signature round-trips through the checker", () => {
  it("encodes each ADT former: empty, unit, sum, product, recursion, nesting, higher kinds", () => {
    check([{ name: "Void", params: [], ctors: [] }]);
    check([{ name: "One", params: [], ctors: [{ name: "MkOne", args: [] }] }]);
    check([
      { name: "Pair", params: ["A"], ctors: [{ name: "MkPair", args: [A, A] }] },
      {
        name: "Nest",
        params: ["A"],
        ctors: [
          { name: "Nil", args: [] },
          { name: "Cons", args: [A, con("Nest", con("Pair", A))] },
        ],
      },
    ]);
    check([
      { name: "Tree", params: ["A"], ctors: [{ name: "Node", args: [A, con("Forest", A)] }] },
      {
        name: "Forest",
        params: ["A"],
        ctors: [
          { name: "Leaf", args: [] },
          { name: "More", args: [con("Tree", A), con("Forest", A)] },
        ],
      },
    ]);
    check([
      {
        name: "Fix",
        params: ["F"],
        ctors: [{ name: "In", args: [{ var: "F", args: [con("Fix", { var: "F", args: [] })] }] }],
      },
    ]);
    check([
      {
        name: "Phantom",
        params: ["A", "B"],
        ctors: [{ name: "P", args: [con("Map", con("String"), con("List", A))] }],
      },
    ]);
  });

  it(`round-trips ${String(CASES)} random signatures through parse, resolve and decode`, () => {
    const r = rng(20261115);
    for (let n = 0; n < CASES; n++) {
      check(genSig(r, n));
    }
  });

  it("is not vacuous: an undeclared constructor fails code-generation resolution", () => {
    const model = unwrap(buildModel(unwrap(parse("union Bad { MkBad(Missing) }"))));
    expect(validateForCodegen(model, "rust").length).toBeGreaterThan(0);
    const ast = unwrap(parse("union X { A(Int) }"));
    expect(decode(ast)).not.toEqual([{ name: "X", params: [], ctors: [{ name: "A", args: [con("String")] }] }]);
  });
});
