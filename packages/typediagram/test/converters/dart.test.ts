// [CONV-DART-TEST] Dart converter integration tests.
import { describe, expect, it } from "vitest";
import { dart } from "../../src/converters/index.js";
import {
  aliasTargetName,
  expectFieldTypes,
  expectLosslessRoundTrip,
  findDecl,
  modelFromSource,
  recordFields,
  toSourceFromTd,
  unionVariants,
} from "./helpers.js";

describe("[CONV-DART-FROM] Dart -> typeDiagram", () => {
  it("parses sealed-class DUs, regular classes, enums, and typedefs", () => {
    const src = `
sealed class ContentItem {
  const ContentItem();
}

final class Text extends ContentItem {
  final TextPart value;
  const Text(this.value);
}

final class Url extends ContentItem {
  final String url;
  const Url(this.url);
}

class TextPart {
  final String text;
  const TextPart(this.text);
}

enum UriKind { image, audio, video }

typedef Email = String;
`;
    const model = modelFromSource(dart, src);

    expect(findDecl(model, "ContentItem")?.kind).toBe("union");
    const ciVariants = unionVariants(model, "ContentItem");
    expect(ciVariants).toHaveLength(2);
    expect(ciVariants[0]?.name).toBe("Text");
    expect(ciVariants[0]?.fields[0]?.name).toBe("value");
    expect(ciVariants[0]?.fields[0]?.type.name).toBe("TextPart");
    expect(ciVariants[1]?.name).toBe("Url");
    expect(ciVariants[1]?.fields[0]?.type.name).toBe("String");

    expect(findDecl(model, "TextPart")?.kind).toBe("record");

    expect(findDecl(model, "UriKind")?.kind).toBe("union");
    const ukVariants = unionVariants(model, "UriKind");
    expect(ukVariants.map((v) => v.name)).toEqual(["image", "audio", "video"]);

    expect(findDecl(model, "Email")?.kind).toBe("alias");
    expect(aliasTargetName(model, "Email")).toBe("String");
  });

  it("maps nullable T? back to Option<T>", () => {
    const src = `
class UriPart {
  final String url;
  final String? mediaType;
  const UriPart(this.url, this.mediaType);
}
`;
    const model = modelFromSource(dart, src);
    expect(findDecl(model, "UriPart")?.kind).toBe("record");
    const fields = recordFields(model, "UriPart");
    expectFieldTypes(fields, { url: "String", mediaType: "Option<String>" });
  });

  it("returns error on Dart with only functions", () => {
    const src = `void main() { print("hi"); }`;
    expect(dart.fromSource(src).ok).toBe(false);
  });
});

describe("[CONV-DART-TO] typeDiagram -> Dart", () => {
  it("emits sealed-class DU with extending final classes", () => {
    const td = `
union ContentItem {
  Text { value: TextPart }
  Url  { url: String }
  Scalar { value: String }
}

type TextPart {
  text: String
}

alias Email = String
`;
    const out = toSourceFromTd(dart, td);

    expect(out).toContain("sealed class ContentItem {");
    expect(out).toContain("final class Text extends ContentItem {");
    expect(out).toContain("final TextPart value;");
    expect(out).toContain("final class Url extends ContentItem {");
    expect(out).toContain("final class Scalar extends ContentItem {");
    expect(out).toContain("class TextPart {");
    expect(out).toContain("typedef Email = String;");
  });

  it("emits bare enum for unit-only unions", () => {
    const td = `union UriKind { Image\n Audio\n Video }`;
    const out = toSourceFromTd(dart, td);
    expect(out).toContain("enum UriKind {");
    expect(out).toContain("Image, Audio, Video");
  });

  it("emits T? for Option<T> field types", () => {
    const td = `type UriPart { url: String\n media_type: Option<String> }`;
    const out = toSourceFromTd(dart, td);
    expect(out).toContain("final String url;");
    expect(out).toContain("final String? media_type;");
  });
});

describe("[CONV-DART-RT] Dart round-trip TD -> Dart -> TD", () => {
  it("losslessly round-trips the home-page example through Dart (TD text preserved)", () => {
    expectLosslessRoundTrip(dart);
  });
});

describe("[CONV-DART-ERR] error + misc paths", () => {
  it("returns error on source with no classes or enums", () => {
    expect(dart.fromSource("import 'dart:async';\n").ok).toBe(false);
  });

  it("parses an empty enum body as a union with no variants", () => {
    const model = modelFromSource(dart, "enum Empty { }");
    const empty = model.decls.find((d) => d.name === "Empty");
    expect(empty?.kind).toBe("union");
  });

  it("skips malformed field lines inside a class body", () => {
    // The first "field" lacks a type; only the well-formed `bool ok` survives.
    const src = `
class Foo {
  final ;
  final bool ok;
  const Foo(this.ok);
}
`;
    const fields = recordFields(modelFromSource(dart, src), "Foo");
    expect(fields.map((f) => f.name)).toEqual(["ok"]);
  });
});

describe("[CONV-DART-EDGE] edge cases", () => {
  it("emits generics on sealed classes and extending variants", () => {
    const td = `union Box<T> { Some { value: T }\n None }`;
    const out = toSourceFromTd(dart, td);
    expect(out).toContain("sealed class Box<T>");
    expect(out).toContain("final class Some<T> extends Box<T>");
    expect(out).toContain("final class None<T> extends Box<T>");
  });

  it("preserves generics on records via (Generic<T>)-free first-class params", () => {
    const td = `type Box<T> { value: T }`;
    const out = toSourceFromTd(dart, td);
    expect(out).toContain("class Box<T> {");
    const back = modelFromSource(dart, out);
    const box = back.decls.find((d) => d.name === "Box");
    expect(box?.generics).toEqual(["T"]);
  });

  it("parses variant classes that use `implements` instead of `extends`", () => {
    const src = `
sealed class Shape { const Shape(); }

final class Circle implements Shape {
  final double radius;
  const Circle(this.radius);
}
`;
    const model = modelFromSource(dart, src);
    expect(findDecl(model, "Shape")?.kind).toBe("union");
    const variants = unionVariants(model, "Shape");
    expect(variants).toHaveLength(1);
    expect(variants[0]?.name).toBe("Circle");
  });
});
