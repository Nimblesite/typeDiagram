# Proofs

## typeDiagram can express every algebraic data type

[`AdtCompleteness.lean`](AdtCompleteness.lean) is a machine-checked proof that every algebraic data type (ADT) can be written in typeDiagram markup, with nothing lost. The prose version, with the exact scope, is [ADT completeness](../specs/adt-completeness.md).

### Why it matters

ADTs are how most modern languages model data. Rust and Swift enums, F# and OCaml unions, Haskell `data`, Kotlin sealed classes and TypeScript discriminated unions are all ADTs. A schema language that can describe only some of them pushes people into lossy workarounds, such as turning a union into a record of nullable fields, or flattening a recursive type. Generated code then permits states the original model ruled out.

The proof gives three guarantees:

1. **Nothing is lost.** Any ADT can be written as a typeDiagram diagram, and the diagram can be read back into exactly the original ADT. That includes empty types, unit types, sums, products, recursive and mutually recursive types, generic and phantom parameters, nested types such as `Nest<Pair<A>>`, and higher-kinded parameters such as `Fix<F>`. A diagram is therefore a faithful single source of truth that every converter can generate from.
2. **Nothing collides.** Two different ADTs never produce the same diagram, so the diagram never merges two models into one.
3. **The checker accepts every encoded ADT.** If every type an ADT mentions is declared or built in, its diagram passes the code-generation checks for unknown names and type arity. The encoding never produces markup that typeDiagram's own checker rejects.

These results are proved, not just tested. Lean checks every step, the proof contains no `sorry`, and it relies only on Lean's standard axioms (`propext` and `Quot.sound`).

### Proved and then run through the real parser

A proof is only as good as its model of the language. [`adt-completeness.test.ts`](../../packages/typediagram/test/adt-completeness.test.ts) therefore runs the same encoding through the real parser and checker:

- 400 seeded random ADTs that respect type arity, plus fixed cases for each kind of type listed above.
- Each one is parsed, decoded back, compared with the original, and resolved for Rust and TypeScript code generation.
- A negative control confirms the checker rejects an undeclared type, so the test is not passing vacuously.

### What it found

The markup can express every ADT, but some converters cannot yet turn every diagram into valid code:

- **Rust:** `--to rust` emits recursive variants without a `Box`, and emits higher-kinded parameters such as `F<Fix<F>>`. rustc rejects both.
- **TypeScript:** `--to typescript` emits `export type Void = | ;` for an empty union instead of `never`.

### What it does not cover

These fall outside the definition of an ADT used here, and typeDiagram cannot express them today:

- function-typed fields, such as `Int -> Int`;
- GADTs and existential types;
- type-class constraints.

### Run it

```sh
lean docs/proofs/AdtCompleteness.lean
cd packages/typediagram && npx vitest run test/adt-completeness.test.ts
```
