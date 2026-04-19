// [CONV-DART-TEST] Dart converter integration tests.
import { describe, expect, it } from "vitest";
import { dart } from "../../src/converters/index.js";
import { parse } from "../../src/parser/index.js";
import { buildModel } from "../../src/model/index.js";
import { expectLosslessRoundTrip, unwrap } from "./helpers.js";

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
    const model = unwrap(dart.fromSource(src));

    const ci = model.decls.find((d) => d.name === "ContentItem");
    expect(ci?.kind).toBe("union");
    const ciVariants = ci?.kind === "union" ? ci.variants : [];
    expect(ciVariants).toHaveLength(2);
    expect(ciVariants[0]?.name).toBe("Text");
    expect(ciVariants[0]?.fields[0]?.name).toBe("value");
    expect(ciVariants[0]?.fields[0]?.type.name).toBe("TextPart");
    expect(ciVariants[1]?.name).toBe("Url");
    expect(ciVariants[1]?.fields[0]?.type.name).toBe("String");

    const tp = model.decls.find((d) => d.name === "TextPart");
    expect(tp?.kind).toBe("record");

    const uk = model.decls.find((d) => d.name === "UriKind");
    expect(uk?.kind).toBe("union");
    const ukVariants = uk?.kind === "union" ? uk.variants : [];
    expect(ukVariants.map((v) => v.name)).toEqual(["image", "audio", "video"]);

    const email = model.decls.find((d) => d.name === "Email");
    expect(email?.kind).toBe("alias");
    expect(email?.kind === "alias" ? email.target.name : "").toBe("String");
  });

  it("maps nullable T? back to Option<T>", () => {
    const src = `
class UriPart {
  final String url;
  final String? mediaType;
  const UriPart(this.url, this.mediaType);
}
`;
    const model = unwrap(dart.fromSource(src));
    const up = model.decls.find((d) => d.name === "UriPart");
    expect(up?.kind).toBe("record");
    const fields = up?.kind === "record" ? up.fields : [];
    expect(fields.find((f) => f.name === "url")?.type.name).toBe("String");
    expect(fields.find((f) => f.name === "mediaType")?.type.name).toBe("Option");
    expect(fields.find((f) => f.name === "mediaType")?.type.args[0]?.name).toBe("String");
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
    const model = unwrap(buildModel(unwrap(parse(td))));
    const out = dart.toSource(model);

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
    const out = dart.toSource(unwrap(buildModel(unwrap(parse(td)))));
    expect(out).toContain("enum UriKind {");
    expect(out).toContain("Image, Audio, Video");
  });

  it("emits T? for Option<T> field types", () => {
    const td = `type UriPart { url: String\n media_type: Option<String> }`;
    const out = dart.toSource(unwrap(buildModel(unwrap(parse(td)))));
    expect(out).toContain("final String url;");
    expect(out).toContain("final String? media_type;");
  });
});

describe("[CONV-DART-RT] Dart round-trip TD -> Dart -> TD", () => {
  it("losslessly round-trips the home-page example through Dart (TD text preserved)", () => {
    expectLosslessRoundTrip(dart);
  });
});
