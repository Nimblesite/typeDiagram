// [CONV-PHP-TEST] PHP converter integration tests.
import { describe, expect, it } from "vitest";
import { php } from "../../src/converters/index.js";
import {
  aliasTargetName,
  expectLosslessRoundTrip,
  findDecl,
  modelFromSource,
  recordFields,
  toSourceFromTd,
  unionVariants,
} from "./helpers.js";

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
    const output = toSourceFromTd(php, td);

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
    const model = modelFromSource(php, src);
    const boxed = findDecl(model, "Boxed");

    expect(boxed?.kind).toBe("alias");
    expect(boxed?.generics).toEqual(["T"]);
    expect(aliasTargetName(model, "Boxed")).toBe("T");
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
    const model = modelFromSource(php, src);
    const mappingFields = recordFields(model, "Mapping");

    expect(findDecl(model, "Flag")).toBeUndefined();
    expect(findDecl(model, "BrokenAlias")).toBeUndefined();
    expect(findDecl(model, "Mapping")?.kind).toBe("record");
    expect(mappingFields[0]?.type.name).toBe("Map");
    expect(mappingFields[0]?.type.args[0]?.name).toBe("String");
    expect(mappingFields[0]?.type.args[1]?.name).toBe("Int");
    expect(mappingFields[1]?.type.name).toBe("Option");
    expect(mappingFields[1]?.type.args[0]?.name).toBe("List");
    expect(mappingFields[1]?.type.args[0]?.args[0]?.name).toBe("String");
    expect(findDecl(model, "MissingKind")?.kind).toBe("record");
    expect(recordFields(model, "MissingKind")).toHaveLength(0);
    expect(findDecl(model, "NoCtor")?.kind).toBe("record");
    expect(recordFields(model, "NoCtor")).toHaveLength(0);
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
    const model = modelFromSource(php, src);
    const outcomeVariants = unionVariants(model, "Outcome");
    const holderFields = recordFields(model, "CollectionHolder");

    expect(findDecl(model, "Outcome")?.kind).toBe("union");
    expect(outcomeVariants).toHaveLength(1);
    expect(outcomeVariants[0]?.name).toBe("Success");
    expect(outcomeVariants[0]?.fields[0]?.name).toBe("message");
    expect(outcomeVariants[0]?.fields[0]?.type.name).toBe("String");
    expect(outcomeVariants[0]?.fields[1]?.type.name).toBe("\\App\\DTO\\User");
    expect(findDecl(model, "CollectionHolder")?.kind).toBe("record");
    expect(holderFields[0]?.type.name).toBe("List");
    expect(holderFields[0]?.type.args[0]?.name).toBe("\\App\\DTO\\User");
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
    const phpCode = toSourceFromTd(php, td);
    const model2 = modelFromSource(php, phpCode);

    const userFields = recordFields(model2, "User");
    expect(findDecl(model2, "User")?.kind).toBe("record");
    expect(userFields).toHaveLength(3);
    expect(userFields[0]?.type.name).toBe("Int");
    expect(userFields[1]?.type.name).toBe("List");
    expect(userFields[1]?.type.args[0]?.name).toBe("String");
    expect(userFields[2]?.type.name).toBe("Option");
    expect(userFields[2]?.type.args[0]?.name).toBe("String");

    const box = findDecl(model2, "Box");
    expect(box?.kind).toBe("record");
    expect(box?.generics).toEqual(["T"]);
    expect(recordFields(model2, "Box")[0]?.type.name).toBe("T");

    const result = findDecl(model2, "Result");
    const resultVariants = unionVariants(model2, "Result");
    expect(result?.kind).toBe("union");
    expect(result?.generics).toEqual(["T"]);
    expect(resultVariants).toHaveLength(2);
    expect(resultVariants[0]?.name).toBe("Ok");
    expect(resultVariants[0]?.fields[0]?.type.name).toBe("T");
    expect(resultVariants[1]?.name).toBe("Err");
    expect(resultVariants[1]?.fields[0]?.type.name).toBe("String");

    expect(findDecl(model2, "UserId")?.kind).toBe("alias");
    expect(aliasTargetName(model2, "UserId")).toBe("Int");

    const boxed = findDecl(model2, "Boxed");
    expect(boxed?.kind).toBe("alias");
    expect(boxed?.generics).toEqual(["T"]);
    expect(aliasTargetName(model2, "Boxed")).toBe("T");
  });

  it("losslessly round-trips the home-page example through PHP (TD text preserved)", () => {
    expectLosslessRoundTrip(php);
  });
});

describe("[CONV-PHP-EDGE] PHP converter edge cases", () => {
  it("emits an empty constructor for records with no fields", () => {
    const td = `type Empty {}\n`;
    const output = toSourceFromTd(php, td);
    expect(output).toContain("public function __construct() {}");
    expect(findDecl(modelFromSource(php, output), "Empty")?.kind).toBe("record");
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
    const code = toSourceFromTd(php, td);
    expect(code).toContain("public ?array $ids");
    expect(code).toContain("@param list<int>|null $ids");
    expect(code).toContain("@param array<string, int>|null $dict");
    const back = modelFromSource(php, code);
    expect(findDecl(back, "Wrap")?.kind).toBe("record");
    const wrapFields = recordFields(back, "Wrap");
    expect(wrapFields[0]?.type.name).toBe("Option");
    expect(wrapFields[0]?.type.args[0]?.name).toBe("List");
    expect(wrapFields[1]?.type.args[0]?.name).toBe("Map");
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
    const model = modelFromSource(php, src);
    expect(findDecl(model, "Odd")?.kind).toBe("record");
    expect(recordFields(model, "Odd").map((f) => f.name)).toEqual(["ok"]);
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
    const commentedFields = recordFields(modelFromSource(php, src), "Commented");
    expect(commentedFields.map((f) => f.name)).toEqual(["name", "age"]);
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
    const model = modelFromSource(php, src);
    expect(findDecl(model, "Shape")).toBeUndefined();
  });
});
