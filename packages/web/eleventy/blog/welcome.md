---
title: "Class Diagrams for Algebraic Data Types: Diagram-as-Code and Source Generation with typeDiagram"
date: 2026-04-18
author: "The typeDiagram team"
description: "A practical guide to class diagrams for algebraic data types, discriminated unions, and tagged unions. Generate TypeScript, Rust, C#, F#, Go, and Python types from one diagram, render SVG via pluggable hooks, and embed in Markdown — all diagram-as-code, all open source."
permalink: "/blog/welcome/index.html"
---

If you searched for a **class diagram** tool for modern type systems, a way to **generate types from a diagram**, or an **AI-ready diagram-as-code** workflow, this post answers the three questions developers actually ask in 2026:

1. How do I draw a **class diagram for algebraic data types, discriminated unions, and tagged unions**?
2. How do I **generate TypeScript, Rust, C#, F#, Go, or Python types** from one diagram?
3. How do I get an **AI-assisted class diagram** that stays in sync with my codebase?

The short answer: **typeDiagram**. It is a full diagram-as-code ecosystem — a tiny DSL for records and tagged unions, a parser, a layout engine, an SVG renderer with pluggable render hooks, a source generator for six languages, a Markdown plugin, a CLI, and a VS Code extension. Language-neutral, open source, and designed to slot into Markdown, VS Code, and MCP-based AI workflows.

## Class diagrams for a post-OOP world

Classical UML class diagrams were built for object-oriented design: classes, methods, inheritance, visibility, multiplicities. They still have their place — and excellent tools exist for drawing them.

But modern codebases increasingly look different. TypeScript has discriminated unions. Rust has `enum`s with payloads. Swift has `enum` cases with associated values. Kotlin has sealed classes. F# and OCaml have had sum types since the 1970s. C# 10 added `record`s. Python has `dataclass` and `Literal` tag fields. **Every mainstream language today is an algebraic data type language** in everything but name.

Drawing a Rust `Result<T, E>` or a TypeScript `type Event = { kind: "click"; x: number } | { kind: "scroll"; y: number }` as a traditional class diagram forces you into stereotypes, notes, or inheritance hierarchies that do not match the code.

typeDiagram is a class diagram tool built specifically for this style. No methods. No inheritance. Just **records** (product types) and **unions** (sum types), with a rendering that matches how the code is actually written — and a source generator that turns the picture back into code.

## What is diagram-as-code, and why should you care?

**Diagram-as-code** means your diagram lives in a text file, checked into git, rendered by a build step. You get code review, diff, blame, version history, CI, and the ability to embed the rendered image into Markdown docs. This is why Mermaid grew from nothing to 85,000 GitHub stars and PlantUML became the standard for architecture docs.

typeDiagram is diagram-as-code, but focused. It does **one thing**: type diagrams. One small DSL, one deterministic SVG output, one Markdown integration, one VS Code extension, one CLI.

### typeDiagram syntax in 30 seconds

```
record User {
  id: UUID
  email: string
  role: Role
}

union Role {
  Admin
  Member { team: string }
  Guest { expiresAt: DateTime }
}
```

That is a complete, valid diagram. Paste it into the [playground](/#playground) and you get an SVG back with `User` and `Role` connected by an edge, each variant of `Role` shown as its own row with its payload.

No classes. No methods. No stereotypes. Just the shape of your data.

## Where typeDiagram fits alongside Mermaid and PlantUML

Mermaid and PlantUML are excellent, general-purpose diagram-as-code tools. Mermaid's `classDiagram` and PlantUML's UML support cover a huge range: sequence, state, flowchart, ER, deployment, C4. For most of those jobs, they are the right pick, and typeDiagram does not try to replace them.

typeDiagram is **focused**. It does one thing: class diagrams for algebraic data types, end-to-end. That focus buys three things general UML renderers do not offer:

- **First-class discriminated unions and tagged unions.** Variants and their payloads are a primitive in the DSL, not a workaround using inheritance or stereotype notes. The layout engine knows the difference between a variant-of edge and a reference edge.
- **Source generation in six languages.** One diagram round-trips to idiomatic TypeScript, Rust, C#, F#, Go, and Python — and back. No general-purpose UML tool does this.
- **Pluggable render hooks.** The SVG renderer exposes hooks at every stage — node, row, edge, background, post-render. Custom themes, overlays, hover interactions, annotations, and export pipelines plug in without forking.

Pair them freely. Mermaid for sequence and flowchart, PlantUML for C4 and deployment, **typeDiagram for the type layer** that also generates your code.

## Generate TypeScript, Rust, C#, F#, Go, and Python types from one diagram

This is the feature that changes the workflow. Write the diagram once, get idiomatic types in every language your services use:

- **TypeScript**: discriminated unions with a `kind` tag, `interface`s for records.
- **Rust**: `enum` with struct variants, `struct`s for records, `serde` attributes optional.
- **C#**: `record` types, tagged union via the latest discriminated union proposal or sealed record hierarchies.
- **F#**: idiomatic `type` with `|` cases and `record` blocks.
- **Go**: structs plus interface-based tagged unions (the least ugly option Go offers).
- **Python**: `dataclass` with `Literal` tag fields, `Union` aliases, `match` statements.

Try it in the [converter](/converter.html) — paste a diagram on the left, pick a language on the right, copy the source into your project. Round-trip works too: paste existing types, get a diagram back.

This is the **source generator** use case that C# Roslyn fans already know, generalised to every language and driven by a visual contract instead of attributes. One diagram, N languages, zero drift.

## Render hooks: style, annotate, and extend the SVG without forking

The renderer exposes a hook API at every stage of the pipeline — before layout, per-node, per-row, per-edge, background, and post-render. Hooks are where the ecosystem opens up:

- **Theming.** Swap palettes, fonts, stroke widths, and card shapes per environment (light, dark, print, brand).
- **Overlays.** Draw badges for deprecated fields, highlight recently changed types, mark schema-version breaks.
- **Interactivity.** Inject `data-*` attributes, hover handlers, click-through to source, tooltips with docstring text.
- **Diffs.** Render two diagrams on the same canvas with added/removed/changed nodes styled differently for code review.
- **Export pipelines.** Post-render hooks can emit PNG, PDF, or Figma JSON alongside the SVG.

Hooks compose, are fully typed, and return `Result<T, E>` — no thrown exceptions, no surprise crashes during batch rendering. The same hooks work in the CLI, the VS Code extension, and the browser playground.

## AI-assisted class diagrams and MCP integration

**"class diagram ai"** searches grew **+350%** over the past twelve months. **"mermaid mcp"** grew **+800%**. Developers want their AI tools to draw and read diagrams.

typeDiagram is built for this. The DSL is tiny, deterministic, and easy for a large language model to emit correctly. The Markdown integration means an agent can drop a diagram into a doc and have it render. The CLI and library have stable, typed public APIs so an MCP server can expose `render`, `parse`, and `generate` as tools. An agent that reads your codebase can emit a typeDiagram, a human reviews the SVG, and the same diagram generates the updated TypeScript — closing the loop.

If you are building an AI doc-gen pipeline, typeDiagram gives you a diagram format an LLM can write, a renderer that produces deterministic SVG, and a source generator that closes the diagram-to-code gap.

## Markdown, VS Code, CLI, web playground

typeDiagram ships four surfaces:

- **Core npm package** — parser, model, layout, SVG renderer, Markdown plugin. Drop it into any Node or browser project.
- **CLI** — `typediagram input.td -o diagram.svg`, plus batch Markdown rendering and language source generation.
- **VS Code extension** — live preview, syntax highlighting, hover types, jump-to-definition across your diagram sources.
- **Web playground** — paste, edit, export SVG or generated source, share a permalink.

All four consume the same public API. No duplicated parsing or layout logic. What you see in the playground is exactly what CI renders.

## "I already use Mermaid or PlantUML — do I need typeDiagram?"

Add, don't switch. Keep Mermaid or PlantUML for sequence, flowchart, state, ER, C4, and deployment diagrams. Reach for typeDiagram when you want the **type layer** — the records, the discriminated unions, the domain model — to also generate code in six languages and to render through customisable hooks. They render side-by-side in the same Markdown file.

## Getting started in 60 seconds

```bash
npm install -g typediagram
echo 'record User { id: UUID, email: string }' > user.td
typediagram user.td -o user.svg
typediagram user.td --emit typescript > user.ts
```

That is the full loop: diagram, SVG, typed source. No server, no JVM, no configuration.

Try the [playground](/#playground), browse the [docs](/docs/), or grab the [VS Code extension](https://marketplace.visualstudio.com/) and start drawing types the way your code actually looks.

## FAQ

**Is typeDiagram free and open source?** Yes. MIT licensed, on npm and GitHub.

**Does it replace UML?** No. UML class diagrams cover a much wider surface — methods, inheritance, visibility, multiplicities — and UML has thirteen other diagram types. typeDiagram covers the type layer specifically: records, unions, variants, references, with source generation built in.

**Can I embed diagrams in Markdown?** Yes — a Markdown-it plugin ships in the core package. Fenced `typediagram` blocks render to inline SVG.

**Does it work offline?** Yes. Pure JS/TS, no network calls, deterministic output.

**What about C4, ArchiMate, ERD?** Out of scope. typeDiagram is the type layer. Pair it with Structurizr or Mermaid for architecture.

**Is there a hosted version?** The [playground](/#playground) runs entirely in your browser. Nothing is uploaded.

Draw your types the way your compiler sees them. That is the whole pitch.
