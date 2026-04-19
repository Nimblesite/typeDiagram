// [CONV-PHP-TEST] PHP converter integration tests.
import { describe, expect, it } from "vitest";
import { php } from "../../src/converters/index.js";
import { parse } from "../../src/parser/index.js";
import { buildModel } from "../../src/model/index.js";
import { expectLosslessRoundTrip, unwrap } from "./helpers.js";

describe("[CONV-PHP-TO-COMPLEX] complex typeDiagram -> PHP", () => {
  it("emits readonly DTOs, PHPStan refinements, unions, and alias wrappers", () => {
    const td = `
type User {
  id: Int
  name: String
}

type Box<T> {
  value: T
}

type Paged {
  items: List<String>
}

type Config {
  data: Map<String, Int>
}

type Opt {
  label: Option<String>
}

type MaybeBox<T> {
  value: Option<T>
}

union Shape {
  Circle { radius: Float }
  Rectangle { width: Float, height: Float }
}

union Result<T> {
  Ok { value: T }
  Err { message: String }
}

alias UserId = Int
alias Boxed<T> = T
alias Nothing = Unit

type MaybeNothing {
  value: Option<Unit>
}
`;
    const model = unwrap(buildModel(unwrap(parse(td))));
    const output = php.toSource(model);

    expect(output).toContain("<?php");
    expect(output).toContain("declare(strict_types=1);");
    expect(output).toContain("final readonly class User");
    expect(output).toContain("public int $id");
    expect(output).toContain("public string $name");
    expect(output).toContain("@template T");
    expect(output).toContain("public mixed $value");
    expect(output).toContain("@param T $value");
    expect(output).toContain("public array $items");
    expect(output).toContain("@param list<string> $items");
    expect(output).toContain("@param array<string, int> $data");
    expect(output).toContain("public ?string $label");
    expect(output).toContain("@param T|null $value");
    expect(output).toContain("interface Shape");
    expect(output).toContain("final readonly class Circle implements Shape");
    expect(output).toContain("final readonly class Rectangle implements Shape");
    expect(output).toContain("/** @var 'Circle' */");
    expect(output).toContain("/** @var 'Rectangle' */");
    expect(output).toContain("$this->kind = 'Circle';");
    expect(output).toContain("$this->kind = 'Rectangle';");
    expect(output).toContain("@implements Result<T>");
    expect(output).toContain("@typediagram-kind alias");
    expect(output).toContain("final readonly class UserId");
    expect(output).toContain("final readonly class Nothing");
    expect(output).toContain("final readonly class MaybeNothing");
    expect(output).toContain("public null $value,");
  });
});

describe("[CONV-PHP-FROM] PHP -> typeDiagram", () => {
  it("parses alias-only PHP DTO input", () => {
    const src = `<?php

declare(strict_types=1);

/**
 * @template T
 * @typediagram-kind alias
 */
final readonly class Boxed
{
    /**
     * @param T $value
     */
    public function __construct(
        public mixed $value,
    ) {}
}
`;
    const model = unwrap(php.fromSource(src));
    const boxed = model.decls.find((decl) => decl.name === "Boxed");

    expect(boxed?.kind).toBe("alias");
    expect(boxed?.generics).toEqual(["T"]);
    expect(boxed?.kind === "alias" ? boxed.target.name : "").toBe("T");
  });

  it("returns an error when no supported DTO definitions are present", () => {
    const src = `<?php

declare(strict_types=1);

function helper(): void {}
`;
    const result = php.fromSource(src);

    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error[0]?.message).toBe("No supported PHP DTO definitions found");
  });
  it("parses refined arrays, ignores empty interfaces, and skips broken alias wrappers", () => {
    const src = `<?php

declare(strict_types=1);

interface Flag
{
}

final readonly class MissingKind implements Flag
{
    public function __construct() {}
}

final readonly class Mapping
{
    /**
     * @param array<string, int> $data
     * @param list<string>|null $labels
     */
    public function __construct(
        public array $data,
        public ?array $labels = null,
    ) {}
}

/** @typediagram-kind alias */
final readonly class BrokenAlias
{
    public function __construct(
        public int $id,
    ) {}
}

final readonly class NoCtor
{
}
`;
    const model = unwrap(php.fromSource(src));
    const mapping = model.decls.find((decl) => decl.name === "Mapping");
    const missingKind = model.decls.find((decl) => decl.name === "MissingKind");
    const noCtor = model.decls.find((decl) => decl.name === "NoCtor");

    expect(model.decls.find((decl) => decl.name === "Flag")).toBeUndefined();
    expect(model.decls.find((decl) => decl.name === "BrokenAlias")).toBeUndefined();
    expect(mapping?.kind).toBe("record");
    expect(mapping?.kind === "record" ? mapping.fields[0]?.type.name : "").toBe("Map");
    expect(mapping?.kind === "record" ? mapping.fields[0]?.type.args[0]?.name : "").toBe("String");
    expect(mapping?.kind === "record" ? mapping.fields[0]?.type.args[1]?.name : "").toBe("Int");
    expect(mapping?.kind === "record" ? mapping.fields[1]?.type.name : "").toBe("Option");
    expect(mapping?.kind === "record" ? mapping.fields[1]?.type.args[0]?.name : "").toBe("List");
    expect(mapping?.kind === "record" ? mapping.fields[1]?.type.args[0]?.args[0]?.name : "").toBe("String");
    expect(missingKind?.kind).toBe("record");
    expect(missingKind?.kind === "record" ? missingKind.fields : []).toHaveLength(0);
    expect(noCtor?.kind).toBe("record");
    expect(noCtor?.kind === "record" ? noCtor.fields : []).toHaveLength(0);
  });

  it("parses namespaced types, array item docblocks, double-quoted kind tags, and defaults with commas", () => {
    const src = `<?php

declare(strict_types=1);

interface Outcome
{
}

final readonly class Success implements Outcome
{
    /** @var "Success" */
    public string $kind;

    public function __construct(
        public string $message = "Hello, world" /* keep, comment */,
        public \\App\\DTO\\User $user,
    ) {
        $this->kind = "Success";
    }
}

final readonly class CollectionHolder
{
    /**
     * @param array<\\App\\DTO\\User> $users
     */
    public function __construct(
        public array $users,
    ) {}
}
`;
    const model = unwrap(php.fromSource(src));
    const outcome = model.decls.find((decl) => decl.name === "Outcome");
    const holder = model.decls.find((decl) => decl.name === "CollectionHolder");

    expect(outcome?.kind).toBe("union");
    expect(outcome?.kind === "union" ? outcome.variants.length : 0).toBe(1);
    expect(outcome?.kind === "union" ? outcome.variants[0]?.name : "").toBe("Success");
    expect(outcome?.kind === "union" ? outcome.variants[0]?.fields[0]?.name : "").toBe("message");
    expect(outcome?.kind === "union" ? outcome.variants[0]?.fields[0]?.type.name : "").toBe("String");
    expect(outcome?.kind === "union" ? outcome.variants[0]?.fields[1]?.type.name : "").toBe("\\App\\DTO\\User");
    expect(holder?.kind).toBe("record");
    expect(holder?.kind === "record" ? holder.fields[0]?.type.name : "").toBe("List");
    expect(holder?.kind === "record" ? holder.fields[0]?.type.args[0]?.name : "").toBe("\\App\\DTO\\User");
  });
});

describe("[CONV-PHP-RT] PHP round-trip TD -> PHP -> TD", () => {
  it("round-trips records, unions, aliases, generics, and refined arrays preserving structure", () => {
    const td = `
type User {
  id: Int
  tags: List<String>
  label: Option<String>
}

type Box<T> {
  value: T
}

union Result<T> {
  Ok { value: T }
  Err { message: String }
}

alias UserId = Int
alias Boxed<T> = T
alias Nothing = Unit

type MaybeNothing {
  value: Option<Unit>
}
`;
    const model1 = unwrap(buildModel(unwrap(parse(td))));
    const phpCode = php.toSource(model1);
    const model2 = unwrap(php.fromSource(phpCode));

    const user = model2.decls.find((decl) => decl.name === "User");
    expect(user?.kind).toBe("record");
    expect(user?.kind === "record" ? user.fields.length : 0).toBe(3);
    expect(user?.kind === "record" ? user.fields[0]?.type.name : "").toBe("Int");
    expect(user?.kind === "record" ? user.fields[1]?.type.name : "").toBe("List");
    expect(user?.kind === "record" ? user.fields[1]?.type.args[0]?.name : "").toBe("String");
    expect(user?.kind === "record" ? user.fields[2]?.type.name : "").toBe("Option");
    expect(user?.kind === "record" ? user.fields[2]?.type.args[0]?.name : "").toBe("String");

    const box = model2.decls.find((decl) => decl.name === "Box");
    expect(box?.kind).toBe("record");
    expect(box?.generics).toEqual(["T"]);
    expect(box?.kind === "record" ? box.fields[0]?.type.name : "").toBe("T");

    const result = model2.decls.find((decl) => decl.name === "Result");
    expect(result?.kind).toBe("union");
    expect(result?.generics).toEqual(["T"]);
    expect(result?.kind === "union" ? result.variants.length : 0).toBe(2);
    expect(result?.kind === "union" ? result.variants[0]?.name : "").toBe("Ok");
    expect(result?.kind === "union" ? result.variants[0]?.fields[0]?.type.name : "").toBe("T");
    expect(result?.kind === "union" ? result.variants[1]?.name : "").toBe("Err");
    expect(result?.kind === "union" ? result.variants[1]?.fields[0]?.type.name : "").toBe("String");

    const userId = model2.decls.find((decl) => decl.name === "UserId");
    expect(userId?.kind).toBe("alias");
    expect(userId?.kind === "alias" ? userId.target.name : "").toBe("Int");

    const boxed = model2.decls.find((decl) => decl.name === "Boxed");
    expect(boxed?.kind).toBe("alias");
    expect(boxed?.generics).toEqual(["T"]);
    expect(boxed?.kind === "alias" ? boxed.target.name : "").toBe("T");
  });

  it("losslessly round-trips the home-page example through PHP (TD text preserved)", () => {
    expectLosslessRoundTrip(php);
  });
});

describe("[CONV-PHP-EDGE] PHP converter edge cases", () => {
  it("emits an empty constructor for records with no fields", () => {
    const td = `type Empty {}\n`;
    const model = unwrap(buildModel(unwrap(parse(td))));
    const output = php.toSource(model);
    expect(output).toContain("public function __construct() {}");
    expect(unwrap(php.fromSource(output)).decls.find((d) => d.name === "Empty")?.kind).toBe("record");
  });

  it("round-trips Option<List<T>> and Option<Map<K,V>>", () => {
    // Note: Option<Unit> is NOT round-trippable because both Unit and
    // Option<Unit> map to PHP `null` native type with no docblock — the
    // nullability information is indistinguishable on parse. HOME_PAGE_SAMPLE
    // does not use Option<Unit>, so the lossless test above still holds.
    const td = `type Wrap {
  ids: Option<List<Int>>
  dict: Option<Map<String, Int>>
}
`;
    const code = php.toSource(unwrap(buildModel(unwrap(parse(td)))));
    expect(code).toContain("public ?array $ids");
    expect(code).toContain("@param list<int>|null $ids");
    expect(code).toContain("@param array<string, int>|null $dict");
    const wrap = unwrap(php.fromSource(code)).decls.find((d) => d.name === "Wrap");
    expect(wrap?.kind).toBe("record");
    if (wrap?.kind !== "record") return;
    expect(wrap.fields[0]?.type.name).toBe("Option");
    expect(wrap.fields[0]?.type.args[0]?.name).toBe("List");
    expect(wrap.fields[1]?.type.args[0]?.name).toBe("Map");
  });

  it("skips constructor params without the 'public' promotion keyword", () => {
    const src = `<?php
final readonly class Odd
{
    public function __construct(
        private int $hidden,
        public int $ok,
    ) {}
}
`;
    const odd = unwrap(php.fromSource(src)).decls.find((d) => d.name === "Odd");
    expect(odd?.kind).toBe("record");
    expect(odd?.kind === "record" ? odd.fields.map((f) => f.name) : []).toEqual(["ok"]);
  });

  it("tolerates // and /* */ comments and string literals inside class bodies", () => {
    const src = `<?php
final readonly class Commented
{
    // public int $ignored;
    /* public int $alsoIgnored; */
    public function __construct(
        public string $name,
        public int $age,
    ) {
        $greeting = "hello { ' } world";
    }
}
`;
    const commented = unwrap(php.fromSource(src)).decls.find((d) => d.name === "Commented");
    expect(commented?.kind === "record" ? commented.fields.map((f) => f.name) : []).toEqual(["name", "age"]);
  });

  it("drops union variants whose $kind literal does not match the class name", () => {
    const src = `<?php
interface Shape
{
}

final readonly class Circle implements Shape
{
    /** @var 'NotCircle' */
    public string $kind;
    public function __construct(
        public float $radius,
    ) {
        $this->kind = 'NotCircle';
    }
}
`;
    const model = unwrap(php.fromSource(src));
    expect(model.decls.find((d) => d.name === "Shape")).toBeUndefined();
  });
});
