---
title: "typeDiagram 0.11: Native DateTime, Uuid & Decimal — and Codegen That Refuses to Lie"
date: 2026-06-12
author: "The typeDiagram team"
description: "typeDiagram 0.11 adds native DateTime, Uuid, and Decimal scalars that generate real datetime / UUID / decimal types in TypeScript, Python, Rust, Go, C#, F#, Dart, PHP, and Protobuf — plus strict code generation that fails on unknown type names instead of emitting code that won't compile. The fix for schema drift on timestamps and ids."
permalink: "/blog/datetime-uuid-decimal-scalars/index.html"
---

If you generate types from one schema across several languages, the failure you fear most is **schema drift** — the moment your generated code and your hand-written code quietly disagree. Drift detection is one of the defining backend concerns of 2026: API teams are building whole [spec-conformance pipelines](https://pactflow.io/blog/schemas-can-be-contracts/) just to catch the day a service's real responses stop matching its documented schema.

typeDiagram exists to remove that whole class of bug — one `.td` file generates TypeScript, Python, Rust, Go, C#, F#, Dart, PHP, and Protobuf types that are in sync **by construction**. But until now it had a gap exactly where drift hurts most: **timestamps and ids**.

**typeDiagram 0.11 closes that gap.** Two changes, both aimed at making the generated code the honest single source of truth.

## 1. Native semantic scalars: `DateTime`, `Uuid`, `Decimal`

Before 0.11, the only primitives were `Bool`, `Int`, `Float`, `String`, `Bytes`, and `Unit`. A `created_at` timestamp or a `conversation_id` could only be modelled as `String`. So the generated DTOs typed them as `str` / `string` — and every consumer that actually wanted a `datetime` or a `UUID` had to hand-patch the output. That hand-patched copy is precisely what drifts.

0.11 makes `DateTime`, `Uuid`, and `Decimal` built-in scalars. They render like any other primitive, but code generation maps each one to the **native** type of the target language:

| typeDiagram | Python              | C# / F#          | TypeScript     | Rust                            | Go          | Dart       | Protobuf                    | PHP                  |
| ----------- | ------------------- | ---------------- | -------------- | ------------------------------- | ----------- | ---------- | --------------------------- | -------------------- |
| `DateTime`  | `datetime.datetime` | `DateTimeOffset` | `string` (ISO) | `chrono::DateTime<chrono::Utc>` | `time.Time` | `DateTime` | `google.protobuf.Timestamp` | `\DateTimeImmutable` |
| `Uuid`      | `uuid.UUID`         | `Guid`           | `string`       | `uuid::Uuid`                    | `string`    | `String`   | `string`                    | `string`             |
| `Decimal`   | `decimal.Decimal`   | `decimal`        | `string`       | `rust_decimal::Decimal`         | `string`    | `String`   | `string`                    | `string`             |

The emitters also pull in the imports each type needs — `import datetime`, `import "time"`, `import "google/protobuf/timestamp.proto"` — so the output compiles as-is.

So this schema:

```
type AuditEvent {
  id: Uuid
  createdAt: DateTime
  amount: Decimal
}
```

now generates this Python, with the real types:

```python
from __future__ import annotations
import datetime
import uuid
import decimal
from dataclasses import dataclass

@dataclass
class AuditEvent:
    id: uuid.UUID
    createdAt: datetime.datetime
    amount: decimal.Decimal
```

The conversion is bidirectional: point `--from` at existing code and a `datetime.datetime`, `Guid`, or `chrono::DateTime` maps straight back to the scalar.

Already using a type called `Uuid`? Nothing breaks. A declaration with the same name as a built-in **shadows** it — `alias Uuid = String` still means `String`. Declared names always win.

## 2. Unknown type names now fail generation — loudly

The more dangerous bug was silent. Given a typo or an unsupported type:

```
type Probe {
  a: Timestamp   # not a real typeDiagram type
}
```

the old CLI emitted `a: Timestamp` into your Python with **exit code 0**. The reference is to a symbol that doesn't exist — a `NameError` at import time — and nothing warned you. A bad type name was indistinguishable from a good one until the consuming project failed to build.

In 0.11, code generation is strict. Every referenced name must resolve to a primitive, a generic built-in (`List`, `Map`, `Option`, `Any`), a declared type, or a generic parameter. Anything else fails the generation:

```sh
$ typediagram --to python schema.td
  0:0  error   unknown type 'Timestamp': not a primitive, builtin, or declared type — declare it or use a builtin scalar
$ echo $?
1
```

The error stops at the generator, where you can fix it, instead of leaking into a downstream build. Rendering a diagram is unchanged — unknown names still draw as opaque external references, because a picture of an external type is useful while a _compile_ of one is not.

## Why this matters for drift

[Schema-driven development](https://godspeed.systems/blog/schema-driven-development-and-single-source-of-truth) only pays off if every consumer can build _directly_ from the generated output with zero hand-edits. The two gaps above each forced a hand-edit — patch the `str` back to a `UUID`, or notice the bad type before it shipped — and every hand-edit is a place drift creeps in. Closing them keeps the schema as the one source of truth, all the way down to the timestamp.

## Get it

- **CLI / library:** `npm install -g typediagram` (or `npm i typediagram-core`)
- **VS Code extension:** [Install from the Marketplace](https://marketplace.visualstudio.com/items?itemName=nimblesite.typediagram)
- **Try it now:** the [playground](/#playground) and [converter](/converter.html) run entirely in your browser.

Full type-mapping details are in the [Language Reference](/docs/language-reference.html) and [Converters](/docs/converters.html) docs.
