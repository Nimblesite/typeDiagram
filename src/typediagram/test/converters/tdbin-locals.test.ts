// [TDBIN-CODEGEN-LOCALS] Fields and variants named after the generated codecs'
// own identifiers must never shadow them. TypeScript codecs bind positional
// locals (`f0`, `f0Word`, …) so `value`/`writer`/`reader`/`at`/`tdbin`/`ok` and
// suffix pairs (`x` + `xPresent`) are safe; Rust decoders bind `f0`… so `r`/`at`
// survive, and column groups use `v0`/`f0` locals so `w`/`items`/`count`/`tags`
// survive. The committed `generated_names` crate module compiles and
// round-trips under `cargo test` (src/tdbin/tests/names.rs).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { emitRustCodec } from "../../src/converters/rust-tdbin.js";
import { emitTypeScriptCodec } from "../../src/converters/typescript-tdbin.js";
import * as tdbin from "../../src/tdbin/index.js";
import { codecFor, expectRustModuleReproduces, modelFromTd, unwrap } from "./helpers.js";

const NAMES_TD = readFileSync(fileURLToPath(new URL("fixtures/names.td", import.meta.url)), "utf8");

interface Inner {
  readonly at: number;
  readonly r: string;
}
type Pick =
  | { readonly kind: "W"; readonly _0: Inner }
  | { readonly kind: "Items"; readonly _0: Inner }
  | { readonly kind: "Tags" }
  | { readonly kind: "Count"; readonly _0: Inner };
interface Names {
  readonly value: string;
  readonly writer: number;
  readonly reader: number;
  readonly tdbin: number;
  readonly ok: boolean;
  readonly w: number;
  readonly at: number;
  readonly r: number;
  readonly count: number;
  readonly i: boolean;
  readonly items: Inner | undefined;
  readonly rows: readonly Inner[];
  readonly tags: readonly string[];
  readonly x: number | undefined;
  readonly xPresent: number | undefined;
  readonly pick: Pick;
}

const names = (seed: number): Names => ({
  value: `v${String(seed)}`,
  writer: seed,
  reader: 0 - seed,
  tdbin: seed * 3,
  ok: seed % 2 === 0,
  w: seed + 1,
  at: seed + 2,
  r: seed + 3,
  count: seed + 4,
  i: seed % 2 === 1,
  items: seed % 2 === 0 ? { at: seed, r: "items" } : undefined,
  rows: [
    { at: 1, r: "a" },
    { at: seed, r: "b" },
  ],
  tags: ["t", String(seed)],
  x: seed,
  xPresent: seed % 3 === 0 ? 0 - seed : undefined,
  pick: [
    { kind: "W", _0: { at: seed, r: "w" } } as const,
    { kind: "Items", _0: { at: seed, r: "it" } } as const,
    { kind: "Tags" } as const,
    { kind: "Count", _0: { at: seed, r: "c" } } as const,
  ][seed % 4] ?? { kind: "Tags" },
});

describe("[TDBIN-CODEGEN-LOCALS] codec locals never shadow params, imports, or each other", () => {
  it("round-trips TypeScript codecs for colliding field names and pins positional locals", () => {
    const source = unwrap(emitTypeScriptCodec(modelFromTd(NAMES_TD)));
    const namesCodec = codecFor<Names>(source, "NamesCodec");
    const pickCodec = codecFor<Pick>(source, "PickCodec");
    for (let seed = 0; seed < 8; seed++) {
      const value = names(seed);
      const bytes = unwrap(tdbin.encode(namesCodec, value));
      expect(unwrap(tdbin.decode(namesCodec, bytes))).toEqual(value);
      expect(unwrap(tdbin.encode(namesCodec, unwrap(tdbin.decode(namesCodec, bytes))))).toEqual(bytes);
      expect(unwrap(tdbin.decode(pickCodec, unwrap(tdbin.encode(pickCodec, value.pick))))).toEqual(value.pick);
    }
    expect(source).toContain("const f0 = tdbin.writer.string(writer, at, NamesCodec.dataWords, 0, value.value);");
    expect(source).toContain("const f3Bits = tdbin.scalar.i64Bits(value.tdbin);");
    expect(source).toContain("const f13Present = tdbin.writer.boolBit(");
    expect(source).toContain("const f14Present = tdbin.writer.boolBit(");
    expect(source).toContain('value: f0.value ?? ""');
    expect(source).toContain("xPresent: f14Present.value ? tdbin.scalar.i64From(f14Word.value) : undefined");
    expect(source).not.toContain("const value =");
    expect(source).not.toContain("const writer =");
    expect(source).not.toContain("const tdbin =");
    expect(source).not.toContain("const ok =");
  });

  it("emits Rust struct and column-group codecs with positional locals at layouts 1 and 2", () => {
    const model = modelFromTd(NAMES_TD);
    const layout1 = unwrap(emitRustCodec(model));
    expect(layout1).toContain("let f5 = tdbin::scalar::i64_from(r.scalar(at, 4)?);");
    expect(layout1).toContain("w: f5, at: f6, r: f7, count: f8, i: f9");
    expect(layout1).toContain("let f13_present = r.bool_bit(at,");
    expect(layout1).toContain("let f14_present = r.bool_bit(at,");
    for (const shadow of ["let r =", "let at =", "let w =", "let count =", "let items", "let tags =", "let value ="]) {
      expect(layout1).not.toContain(shadow);
    }
    const layout2 = unwrap(emitRustCodec(model, { layout: 2 }));
    expect(layout2).toContain(
      "let items_some: Vec<&Inner> = items.clone().filter_map(|row| row.items.as_ref()).collect();"
    );
    expect(layout2).toContain("let v0: Vec<&Inner> = items.clone().filter_map(|row| match row {");
    expect(layout2).toContain("let v1_count = tags.iter().map(|tag| usize::from(*tag == 1)).sum::<usize>();");
    expect(layout2).toContain("0 => Self::W(v0.next().ok_or(tdbin::DecodeError::MalformedColumn)?),");
    expect(layout2).toContain("count: f8.get(i).copied().unwrap_or_default(),");
    for (const shadow of [
      "let r =",
      "let at =",
      "let w:",
      "let mut count",
      "let items:",
      "let mut items",
      "let mut rows =",
    ]) {
      expect(layout2.replaceAll("let mut rows = Vec::with_capacity(count);", "")).not.toContain(shadow);
    }
    expectRustModuleReproduces(NAMES_TD, "../../../../src/tdbin/tests/generated_names/mod.rs", { layout: 2 });
  });
});
