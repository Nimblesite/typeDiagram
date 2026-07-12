---
title: "How Real Rust Tooling Uses typeDiagram as a Single Source of Truth: Inside Deslop and Basilisk"
date: 2026-07-09
author: "The typeDiagram team"
description: "A case study in schema-driven development: two production Rust developer tools — Deslop, the live duplicate-code MCP/LSP server, and Basilisk, the Python type checker that scores 100% on the official typing conformance suite — generate their data models from typeDiagram .td schemas instead of hand-writing them. One model, generated algebraic data types in Rust and TypeScript, wired into cargo build, with hand-editing made structurally impossible."
permalink: "/blog/rust-tooling-single-source-of-truth/index.html"
---

Most posts about a code generator show you a toy schema. This one shows you two **shipping Rust developer tools** that bet their wire protocols and domain models on typeDiagram — and the house rule that made hand-writing a data model a review-blocking offence.

The pattern is worth stealing, so here is exactly how they do it, with links to the real files.

## The rule: generate the model, never hand-write it

Both tools are built by [Nimblesite](https://github.com/Nimblesite), and both follow one convention their agent instructions state in capital letters — informally, **[MODEL-TYPEDIAGRAM]**:

> Every data model — every domain type, DTO, entity, enum, and algebraic data type — MUST be defined in typeDiagram and the language types **generated** from that model. Hand-crafting a data model is forbidden.

The reasoning is the one this blog keeps coming back to: a by-hand model has no single source of truth, so it [drifts](/blog/datetime-uuid-decimal-scalars/) across language bindings. Generate it instead and the schema is the artifact under review; the types are build output.

## Case study 1 — Deslop: one schema, Rust **and** TypeScript

[Deslop](https://deslop.live) is a live duplicate-code detector for AI coding agents: a long-running Rust LSP + [MCP](https://modelcontextprotocol.io) server that streams clone signals to Claude Code, Cursor, and Copilot as you type. Its LSP and MCP clients speak a JSON-RPC-style **wire protocol**, and that protocol is the classic drift hazard — the moment the Rust server and the TypeScript VS Code client disagree about a message shape, the integration breaks.

So Deslop makes the wire protocol a single typeDiagram model. [`docs/models/live-ipc.td`](https://github.com/Nimblesite/Deslop/blob/main/docs/models/live-ipc.td) is ~535 lines describing roughly **56 types** — 49 records and 7 tagged unions — covering every request, response, and notification (`FindSimilarRequest`, `ReportChangedNotification`, `EmbeddingProgress`, `SessionConfig`, `AnalysisState`, and so on).

That one file generates types for **both** ends of the protocol:

| Target     | Generated file                               | Consumed by                |
| ---------- | -------------------------------------------- | -------------------------- |
| Rust       | `crates/deslop-core/src/wire_generated.rs`   | `deslop-lsp`, `deslop-mcp` |
| TypeScript | `clients/vscode/src/types/wire-generated.ts` | the VS Code client         |

Three details make the discipline airtight:

1. **Generation runs on every build.** A `crates/deslop-core/build.rs` script invokes the generator before `rustc` runs, so `cargo build` can never compile against a stale model.
2. **The generated files are `.gitignore`d.** They only exist after the build script (or `make typediagram-gen`) runs — there is no committed copy for anyone to hand-edit.
3. **CI pins the generator.** The workflow installs `npm install -g typediagram@0.11.0`, so every machine generates identical output.

Every generated file even carries a header that says so:

```rust
//! Source: `docs/models/live-ipc.td` (typeDiagram).
//! DO NOT EDIT BY HAND. Re-run `make typediagram-gen`.
```

A record and a union in the model look like ordinary typeDiagram:

```
type FindSimilarRequest {
  id: RequestId
  query: FindSimilarInput
  maxResults: Int
}

union FindSimilarInput =
  | ByPath { path: String }
  | BySnippet { code: String; language: String }
```

…and come out the other side as a real Rust `struct` + `enum` (with `serde` wiring) and a matching TypeScript discriminated union — in sync by construction.

## Case study 2 — Basilisk: surgical models with rendered diagrams

[Basilisk](https://basilisk-python.dev) is the only Python type checker to score **100% on the official python/typing conformance suite** — a complete Rust-built Python toolchain (checker, language server, debugger, profiler) with editor extensions. It uses typeDiagram more surgically than Deslop: instead of one big schema, it keeps small, targeted models under [`models/`](https://github.com/Nimblesite/Basilisk/tree/main/models), each with a checked-in SVG under `docs/models/`.

Three of them:

| Model                                                                                              | Generates                                                    | Powers                                         |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------- |
| [`stub_resolution.td`](https://github.com/Nimblesite/Basilisk/blob/main/models/stub_resolution.td) | `StubResolution`, `StubSource`, `StubTier`, `TypeProvenance` | typeshed / stub provenance in `basilisk-stubs` |
| `uv_detection.td`                                                                                  | `UvProjectInfo`                                              | uv project detection in `basilisk-uv`          |
| `debug_session.td`                                                                                 | the `DebugError` union                                       | the debug adapter in `basilisk-lsp`            |

The debug-session model is a good example of a tagged union that would be pure boilerplate to hand-maintain across a diagram and the code:

```
union DebugError =
  | PortAllocation
  | SpawnFailed
  | Timeout
  | AdapterExited
  | DebugpyNotFound
  | PythonNotFound
```

The consuming Rust carries a back-reference to its source, so the link is greppable from the code:

```rust
/// Source of truth: the typeDiagram model `models/stub_resolution.td`
/// → (typediagram --to rust models/stub_resolution.td)
```

Basilisk's contributor guide states the rule directly — _"Use typeDiagram markup to define models in the specs. Generate the ADTs using the typeDiagram code generator pointing at the markup"_ — and its `.vscode/extensions.json` recommends the [typeDiagram VS Code extension](https://marketplace.visualstudio.com/items?itemName=nimblesite.typediagram) so the rendered model is one click away while you edit.

## What both teams get — and what you can steal

Strip away the specifics and the two tools apply the same three ideas:

- **The `.td` file is the artifact under review.** Pull requests review the schema; the generated ADTs are build output, like object files.
- **Regeneration is wired into the build.** Deslop uses `build.rs`; Basilisk regenerates via its Makefile. Either way, stale generated code cannot compile.
- **Hand-editing is designed out.** Gitignore the output, or add the "DO NOT EDIT" header and a back-reference, and there is no tempting copy to patch.

That is [schema-driven development](https://godspeed.systems/blog/schema-driven-development-and-single-source-of-truth) with the drift removed — and because typeDiagram emits TypeScript, Python, Rust, Go, C#, F#, Dart, PHP, and Protobuf from one model, it works whether your source of truth needs to reach a Rust server, a TypeScript client, or both at once.

## Get started

- **CLI / library:** `npm install -g typediagram` (or `npm i typediagram-core`)
- **VS Code extension:** [install from the Marketplace](https://marketplace.visualstudio.com/items?itemName=nimblesite.typediagram)
- **Try it now:** the [playground](/#playground) runs entirely in your browser.
- **Wire it into a build** like Deslop and Basilisk: see the [Converters](/docs/converters.html) and [Language Reference](/docs/language-reference.html) docs.

If your project generates its types from a typeDiagram model too, we would love to feature it — the more real schemas driving real toolchains, the better.
