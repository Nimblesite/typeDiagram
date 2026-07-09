# Rust crates

typeDiagram's Rust workspace. Each directory here is a workspace member (see the
root [`Cargo.toml`](../Cargo.toml)).

Every crate MUST inherit the shared strict lint table by adding this to its own
`Cargo.toml`:

```toml
[lints]
workspace = true
```

- **Formatting** is governed by the root `rustfmt.toml` (`cargo fmt`).
- **Linting** is governed by the root `Cargo.toml` `[workspace.lints]` — all lints
  on and up to `deny`, per REPO-STANDARDS-SPEC `[LINT-RUST]`.

Once the first crate lands, wire `cargo fmt --all --check`, `cargo clippy
--all-targets -- -D warnings`, and `cargo llvm-cov` into the `fmt` / `lint` /
`test` Makefile targets so Rust joins the same fail-fast + coverage pipeline as
TypeScript.
