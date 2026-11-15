/-
  Implements [TD-ADT-COMPLETENESS]: every algebraic data type signature has a
  typeDiagram encoding that the decoder recovers exactly.

  Checked with plain Lean 4 core (no Mathlib):  lean docs/proofs/AdtCompleteness.lean
  Prose companion: docs/specs/adt-completeness.md
-/

namespace AdtTd

/-! ## Source language: ADT signatures (Haskell 98 `data`, plus empty types) -/

/-- A type expression. `var a ts` is a type variable applied to arguments
    (`ts = []` for an ordinary variable, non-empty for a higher-kinded one);
    `con c ts` applies a type constructor (declared or primitive). -/
inductive Ty where
  | var : String → List Ty → Ty
  | con : String → List Ty → Ty

/-- A data constructor with positional arguments. -/
structure Ctor where
  name : String
  args : List Ty

/-- `data name params = ctor₁ | … | ctorₙ`, where `n = 0` gives an empty type. -/
structure Data where
  name   : String
  params : List String
  ctors  : List Ctor

/-- An ADT signature: a set of mutually recursive data declarations. -/
abbrev Sig := List Data

/-! ## Target language: the typeDiagram AST (docs/specs/language-reference.md) -/

/-- `TypeRef = Name ("<" TypeRef ("," TypeRef)* ">")?` -/
inductive TypeRef where
  | node : String → List TypeRef → TypeRef

structure Field where
  name : String
  type : TypeRef

/-- `Variant = Name ("=" Number)? ("{" Field* "}")?` -/
structure Variant where
  name   : String
  discr  : Option Int
  fields : List Field

inductive Decl where
  | record : String → List String → List Field → Decl
  | union  : String → List String → List Variant → Decl
  | alias  : String → List String → TypeRef → Decl

abbrev Diagram := List Decl

/-! ## Well-formedness of ADT signatures -/

mutual
  /-- Variables are bound by `ps`; constructor names are not variables
      (in Haskell this is the upper/lower-case split). -/
  def bound (ps : List String) : Ty → Bool
    | .var a ts => ps.contains a && boundAll ps ts
    | .con c ts => !ps.contains c && boundAll ps ts
  def boundAll (ps : List String) : List Ty → Bool
    | []      => true
    | t :: ts => bound ps t && boundAll ps ts
end

def ctorBound (ps : List String) (c : Ctor) : Bool := boundAll ps c.args

def Data.wf (d : Data) : Bool := d.ctors.all (ctorBound d.params)

def Sig.wf (s : Sig) : Bool := s.all Data.wf

/-! ## Encoding ⟦·⟧ : Sig → Diagram -/

mutual
  def encTy : Ty → TypeRef
    | .var a ts => .node a (encTys ts)
    | .con c ts => .node c (encTys ts)
  def encTys : List Ty → List TypeRef
    | []      => []
    | t :: ts => encTy t :: encTys ts
end

/-- Positional argument `i` becomes field `_i`, exactly as the parser
    desugars a tuple variant `C(A, B)` into fields `_0: A, _1: B`. -/
def posFields (i : Nat) : List Ty → List Field
  | []      => []
  | t :: ts => ⟨"_" ++ toString i, encTy t⟩ :: posFields (i + 1) ts

def encCtor (c : Ctor) : Variant := ⟨c.name, none, posFields 0 c.args⟩

def encData (d : Data) : Decl := .union d.name d.params (d.ctors.map encCtor)

def encode (s : Sig) : Diagram := s.map encData

/-! ## Decoding ⟦·⟧⁻¹ : Diagram → Option Sig -/

mutual
  def decTy (ps : List String) : TypeRef → Ty
    | .node n ts => if ps.contains n then .var n (decTys ps ts) else .con n (decTys ps ts)
  def decTys (ps : List String) : List TypeRef → List Ty
    | []      => []
    | t :: ts => decTy ps t :: decTys ps ts
end

def decVariant (ps : List String) (v : Variant) : Ctor :=
  ⟨v.name, v.fields.map (fun f => decTy ps f.type)⟩

/-- Records decode as single-constructor types; aliases are not data. -/
def decDecl : Decl → Option Data
  | .union n ps vs  => some ⟨n, ps, vs.map (decVariant ps)⟩
  | .record n ps fs => some ⟨n, ps, [decVariant ps ⟨n, none, fs⟩]⟩
  | .alias ..       => none

def decode (g : Diagram) : Option Sig := g.mapM decDecl

/-! ## Theorem 1: decoding inverts encoding on well-formed signatures -/

mutual
  theorem dec_enc_ty (ps : List String) : ∀ t, bound ps t = true → decTy ps (encTy t) = t
    | .var a ts, h => by
      simp only [bound, Bool.and_eq_true] at h
      simp [encTy, decTy, dec_enc_tys ps ts h.2]; simpa using h.1
    | .con c ts, h => by
      simp only [bound, Bool.and_eq_true, Bool.not_eq_true'] at h
      simp [encTy, decTy, dec_enc_tys ps ts h.2]; simpa using h.1
  theorem dec_enc_tys (ps : List String) : ∀ ts, boundAll ps ts = true → decTys ps (encTys ts) = ts
    | [], _ => rfl
    | t :: ts, h => by
      simp only [boundAll, Bool.and_eq_true] at h
      simp [encTys, decTys, dec_enc_ty ps t h.1, dec_enc_tys ps ts h.2]
end

theorem posFields_types (ps : List String) :
    ∀ i ts, (posFields i ts).map (fun f => decTy ps f.type) = decTys ps (encTys ts)
  | _, []      => rfl
  | i, _ :: ts => by simp [posFields, encTys, decTys, posFields_types ps (i + 1) ts]

theorem dec_enc_ctor (ps : List String) (c : Ctor) (h : ctorBound ps c = true) :
    decVariant ps (encCtor c) = c := by
  cases c with
  | mk n args =>
    simp only [ctorBound] at h
    simp [decVariant, encCtor, posFields_types, dec_enc_tys ps args h]

theorem dec_enc_ctors (ps : List String) :
    ∀ cs : List Ctor, cs.all (ctorBound ps) = true → (cs.map encCtor).map (decVariant ps) = cs
  | [], _ => rfl
  | c :: cs, h => by
    simp only [List.all_cons, Bool.and_eq_true] at h
    simp [dec_enc_ctor ps c h.1, dec_enc_ctors ps cs h.2]

theorem dec_enc_data (d : Data) (h : d.wf = true) : decDecl (encData d) = some d := by
  cases d with
  | mk n ps cs => simp [decDecl, encData, dec_enc_ctors ps cs h]

theorem decode_encode : ∀ s : Sig, s.wf = true → decode (encode s) = some s
  | [], _ => rfl
  | d :: s, h => by
    simp only [Sig.wf, List.all_cons, Bool.and_eq_true] at h
    have hs : decode (encode s) = some s := decode_encode s h.2
    simp only [decode, encode] at hs
    simp [decode, encode, List.mapM_cons, dec_enc_data d h.1, hs]

/-- Corollary: distinct well-formed ADTs never share a diagram. -/
theorem encode_injective (s₁ s₂ : Sig) (h₁ : s₁.wf = true) (h₂ : s₂.wf = true)
    (h : encode s₁ = encode s₂) : s₁ = s₂ := by
  have e₁ := decode_encode s₁ h₁
  rw [h, decode_encode s₂ h₂] at e₁
  exact (Option.some.inj e₁).symm

/-! ## Theorem 2: closed signatures encode to fully resolved diagrams

  typeDiagram code generation requires every referenced name to be a primitive
  or built-in generic, a declared type, or a generic parameter
  (language-reference.md, "Code generation and unknown types"). -/

mutual
  def namesIn : TypeRef → List String
    | .node n ts => n :: namesInAll ts
  def namesInAll : List TypeRef → List String
    | []      => []
    | t :: ts => namesIn t ++ namesInAll ts
end

mutual
  /-- Every name in a type is a bound variable or in the constructor scope `cs`. -/
  def closedTy (ps cs : List String) : Ty → Bool
    | .var a ts => ps.contains a && closedTys ps cs ts
    | .con c ts => cs.contains c && closedTys ps cs ts
  def closedTys (ps cs : List String) : List Ty → Bool
    | []      => true
    | t :: ts => closedTy ps cs t && closedTys ps cs ts
end

mutual
  theorem closed_names (ps cs : List String) :
      ∀ t, closedTy ps cs t = true → ∀ n ∈ namesIn (encTy t), n ∈ ps ∨ n ∈ cs
    | .var a ts, h, n, hn => by
      simp only [closedTy, Bool.and_eq_true, List.contains_iff_mem] at h
      simp only [encTy, namesIn, List.mem_cons] at hn
      rcases hn with rfl | hn
      · exact .inl h.1
      · exact closed_names_all ps cs ts h.2 n hn
    | .con c ts, h, n, hn => by
      simp only [closedTy, Bool.and_eq_true, List.contains_iff_mem] at h
      simp only [encTy, namesIn, List.mem_cons] at hn
      rcases hn with rfl | hn
      · exact .inr h.1
      · exact closed_names_all ps cs ts h.2 n hn
  theorem closed_names_all (ps cs : List String) :
      ∀ ts, closedTys ps cs ts = true → ∀ n ∈ namesInAll (encTys ts), n ∈ ps ∨ n ∈ cs
    | [], _, n, hn => by simp [encTys, namesInAll] at hn
    | t :: ts, h, n, hn => by
      simp only [closedTys, Bool.and_eq_true] at h
      simp only [encTys, namesInAll, List.mem_append] at hn
      rcases hn with hn | hn
      · exact closed_names ps cs t h.1 n hn
      · exact closed_names_all ps cs ts h.2 n hn
end

theorem posFields_names (ps cs : List String) :
    ∀ i ts, closedTys ps cs ts = true →
      ∀ f ∈ posFields i ts, ∀ n ∈ namesIn f.type, n ∈ ps ∨ n ∈ cs
  | _, [], _, f, hf => by simp [posFields] at hf
  | i, t :: ts, h, f, hf => by
    simp only [closedTys, Bool.and_eq_true] at h
    simp only [posFields, List.mem_cons] at hf
    rcases hf with rfl | hf
    · exact closed_names ps cs t h.1
    · exact posFields_names ps cs (i + 1) ts h.2 f hf

/-- The encoding declares exactly the signature's type names. -/
theorem union_names :
    ∀ s : Sig, (encode s).filterMap (fun | .union n .. => some n | _ => none) = s.map Data.name
  | [] => rfl
  | d :: s => by
    have ih := union_names s
    simp only [encode] at ih
    simp [encode, encData, ih]

/-- If every constructor a signature mentions is declared in it or is a
    built-in, every reference in the encoded diagram resolves. -/
theorem encode_resolves (builtins : List String) (s : Sig)
    (h : ∀ d ∈ s, ∀ c ∈ d.ctors,
      closedTys d.params (s.map Data.name ++ builtins) c.args = true) :
    ∀ d ∈ s, ∀ v ∈ (encData d |> fun | .union _ _ vs => vs | _ => []),
      ∀ f ∈ v.fields, ∀ n ∈ namesIn f.type,
        n ∈ d.params ∨ n ∈ (encode s).filterMap (fun | .union n .. => some n | _ => none) ∨
        n ∈ builtins := by
  intro d hd v hv f hf n hn
  simp only [encData, List.mem_map] at hv
  obtain ⟨c, hc, rfl⟩ := hv
  rcases posFields_names d.params _ 0 c.args (h d hd c hc) f hf n hn with hp | hp
  · exact .inl hp
  · right
    simp only [List.mem_append] at hp
    rcases hp with hp | hp
    · left
      rw [union_names s]; exact hp
    · exact .inr hp

/-! ## Worked instances (each also runs through the real checker) -/

def tA : Ty := .var "A" []
def nest : Data := ⟨"Nest", ["A"], [⟨"Nil", []⟩,
  ⟨"Cons", [tA, .con "Nest" [.con "Pair" [tA]]]⟩]⟩
def fix : Data := ⟨"Fix", ["F"], [⟨"In", [.var "F" [.con "Fix" [.var "F" []]]]⟩]⟩
def void : Data := ⟨"Void", [], []⟩

example : decode (encode [nest, fix, void]) = some [nest, fix, void] :=
  decode_encode _ (by decide +kernel)

#print axioms decode_encode
#print axioms encode_injective
#print axioms encode_resolves

end AdtTd
