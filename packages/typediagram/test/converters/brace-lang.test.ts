// [CONV-BRACE-LANG-TEST] Tests for the shared brace-language helpers.
import { describe, expect, it } from "vitest";
import {
  extractBalancedBlock,
  extractTrailingNullable,
  formatGenericsDecl,
  parseGenericParamList,
  splitTopLevelCommas,
} from "../../src/converters/brace-lang.js";

describe("[CONV-BRACE-LANG] extractBalancedBlock", () => {
  it("returns null when the open-index character isn't the opening delimiter", () => {
    expect(extractBalancedBlock("abc{def}", 0, "{", "}")).toBeNull();
  });

  it("returns null when no matching closing delimiter exists", () => {
    expect(extractBalancedBlock("{unterminated", 0, "{", "}")).toBeNull();
  });

  it("returns inner contents with nested braces balanced", () => {
    const src = "{a{b}c}";
    expect(extractBalancedBlock(src, 0, "{", "}")).toBe("a{b}c");
  });
});

describe("[CONV-BRACE-LANG] splitTopLevelCommas", () => {
  it("splits plain comma-separated values", () => {
    expect(splitTopLevelCommas("a, b, c")).toEqual(["a", "b", "c"]);
  });

  it("respects angle-bracket depth", () => {
    expect(splitTopLevelCommas("Map<String, Int>, Foo")).toEqual(["Map<String, Int>", "Foo"]);
  });

  it("returns [] for empty input", () => {
    expect(splitTopLevelCommas("")).toEqual([]);
  });
});

describe("[CONV-BRACE-LANG] formatGenericsDecl", () => {
  it("returns empty string for empty generics", () => {
    expect(formatGenericsDecl([])).toBe("");
  });

  it("formats a single generic parameter", () => {
    expect(formatGenericsDecl(["T"])).toBe("<T>");
  });

  it("formats multiple generic parameters", () => {
    expect(formatGenericsDecl(["T", "U"])).toBe("<T, U>");
  });
});

describe("[CONV-BRACE-LANG] extractTrailingNullable", () => {
  it("returns the inner type for `T?`", () => {
    expect(extractTrailingNullable("string?")).toBe("string");
  });

  it("returns null for non-nullable types", () => {
    expect(extractTrailingNullable("string")).toBeNull();
  });
});

describe("[CONV-BRACE-LANG] parseGenericParamList", () => {
  it("returns [] for undefined input", () => {
    expect(parseGenericParamList(undefined)).toEqual([]);
  });

  it("returns [] for empty string", () => {
    expect(parseGenericParamList("")).toEqual([]);
  });

  it("parses a plain comma-separated list", () => {
    expect(parseGenericParamList("T, U")).toEqual(["T", "U"]);
  });

  it("strips `extends` constraints", () => {
    expect(parseGenericParamList("T extends Foo, U")).toEqual(["T", "U"]);
  });

  it("strips Go-style trailing constraints like `T any`", () => {
    expect(parseGenericParamList("T any, U comparable")).toEqual(["T", "U"]);
  });
});
