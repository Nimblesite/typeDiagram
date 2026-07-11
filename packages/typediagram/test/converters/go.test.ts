// [CONV-GO-TEST] Go converter integration tests.
import { describe, expect, it } from "vitest";
import { go } from "../../src/converters/index.js";
import {
  aliasTargetName,
  expectLosslessRoundTrip,
  findDecl,
  modelFromSource,
  recordFields,
  toSourceFromTd,
  unionVariants,
} from "./helpers.js";

describe("[CONV-GO-FROM-COMPLEX] complex Go -> typeDiagram", () => {
  it("parses a messy Go file with structs, interfaces, aliases, and noise", () => {
    const src =
      `
// Package types defines domain models.
package types

import (
	"context"
	"encoding/json"
	"fmt"
	"time"
)

// CalculateChecksum is a function — should be ignored.
func CalculateChecksum(data []byte) uint64 {
	var sum uint64
	for _, b := range data {
		sum += uint64(b)
	}
	return sum
}

const MaxRetries = 3

var ErrNotFound = fmt.Errorf("not found")

type ChatRequest struct {
	Message     string
	SessionID   string
	ToolResults []ToolResult
	Tags        []string
	Labels      map[string]string
	Ptr         *int64
	Active      bool
	Score       float64
	Count       int64
	Small       int8
	Medium      int32
	Big         uint64
	Tiny        uint8
	Char        rune
	Raw         byte
}

// Process is a method on ChatRequest — noise.
func (c ChatRequest) Process(ctx context.Context) error {
	return nil
}

type ToolResult struct {
	ToolCallID string ` +
      "`" +
      `json:"tool_call_id"` +
      "`" +
      `
	Name       string ` +
      "`" +
      `json:"name"` +
      "`" +
      `
	Content    string ` +
      "`" +
      `json:"content"` +
      "`" +
      `
	Ok         bool   ` +
      "`" +
      `json:"ok"` +
      "`" +
      `
}

// Processor is a random interface — parsed as union.
type Shape interface {
	isShape()
}

type ContentItem interface {
	Text
	Image
	Code
	Divider
}

type Empty interface {}

type Email = string
type IdMap = map[string]int64

// Helper function — noise.
func MarshalJSON(v interface{}) ([]byte, error) {
	return json.Marshal(v)
}

func init() {
	fmt.Println("init")
}

// Receiver method on ToolResult — noise
func (t ToolResult) Validate() bool {
	return t.Ok
}
`;
    const model = modelFromSource(go, src);

    // ChatRequest — 15 fields, all type mappings
    expect(findDecl(model, "ChatRequest")?.kind).toBe("record");
    const chatFields = recordFields(model, "ChatRequest");
    expect(chatFields).toHaveLength(15);
    expect(chatFields.find((f) => f.name === "Message")?.type.name).toBe("String");
    expect(chatFields.find((f) => f.name === "SessionID")?.type.name).toBe("String");
    expect(chatFields.find((f) => f.name === "ToolResults")?.type.name).toBe("List");
    expect(chatFields.find((f) => f.name === "ToolResults")?.type.args[0]?.name).toBe("ToolResult");
    expect(chatFields.find((f) => f.name === "Tags")?.type.name).toBe("List");
    expect(chatFields.find((f) => f.name === "Tags")?.type.args[0]?.name).toBe("String");
    expect(chatFields.find((f) => f.name === "Labels")?.type.name).toBe("Map");
    expect(chatFields.find((f) => f.name === "Labels")?.type.args[0]?.name).toBe("String");
    expect(chatFields.find((f) => f.name === "Labels")?.type.args[1]?.name).toBe("String");
    expect(chatFields.find((f) => f.name === "Ptr")?.type.name).toBe("Option");
    expect(chatFields.find((f) => f.name === "Ptr")?.type.args[0]?.name).toBe("Int");
    expect(chatFields.find((f) => f.name === "Active")?.type.name).toBe("Bool");
    expect(chatFields.find((f) => f.name === "Score")?.type.name).toBe("Float");
    expect(chatFields.find((f) => f.name === "Count")?.type.name).toBe("Int");
    expect(chatFields.find((f) => f.name === "Small")?.type.name).toBe("Int");
    expect(chatFields.find((f) => f.name === "Medium")?.type.name).toBe("Int");
    expect(chatFields.find((f) => f.name === "Big")?.type.name).toBe("Int");
    expect(chatFields.find((f) => f.name === "Tiny")?.type.name).toBe("Int");
    expect(chatFields.find((f) => f.name === "Char")?.type.name).toBe("Int");
    expect(chatFields.find((f) => f.name === "Raw")?.type.name).toBe("Int");

    // ToolResult — 4 fields, struct tags stripped
    expect(findDecl(model, "ToolResult")?.kind).toBe("record");
    const toolFields = recordFields(model, "ToolResult");
    expect(toolFields).toHaveLength(4);
    expect(toolFields.find((f) => f.name === "Ok")?.type.name).toBe("Bool");

    // Shape — interface with method → union
    expect(findDecl(model, "Shape")?.kind).toBe("union");

    // ContentItem — interface with embedded types → union variants
    expect(findDecl(model, "ContentItem")?.kind).toBe("union");
    const ciVariants = unionVariants(model, "ContentItem");
    expect(ciVariants).toHaveLength(4);
    expect(ciVariants[0]?.name).toBe("Text");
    expect(ciVariants[1]?.name).toBe("Image");
    expect(ciVariants[2]?.name).toBe("Code");
    expect(ciVariants[3]?.name).toBe("Divider");

    // Empty — empty interface → union with Unknown fallback
    expect(findDecl(model, "Empty")?.kind).toBe("union");
    expect(unionVariants(model, "Empty")[0]?.name).toBe("Unknown");

    // Aliases
    expect(findDecl(model, "Email")?.kind).toBe("alias");
    expect(aliasTargetName(model, "Email")).toBe("String");

    // IdMap — map alias (the regex picks up 'map' as a target, not perfectly)
    expect(findDecl(model, "IdMap")?.kind).toBe("alias");
  });

  it("skips aliases that collide with already-parsed struct/interface names", () => {
    const src = `
type Foo struct { Name string }
type Foo = string
`;
    const model = modelFromSource(go, src);
    expect(model.decls.filter((d) => d.name === "Foo")).toHaveLength(1);
    expect(model.decls[0]?.kind).toBe("record");
  });

  it("parses nested generics, marker-method unions, embedded interfaces, and malformed trailing bodies", () => {
    const src = `
type Box[T any, U comparable] struct {
  Items []map[string]Foo[int64, []string]
  Maybe *Foo[Bar[int64, string], Baz]
  Inline struct { Name string }
  NestedMap map[Foo[Bar]]string
  Broken map[string
  ignored
}

type Event interface {
  isEvent()
}

type EventCreated struct {
  ID string
  Labels map[string]map[string]int64
}

type EventEmpty struct {}

func (EventCreated) isEvent() {}
func (EventEmpty) isEvent() {}

type Embedded interface {
  // comment
  Text
  isEmbedded()
  Image
}

type Text struct {
  Body string
}

type Image struct {}
type Alias[T any] = Foo[T]
type Bad = struct
type AlsoBad = interface
type Missing struct {
`;
    const model = modelFromSource(go, src);
    const box = model.decls.find((d) => d.name === "Box");
    expect(box?.kind).toBe("record");
    expect(box?.generics).toEqual(["T", "U"]);
    const fields = recordFields(model, "Box");
    expect(fields.find((f) => f.name === "Items")?.type.name).toBe("List");
    expect(fields.find((f) => f.name === "Items")?.type.args[0]?.name).toBe("Map");
    expect(fields.find((f) => f.name === "Maybe")?.type.name).toBe("Option");
    expect(fields.find((f) => f.name === "Inline")?.type.name).toBe("struct { Name string }");
    expect(fields.find((f) => f.name === "NestedMap")?.type.args[0]?.name).toBe("Foo");
    expect(fields.find((f) => f.name === "Broken")?.type.name).toBe("map[string");

    expect(findDecl(model, "Event")?.kind).toBe("union");
    const eventVariants = unionVariants(model, "Event");
    expect(eventVariants.map((v) => v.name)).toEqual(["Created", "Empty"]);
    expect(eventVariants[0]?.fields[1]?.type.args[1]?.name).toBe("Map");
    expect(eventVariants[1]?.fields).toEqual([]);

    expect(findDecl(model, "Embedded")?.kind).toBe("union");
    expect(unionVariants(model, "Embedded").map((v) => v.name)).toEqual(["Text", "Image"]);

    const aliasDecl = model.decls.find((d) => d.name === "Alias");
    expect(aliasDecl?.kind).toBe("alias");
    expect(aliasDecl?.kind === "alias" ? aliasDecl.target.args[0]?.name : "").toBe("T");
    expect(model.decls.some((d) => d.name === "Bad")).toBe(false);
    expect(model.decls.some((d) => d.name === "AlsoBad")).toBe(false);
    expect(model.decls.some((d) => d.name === "Missing")).toBe(false);
  });

  it("returns error on Go file with only functions", () => {
    const src = `
package main

import "fmt"

func main() { fmt.Println("hello") }
func helper(x int) int { return x * 2 }
`;
    expect(go.fromSource(src).ok).toBe(false);
  });
});

describe("[CONV-GO-TO-COMPLEX] complex typeDiagram -> Go", () => {
  it("emits a big model with structs, interfaces, aliases, and all type mappings", () => {
    const td = `
type ChatRequest {
  message: String
  active: Bool
  score: Float
  count: Int
  raw: Bytes
  nothing: Unit
  tags: List<String>
  metadata: Map<String, Int>
  maybe: Option<String>
}

type GenericThing {
  value: String
}

union ContentItem {
  Text { body: String, format: String }
  Image { url: String, width: Int }
  Divider
}

union Direction { North\n South\n East\n West }

alias Email = String
`;
    const output = toSourceFromTd(go, td);

    // Package declaration
    expect(output).toContain("package types");

    // ChatRequest — all type mappings. Field names are preserved as-is
    // (lowercase) so TD -> Go -> TD is lossless.
    expect(output).toContain("type ChatRequest struct");
    expect(output).toContain("message string");
    expect(output).toContain("active bool");
    expect(output).toContain("score float64");
    expect(output).toContain("count int64");
    expect(output).toContain("raw []byte");
    expect(output).toContain("nothing struct{}");
    expect(output).toContain("tags []string");
    expect(output).toContain("metadata map[string]int64");
    expect(output).toContain("maybe *string");

    // ContentItem — interface + variant structs + marker methods. Variant
    // structs are qualified with the union name to avoid top-level collisions
    // (e.g. `Divider` would otherwise clash across unions).
    expect(output).toContain("type ContentItem interface");
    expect(output).toContain("isContentItem()");
    expect(output).toContain("type ContentItemText struct");
    expect(output).toContain("body string");
    expect(output).toContain("format string");
    expect(output).toContain("func (ContentItemText) isContentItem()");
    expect(output).toContain("type ContentItemImage struct");
    expect(output).toContain("func (ContentItemImage) isContentItem()");
    expect(output).toContain("type ContentItemDivider struct{}");
    expect(output).toContain("func (ContentItemDivider) isContentItem()");

    // Direction — all unit variants, also qualified.
    expect(output).toContain("type Direction interface");
    expect(output).toContain("type DirectionNorth struct{}");
    expect(output).toContain("type DirectionSouth struct{}");
    expect(output).toContain("func (DirectionNorth) isDirection()");

    // Alias
    expect(output).toContain("type Email = string");
  });
});

describe("[CONV-GO-RT] Go round-trip TD -> Go -> TD", () => {
  it("round-trips a complex model preserving structure", () => {
    const td = `
type User {
  name: String
  age: Int
  active: Bool
  score: Float
}

type Config {
  tags: List<String>
  metadata: Map<String, String>
  maybe: Option<Int>
}

union Shape {
  Circle { radius: Float }
  Rect { w: Float, h: Float }
  Point
}

alias Tag = String
`;
    const goCode = toSourceFromTd(go, td);
    const model2 = modelFromSource(go, goCode);

    // Go emits union variants as separate structs + an interface,
    // so re-parsing picks up: User, Config, Shape (union), Circle, Rect, Point, Tag
    expect(model2.decls.length).toBeGreaterThanOrEqual(4);

    expect(findDecl(model2, "User")?.kind).toBe("record");
    const userFields = recordFields(model2, "User");
    expect(userFields).toHaveLength(4);
    expect(userFields[0]?.type.name).toBe("String");
    expect(userFields[1]?.type.name).toBe("Int");
    expect(userFields[2]?.type.name).toBe("Bool");
    expect(userFields[3]?.type.name).toBe("Float");

    expect(findDecl(model2, "Config")?.kind).toBe("record");
    const cfgFields = recordFields(model2, "Config");
    expect(cfgFields).toHaveLength(3);
    // Field names are preserved verbatim (lowercase) for lossless round-trip.
    expect(cfgFields.find((f) => f.name === "tags")?.type.name).toBe("List");
    expect(cfgFields.find((f) => f.name === "metadata")?.type.name).toBe("Map");
    expect(cfgFields.find((f) => f.name === "maybe")?.type.name).toBe("Option");

    expect(findDecl(model2, "Shape")?.kind).toBe("union");

    expect(findDecl(model2, "Tag")?.kind).toBe("alias");
    expect(aliasTargetName(model2, "Tag")).toBe("String");
  });
});

describe("[CONV-GO-RT] Go round-trip TD -> Go -> TD", () => {
  it("losslessly round-trips the home-page example through Go (TD text preserved)", () => {
    expectLosslessRoundTrip(go);
  });
});
