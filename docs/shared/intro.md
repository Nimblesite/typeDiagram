**Define your types once. Generate code and diagrams everywhere.**

typeDiagram is a tiny, language-neutral DSL for describing **algebraic data types** — records, tagged unions, generics, aliases. From one `.td` file, you get:

- **Source code** in TypeScript, Python, Rust, Go, C#, F#, Dart, PHP, and Protobuf — DTOs, data classes, discriminated unions, pattern-matchable enums — generated from the same definition, always in sync.
- **A visual type editor** with direct field editing, draggable nodes, relationship drawing, pan, zoom, auto-layout, and SVG export — backed by source you can version in git.
- **Round-trip conversion** from existing TypeScript/Python/Rust/Go/C#/F#/Dart/PHP/Protobuf back to the DSL, so you can retrofit an existing codebase.

typeDiagram is a **shared schema for your data model with a first-class visual canvas**. The editor and source are two views of the same typed document, so every visual change stays ready for code generation in as many languages as you need.

### Why this matters

When your backend is Python, your mobile app is Dart/Kotlin, your web client is TypeScript, your data pipeline is Rust, and your gRPC services speak Protobuf, keeping DTOs aligned across nine languages is a full-time job. typeDiagram inverts the problem: one definition, N outputs. Change a field, regenerate, done. Every consumer of the schema stays honest because they all build from the same source.
