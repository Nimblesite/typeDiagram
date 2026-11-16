// [MODEL-WIDTH] [TDBIN-FUTURE-WIDTH-TYPES] (#85) Width-refined integers and the
// Path scalar: every converter emits its closest native type, codegen
// validation accepts them, and Rust reads them back precisely.
import { describe, expect, it } from "vitest";
import { byLanguage, rust } from "../../src/converters/index.js";
import type { Language } from "../../src/converters/index.js";
import { generateOspreyModule } from "../../src/converters/osprey.js";
import { generateSwiftModule } from "../../src/converters/swift.js";
import { buildModel, validateForCodegen } from "../../src/model/index.js";
import { parse } from "../../src/parser/index.js";
import { recordFields, unwrap } from "./helpers.js";

const WIDTH_TD = `type Stats {
  delta: I32
  flags: U8
  port: U16
  hits: U32
  hash: U64
  count: Size
  file: Path
  maybeHash: Option<U64>
  sizes: List<Size>
  bytes: List<U8>
}`;

const EXPECTED: Record<Language, readonly string[]> = {
  typescript: [
    "delta: number",
    "flags: number",
    "port: number",
    "hits: number",
    "hash: bigint",
    "count: number",
    "file: string",
    "maybeHash: bigint | undefined",
    "sizes: Array<number>",
  ],
  python: ["delta: int", "hash: int", "count: int", "file: str", "sizes: list[int]"],
  typeshed: ["delta: int", "hash: int", "file: str"],
  rust: [
    "pub delta: i32,",
    "pub flags: u8,",
    "pub port: u16,",
    "pub hits: u32,",
    "pub hash: u64,",
    "pub count: usize,",
    "pub file: std::path::PathBuf,",
    "pub maybe_hash: Option<u64>,",
    "pub sizes: Vec<usize>,",
    "pub bytes: Vec<u8>,",
  ],
  go: ["int32", "uint8", "uint16", "uint32", "uint64", "uint", "file string"],
  csharp: ["int delta", "byte flags", "ushort port", "uint hits", "ulong hash", "ulong count", "string file"],
  fsharp: [
    "delta: int",
    "flags: byte",
    "port: uint16",
    "hits: uint32",
    "hash: uint64",
    "count: uint64",
    "file: string",
  ],
  dart: ["final int delta;", "final int hash;", "final String file;"],
  protobuf: ["int32 delta", "uint32 flags", "uint32 port", "uint32 hits", "uint64 hash", "uint64 count", "string file"],
  php: ["int $delta", "int $hash", "string $file"],
};

describe("[MODEL-WIDTH] width-refined integers and Path across converters (#85)", () => {
  it("validates, emits native types in every language, and imports Rust widths precisely", () => {
    const model = unwrap(buildModel(unwrap(parse(WIDTH_TD))));
    for (const language of Object.keys(EXPECTED) as Language[]) {
      expect(validateForCodegen(model, language)).toEqual([]);
      const source = byLanguage[language].toSource(model);
      for (const snippet of EXPECTED[language]) {
        expect(source, `${language}: ${snippet}`).toContain(snippet);
      }
      expect(source).not.toMatch(/\bU64\b|\bU32\b|\bSize\b|\bPath\b/);
    }
    const swift = unwrap(generateSwiftModule(model));
    for (const snippet of ["Int32", "UInt8", "UInt16", "UInt32", "UInt64", "UInt", "String"]) {
      expect(swift).toContain(snippet);
    }
    expect(unwrap(generateOspreyModule(model))).not.toContain("U64");
    const back = unwrap(
      rust.fromSource(
        "pub struct Stats {\n    pub a: i32,\n    pub b: u8,\n    pub c: u16,\n    pub d: u32,\n    pub e: u64,\n    pub f: usize,\n    pub g: std::path::PathBuf,\n    pub h: PathBuf,\n    pub i: i64,\n    pub j: i16,\n}\n"
      )
    );
    expect(recordFields(back, "Stats").map((f) => f.type.name)).toEqual([
      "I32",
      "U8",
      "U16",
      "U32",
      "U64",
      "Size",
      "Path",
      "Path",
      "Int",
      "Int",
    ]);
  });
});
