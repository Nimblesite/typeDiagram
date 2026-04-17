**Define your types once. Generate code and diagrams everywhere.**

typeDiagram is a tiny, language-neutral DSL for describing **algebraic data types** — records, tagged unions, generics, aliases. From one `.td` file, you get:

- **Source code** in TypeScript, Python, Rust, Go, and C# — DTOs, data classes, discriminated unions, pattern-matchable enums — generated from the same definition, always in sync.
- **SVG diagrams** with automatic orthogonal layout — no dragging, no fiddling, versionable in git.
- **Round-trip conversion** from existing TypeScript/Python/Rust/Go/C# back to the DSL, so you can retrofit an existing codebase.

This is not a diagramming tool dressed up with a text input like Mermaid or PlantUML. typeDiagram is a **shared schema for your data model** — the diagram is a side effect, not the goal. The primary output is code, in as many languages as you need, kept strictly in sync by construction.

### Why this matters

When your backend is Python, your mobile app is Swift/Kotlin, your web client is TypeScript, and your data pipeline is Rust, keeping DTOs aligned across five languages is a full-time job. typeDiagram inverts the problem: one definition, N outputs. Change a field, regenerate, done. Every consumer of the schema stays honest because they all build from the same source.
