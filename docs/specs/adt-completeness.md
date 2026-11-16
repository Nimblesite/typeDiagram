# ADT completeness [TD-ADT-COMPLETENESS]

**Claim.** Every algebraic data type signature can be written in typeDiagram, and the written form determines the original signature exactly.

The proof is checked by Lean 4 in [`docs/research/proofs/AdtCompleteness.lean`](../proofs/AdtCompleteness.lean), using only Lean core and its standard axioms `propext` and `Quot.sound`. It contains no `sorry`. The real parser and code-generation checker run the same encoding in [`adt-completeness.test.ts`](../../src/typediagram/test/adt-completeness.test.ts).

## What counts as an ADT [TD-ADT-COMPLETENESS-SCOPE]

An ADT signature is a finite set of mutually recursive declarations in the style of Haskell 98 `data`, plus empty types:

```
data T a₁ … aₖ = C₁ τ₁₁ … τ₁ₘ | … | Cₙ τₙ₁ … τₙₘ        (n ≥ 0)
τ ::= a τ₁ … τⱼ   (a type variable, possibly higher-kinded, j ≥ 0)
    | K τ₁ … τⱼ   (a declared type or a primitive, j ≥ 0)
```

This grammar produces all of the following:

- the empty type (`n = 0`) and the unit type (one constructor with no arguments);
- sums, products and their combinations;
- direct recursion and mutual recursion;
- parametric types and phantom parameters;
- nested (non-regular) types such as `Nest a = Nil | Cons a (Nest (Pair a))`;
- higher-kinded parameters such as `Fix f = In (f (Fix f))`.

Semantically, each declaration is an equation `T(ā) = Σᵢ Πⱼ τᵢⱼ`, and the signature denotes the least solution of that system of polynomial equations.

The signature is **well-formed** when two conditions hold:

- every variable in a declaration is one of its own parameters;
- no type constructor name is also a parameter name. In Haskell, the upper-case and lower-case split guarantees this.

Record syntax and strictness annotations are notation over this grammar. Named fields map directly onto typeDiagram fields.

## Encoding [TD-ADT-COMPLETENESS-ENCODING]

The encoding ⟦·⟧ maps each signature to a typeDiagram diagram as follows:

- **Declarations:** `data T a₁ … aₖ` becomes `union T<a₁, …, aₖ> { … }`, with the `<…>` omitted when `k = 0`.
- **Constructors:** constructor `C τ₀ … τₘ` becomes the variant `C { _0: ⟦τ₀⟧, …, _m: ⟦τₘ⟧ }`, or a bare `C` when `m = 0`.
  - The tuple form `C(⟦τ₀⟧, …)` parses to exactly the same AST. The parser itself desugars positional payloads into fields named `_0`, `_1`, and so on.
- **Types:** `⟦a τ₁ … τⱼ⟧` and `⟦K τ₁ … τⱼ⟧` both become `Name<⟦τ₁⟧, …, ⟦τⱼ⟧>`, with the `<…>` omitted when `j = 0`.

Every production used here belongs to the typeDiagram grammar in [language-reference.md](language-reference.md#grammar-formal):

- `Union` allows `Variant*`, so zero variants is legal;
- `Variant` allows an optional field block;
- `TypeRef` nests arbitrarily;
- `Generics` binds the parameters.

For example, the empty type, a nested type and a higher-kinded fixed point are written like this:

```typediagram
union Void {}
type Pair<A> { _0: A, _1: A }
union Nest<A> {
  Nil
  Cons(A, Nest<Pair<A>>)
}
union Fix<F> { In(F<Fix<F>>) }
```

## Theorem 1: the encoding loses nothing [TD-ADT-COMPLETENESS-ROUNDTRIP]

Define the decoder ⟦·⟧⁻¹ as follows:

- A union `T<ā>` decodes to `data T ā` with one constructor per variant, taking the field types in order.
- A `TypeRef` `n<…>` decodes to the variable `n` when `n ∈ ā`, and to the type constructor `n` otherwise.

**Theorem.** For every well-formed signature `s`, `⟦⟦s⟧⟧⁻¹ = s`. In Lean this is `decode_encode`.

_Proof._ The proof is by mutual structural induction over types and lists of types.

1. **Type expressions.** Consider a variable `a`. Well-formedness gives `a ∈ ā`, so the decoder returns a variable, and by induction its arguments decode to the originals. Now consider a constructor `K`. Well-formedness gives `K ∉ ā`, so the decoder returns a constructor, and again its arguments decode to the originals.
2. **Constructors.** Field `_i` holds `⟦τᵢ⟧`, and the decoder reads field types in order. The names `_i` are discarded, so constructor arguments are recovered (lemma `posFields_types`).
3. **Declarations and signatures.** These follow by induction on the lists, because a union keeps its name and parameters verbatim. ∎

**Corollary (`encode_injective`).** Distinct well-formed ADTs have distinct diagrams. Together with Theorem 1, this means typeDiagram can express every ADT in the class, and no two of them collapse into one diagram.

**Semantics.** The decoder recovers the exact system of equations `T(ā) = Σᵢ Πⱼ τᵢⱼ`. typeDiagram's own reading assigns the same meaning to each part:

- a union is a tagged choice among its variants;
- a variant's fields are a product;
- a name refers to its declaration.

So the encoded diagram denotes the same system of equations, and therefore the same least solution.

## Theorem 2: the encoding passes code generation [TD-ADT-COMPLETENESS-RESOLVES]

Code generation rejects any reference that is not one of these:

- a primitive;
- a built-in generic;
- a declared type;
- a generic parameter.

**Theorem.** Suppose every constructor that a signature uses is either declared in the signature or is a built-in. Then every name in the encoded diagram is a parameter of its declaration, a declared union, or a built-in. In Lean this is `encode_resolves`, proved with `closed_names` and `union_names`.

Theorem 1 preserves every application's argument list exactly, so it also preserves the arity of each application. The checker's arity rule ("type 'T' takes k type argument(s)") therefore accepts any well-kinded signature.

## Machine checks [TD-ADT-COMPLETENESS-CHECKS]

| Check                   | Command                                                                  | Result                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lean proof              | `lean docs/research/proofs/AdtCompleteness.lean`                                  | Theorems 1 and 2 and the corollary check. `#print axioms` lists only `propext` and `Quot.sound`.                                                                                                                                                                                                                                                                                          |
| Real parser and checker | `npx vitest run test/adt-completeness.test.ts` in `src/typediagram` | 400 seeded random well-kinded signatures (1–4 declarations, 0–3 parameters including one of kind `* → *`, 0–4 constructors, 0–3 arguments, type depth up to 3, tuple and braced variants mixed) pass. Each one parses, decodes back exactly, and resolves for both Rust and TypeScript code generation. The six fixed cases pass: empty, unit, nested, mutual, higher-kinded and phantom. |
| Negative control        | same test                                                                | `MkBad(Missing)` fails resolution, so the check is not vacuous.                                                                                                                                                                                                                                                                                                                           |
| CLI                     | `typediagram FILE` and `typediagram --to rust FILE`                      | The empty, unit, tuple, nested, mutual and higher-kinded samples all render and convert.                                                                                                                                                                                                                                                                                                  |

## Outside the class [TD-ADT-COMPLETENESS-LIMITS]

These are not ADTs in the sense above, and typeDiagram cannot express them faithfully today:

- **Function-typed fields** (exponentials, such as `data F = F (Int -> Int)`). A `TypeRef` has no arrow form. A `function` declaration names a signature but is not a field type.
- **GADTs, existential types and class constraints.** Variants cannot refine or quantify type parameters.
- **Kinds of variable applications are not checked.** `F<X>` is accepted for any parameter `F`. This makes typeDiagram more permissive than ADTs; it does not make it less expressive.

The proof covers the markup. It does not show that every target-language converter can express every ADT. For example, `--to rust` emits `Cons(A, Nest<Pair<A>>)` without a `Box` and emits `F<Fix<F>>` for a higher-kinded parameter, and rustc rejects both. `--to typescript` emits `export type Void = | ;` for the empty union instead of `never`. These are defects in the converters, not limits of typeDiagram.
