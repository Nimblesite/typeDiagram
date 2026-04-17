# Multi-language pipeline

Configure typeDiagram as the single source of truth for DTOs in a polyglot project. This guide uses a TypeScript frontend + Rust backend, but the pattern works for any combination of languages.

## Project layout

```
repo/
├── schemas/
│   ├── user.td
│   └── order.td
├── frontend/               # TypeScript
│   └── src/
│       └── generated/      # git-ignored
├── backend/                # Rust
│   └── src/
│       └── generated/      # git-ignored
├── .gitignore
├── Makefile
└── package.json
```

Keep `.td` files in a top-level `schemas/` directory so both apps consume them. The generated code lives inside each app under a clearly named `generated/` folder — never hand-edited.

## Generate code for each target

```sh
# TypeScript DTOs for the frontend
typediagram --to typescript schemas/user.td  > frontend/src/generated/user.ts
typediagram --to typescript schemas/order.td > frontend/src/generated/order.ts

# Rust structs/enums for the backend
typediagram --to rust schemas/user.td  > backend/src/generated/user.rs
typediagram --to rust schemas/order.td > backend/src/generated/order.rs

# And, optionally, a diagram for the docs
typediagram schemas/user.td  > docs/user.svg
typediagram schemas/order.td > docs/order.svg
```

Every output comes from the same `.td` source, so your TypeScript `User` and Rust `User` are structurally identical — field names, field types, discriminated-union tags, and generics all match by construction.

## .gitignore the generated code

**Do not commit generated code.** It's a build artefact derived from the `.td` files. Commit the schemas; regenerate everything else.

```gitignore
# .gitignore
frontend/src/generated/
backend/src/generated/
docs/*.svg
```

Rationale:

- **Merge conflicts disappear.** Two developers editing the same field in a schema won't also conflict in five language outputs.
- **The schema is authoritative.** Reviewers read the `.td`, not five machine-generated files.
- **CI guarantees freshness.** Every build regenerates from scratch, so drift between schema and output is impossible.

## Wire it into the build

### Makefile

```makefile
SCHEMAS := $(wildcard schemas/*.td)
TS_OUT  := $(patsubst schemas/%.td,frontend/src/generated/%.ts,$(SCHEMAS))
RS_OUT  := $(patsubst schemas/%.td,backend/src/generated/%.rs,$(SCHEMAS))

.PHONY: codegen clean-codegen

codegen: $(TS_OUT) $(RS_OUT)

frontend/src/generated/%.ts: schemas/%.td
	@mkdir -p $(@D)
	typediagram --to typescript $< > $@

backend/src/generated/%.rs: schemas/%.td
	@mkdir -p $(@D)
	typediagram --to rust $< > $@

clean-codegen:
	rm -rf frontend/src/generated backend/src/generated
```

Make `codegen` a prerequisite of your real build targets so it runs automatically:

```makefile
frontend-build: codegen
	cd frontend && npm run build

backend-build: codegen
	cd backend && cargo build --release
```

### npm scripts (frontend)

Run codegen as a `prebuild` hook so `npm run build` always regenerates first:

```json
{
  "scripts": {
    "codegen": "node scripts/codegen.mjs",
    "prebuild": "npm run codegen",
    "predev": "npm run codegen",
    "build": "vite build",
    "dev": "vite"
  }
}
```

```js
// scripts/codegen.mjs
import { readdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";

const OUT = "src/generated";
mkdirSync(OUT, { recursive: true });

for (const file of readdirSync("../schemas")) {
  if (!file.endsWith(".td")) continue;
  const name = file.replace(/\.td$/, "");
  execSync(`typediagram --to typescript ../schemas/${file} > ${OUT}/${name}.ts`);
}
```

### Cargo build script (backend)

Rust projects generate code at build time via `build.rs`:

```rust
// build.rs
use std::fs;
use std::path::Path;
use std::process::Command;

fn main() {
    let schemas = fs::read_dir("../schemas").expect("schemas dir");
    let out = Path::new("src/generated");
    fs::create_dir_all(out).expect("create generated dir");

    for entry in schemas {
        let path = entry.expect("entry").path();
        if path.extension().and_then(|s| s.to_str()) != Some("td") {
            continue;
        }
        let name = path.file_stem().unwrap().to_str().unwrap();
        let out_file = out.join(format!("{name}.rs"));

        let output = Command::new("typediagram")
            .args(["--to", "rust", path.to_str().unwrap()])
            .output()
            .expect("run typediagram");

        fs::write(&out_file, output.stdout).expect("write generated");
        println!("cargo:rerun-if-changed={}", path.display());
    }
}
```

Cargo re-runs `build.rs` automatically whenever any `.td` file changes.

## CI pipeline

Regenerate on every CI run and verify tests still pass against fresh output. Example GitHub Actions workflow:

```yaml
# .github/workflows/ci.yml
name: ci
on: [push, pull_request]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - uses: dtolnay/rust-toolchain@stable

      - name: Install typediagram
        run: npm install -g typediagram

      - name: Generate code
        run: make codegen

      - name: Build frontend
        run: cd frontend && npm ci && npm run build

      - name: Build backend
        run: cd backend && cargo build --release

      - name: Test
        run: make test
```

## Pre-commit hook

Regenerate before each commit so local builds always match CI:

```sh
# .git/hooks/pre-commit
#!/bin/sh
set -e
make codegen
```

Or with [husky](https://typicode.github.io/husky/):

```json
{
  "scripts": {
    "prepare": "husky install"
  }
}
```

```sh
# .husky/pre-commit
make codegen
```

## Watch mode (optional)

For a tight dev loop, regenerate on `.td` file save. Using [watchexec](https://github.com/watchexec/watchexec):

```sh
watchexec --exts td -- make codegen
```

Or via npm:

```sh
npx chokidar-cli "schemas/**/*.td" -c "make codegen"
```

## Checklist

- [ ] `schemas/*.td` committed — single source of truth.
- [ ] `generated/` directories added to `.gitignore`.
- [ ] `make codegen` generates every target language from every schema.
- [ ] Build scripts (`npm`, `cargo`, etc.) depend on `codegen`.
- [ ] CI regenerates and rebuilds from a clean checkout on every push.
- [ ] Pre-commit hook or watch task keeps local dev in sync.

Follow this pattern and your TypeScript frontend, Rust backend, and any future services all build from the same schema. Change a field once; every language picks it up on the next build.
