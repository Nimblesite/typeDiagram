// [TYPESHED-CONVERT-TEST] Realistic .pyi constructs -> typeDiagram model.
import { describe, expect, it } from "vitest";
import { typeshed } from "../../src/converters/index.js";
import { printSource } from "../../src/model/index.js";
import { unwrap } from "../helpers.js";
import { modelFromTd } from "../helpers.js";

const STUB_SOURCE = `
from dataclasses import dataclass
from enum import IntEnum
from typing import ClassVar, Generic, NamedTuple, Protocol, TypeAlias, TypedDict, TypeVar, overload

T = TypeVar("T")

class Service(Protocol):
    endpoint: str
    def connect(self, timeout: float = ...) -> bool: ...

@dataclass(frozen=True)
class Payload(Generic[T]):
    value: T
    tags: list[str]
    cache: ClassVar[dict[str, T]]
    def encode(self) -> bytes: ...

class Movie(TypedDict, total=False):
    title: str
    year: int

class Coordinates(NamedTuple):
    x: float
    y: float

class Status(IntEnum):
    READY = 1
    DONE = 2

PathList: TypeAlias = list[str] | None
type Lookup[K, V] = dict[K, V]

@overload
def read(path: str) -> bytes: ...
@overload
def read(path: bytes, limit: int = ...) -> bytes: ...

if sys.version_info >= (3, 11):
    async def refresh(payload: Payload[str]) -> Movie: ...
`;

describe("[TYPESHED-CONVERT] typeshed -> typeDiagram", () => {
  it("retains classes, dataclass fields, aliases, module functions, and overloads while excluding methods", () => {
    const analyzed = unwrap(typeshed.analyzeSource(STUB_SOURCE));
    const { model, stats } = analyzed;
    expect(stats).toEqual({ declarationsSeen: 10, declarationsConverted: 10, methodsSkipped: 2 });
    expect(model.decls.map((decl) => decl.name)).toEqual([
      "Service",
      "Payload",
      "Movie",
      "Coordinates",
      "Status",
      "PathList",
      "Lookup",
      "read",
      "refresh",
    ]);

    const service = model.decls.find((decl) => decl.name === "Service");
    const payload = model.decls.find((decl) => decl.name === "Payload");
    const status = model.decls.find((decl) => decl.name === "Status");
    const read = model.decls.find((decl) => decl.name === "read");
    expect(service?.kind === "record" ? service.fields.map((field) => field.name) : []).toEqual(["endpoint"]);
    expect(payload?.kind === "record" ? payload.generics : []).toEqual(["T"]);
    expect(payload?.kind === "record" ? payload.fields.map((field) => field.name) : []).toEqual(["value", "tags"]);
    expect(status?.kind === "union" ? status.variants.map((variant) => variant.name) : []).toEqual(["READY", "DONE"]);
    expect(read?.kind === "function" ? read.signatures : []).toHaveLength(2);
    expect(read?.kind === "function" ? read.signatures[1]?.params[1]?.type.name : undefined).toBe("Int");
    expect(model.decls.some((decl) => decl.name === "connect" || decl.name === "encode")).toBe(false);

    const td = printSource(model);
    expect(td).toContain("type Payload<T>");
    expect(td).toContain("alias PathList = Option<List<String>>");
    expect(td).toContain("alias Lookup<K, V> = Map<K, V>");
    expect(td).toContain("function read {");
    expect(td).toContain("async function refresh(payload: Payload<String>) -> Movie");
    expect(unwrap(typeshed.fromSource(STUB_SOURCE)).decls).toHaveLength(9);
  });

  it("reports malformed stubs and source with no type declarations as Result errors", () => {
    expect(typeshed.fromSource("def broken(: ...").ok).toBe(false);
    expect(typeshed.fromSource("VALUE = 42\n").ok).toBe(false);
  });

  it("normalizes advanced annotations, variadics, aliases, conditional duplicates, keywords, and generic arity", () => {
    const source = `
import typing
from typing import Annotated, Callable, ClassVar, Final, Generic, Literal, Mapping, NewType, TypeAlias, TypeVar, Union
from typing_extensions import TypeAliasType

_T2 = TypeVar("_T2")

if sys.platform == "win32":
    class Box(Generic[_T2]):
        first: _T2
        type: type[object]
        ignored: ClassVar[str]
else:
    class Box(Generic[_T2]):
        second: str

class KeywordNames:
    alias: str
    function: bytes
    constant = 3

class Mode(Flag):
    _PRIVATE = 0
    READ = 1

AliasNew = NewType("AliasNew", int)
AliasOther = TypeAliasType("AliasOther", str)
ForwardAlias = "Box"
UPPER = str
factory_value = Factory()
Explicit: TypeAlias = Union[int, str]
type Pair[A, B] = tuple[A, B]

def use(box: Box, expanded: Box[int, str], *args: str, **kwargs: int) -> None: ...
def untyped(value) -> typing.Any: ...

class Exotic:
    qualified: typing.Any
    nothing: None
    truth: Literal[True]
    negative: Literal[-1]
    optional: int | None
    choice: int | str | None
    callback: Callable[[str, int], bytes]
    variadic: Callable[..., Any]
    tupled: tuple[str, ...]
    wrapped: Annotated[str, "metadata"]
    mapping: Mapping[str, int]
    raw: bytearray
    complex_forward: "list[str]"
    generated: Factory()
`;
    const { model, stats } = unwrap(typeshed.analyzeSource(source));
    const box = model.decls.find((decl) => decl.name === "Box");
    const keywords = model.decls.find((decl) => decl.name === "KeywordNames");
    const mode = model.decls.find((decl) => decl.name === "Mode");
    const use = model.decls.find((decl) => decl.name === "use");
    const exotic = model.decls.find((decl) => decl.name === "Exotic");
    expect(stats.declarationsSeen).toBe(12);
    expect(box?.kind === "record" ? box.generics : []).toEqual(["_T2", "_T3"]);
    expect(box?.kind === "record" ? box.fields.map((field) => field.name) : []).toEqual(["first", "type_", "second"]);
    expect(keywords?.kind === "record" ? keywords.fields.map((field) => field.name) : []).toEqual([
      "alias_",
      "function_",
    ]);
    expect(mode?.kind === "union" ? mode.variants.map((variant) => variant.name) : []).toEqual(["READ"]);
    expect(use?.kind === "function" ? use.signatures[0]?.params.map((param) => param.type.name) : []).toEqual([
      "Box",
      "Box",
      "List",
      "Map",
    ]);
    expect(use?.kind === "function" ? use.signatures[0]?.params[0]?.type.args.map((arg) => arg.name) : []).toEqual([
      "Any",
      "Any",
    ]);
    expect(model.decls.some((decl) => decl.name === "UPPER" || decl.name === "factory_value")).toBe(false);
    expect(model.decls.find((decl) => decl.name === "AliasNew")?.kind).toBe("alias");
    expect(model.decls.find((decl) => decl.name === "AliasOther")?.kind).toBe("alias");
    expect(model.decls.find((decl) => decl.name === "ForwardAlias")?.kind).toBe("alias");
    expect(exotic?.kind === "record" ? exotic.fields.map((field) => field.type.name) : []).toEqual([
      "Any",
      "Unit",
      "Bool",
      "Int",
      "Option",
      "Option",
      "Callable",
      "Callable",
      "tuple",
      "String",
      "Map",
      "Bytes",
      "Any",
      "Any",
    ]);
    expect(printSource(model)).toContain("function use(box: Box<Any, Any>");
  });

  it("emits complete .pyi source for records, unions, aliases, functions, overloads, async, and imports", () => {
    const model = modelFromTd(`
type Empty {}
type Box<T> { value: T }
union EmptyState {}
union State { Ready Busy }
alias Name = String
function ping(value: Int) -> Bool
function fetch {
  (name: String) -> Bytes
  async (name: String, fallback: Option<Bytes>) -> Bytes
}
@skipTargets(typeshed)
type Hidden { value: String }
`);
    const pyi = typeshed.toSource(model);
    expect(pyi).toContain("from enum import Enum");
    expect(pyi).toContain("from typing import overload");
    expect(pyi).toContain("from typing import Optional");
    expect(pyi).toContain("class Empty:\n    ...");
    expect(pyi).toContain("class Box[T]:\n    value: T");
    expect(pyi).toContain("class EmptyState(Enum):\n    ...");
    expect(pyi).toContain("class State(Enum):\n    Ready = ...\n    Busy = ...");
    expect(pyi).toContain("type Name = str");
    expect(pyi).toContain("def ping(value: int) -> bool: ...");
    expect(pyi).toContain("@overload\ndef fetch(name: str) -> bytes: ...");
    expect(pyi).toContain("async def fetch(name: str, fallback: Optional[bytes]) -> bytes: ...");
    expect(pyi).not.toContain("Hidden");
    expect(unwrap(typeshed.fromSource(pyi)).decls.map((decl) => decl.name)).toEqual([
      "Empty",
      "Box",
      "EmptyState",
      "State",
      "Name",
      "ping",
      "fetch",
    ]);

    const noImports = typeshed.toSource(modelFromTd("type One { value: String }"));
    expect(noImports.startsWith("class One:")).toBe(true);
  });
});
