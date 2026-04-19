# typeDiagram — Agent Instructions

Read this file in full. Rules below are NON-NEGOTIABLE — violations are rejected in review.

<!-- agent-pmo:02a321a -->

⚠️ **TOKEN ECONOMICS DISCIPLINE.** Check file size first. `Grep` over `Read`. Use `offset`/`limit`.
Smallest diff that solves the problem. Delete dead code, unused imports, stale comments.
Call out irrelevant context before proceeding. Bloat degrades reasoning. ⚠️
⚠️ DON'T ASK THE USER QUESTIONS!!!

- DO YOUR JOB and don't say things like "Open questions before I start"
- USE YOUR JUDGEMENT! ⚠️
  ⚠️ NEVER KILL ANY VSCODE PROCESS ⚠️

## Project Overview

typeDiagram is a small DSL for diagramming algebraic data types (records + tagged unions). Language-neutral, no methods. Includes a parser, model, layout engine, SVG renderer, and markdown support. Ships as an npm library, CLI tool, VS Code extension, and web playground.

## Testing Rules

### Bulk of tests

- complex diagram text- > programming language type text
- complex programming language type text example -> diagram
- complex diagram text -> SVG
- Loads of assertions in each test
- Avoid fine grained unit tests

- **Never delete or skip tests. Never remove assertions.** Fix the code or the expectation. 100% coverage is the goal.
- **Never skip a test** without a ticket number AND expiry date in the skip reason.
- **Specific assertions only.** `assert.ok(true)` is illegal.
- **No try/catch in tests that swallows exceptions and asserts success.**
- **Deterministic.** No `sleep()`, no timing dependencies, no random state.
- **E2E tests: black-box only** — public APIs, UI, or CLI. Never reach into internals.
- **VS Code extension E2E:** interact only via `vscode.commands.executeCommand`.

## Hard Rules — Universal (no exceptions)

- **Classes are illegal.** Convert classes to Haskell style type classes with typedef.
- **NO git commands.** No `add`, `commit`, `push`, `checkout`, `merge`, `rebase`, etc. CI handles git.
- **ZERO DUPLICATION.** Search before writing. Move code, don't copy it. PRIORITIZE THIS OVER ALL ELSE!!
- **No throwing** — return `Result<T,E>` (framework Result type). Wrap potential failures in try/catch; return `Result<T,E>`.
- **NO PLACEHOLDERS.** If you HAVE TO leave a section blank, fail LOUDLY by throwing an exception.
- **Functions < 20 lines. Files < 500 lines.** Refactor when over. Aggressively break up violations.
- **`make test` is FAIL-FAST and enforces coverage** from `coverage-thresholds.json`. Never `--no-fail-fast`. See [TEST-FAIL-FAST]. Coverage only monotonically increases -1%.
- **Prefer E2E Whole-App Widget/Integration.** Unit tests only for isolating bugs. Tests must double as integration/widget tests.
- **Heavy structured logging.** Use `pino` for TypeScript — never raw `console.log`.
- **No linter suppressions.** Fix the code.
- **Pure functions over statements.**
- **Don't use if statements** — Use pattern matching or ternaries instead.
- **Spec IDs hierarchical, non-numeric: `[GROUP-TOPIC]` / `[GROUP-TOPIC-DETAIL]`** (e.g. `[AUDIO-QUEUE-PLAY]`). NO sequential numbers. Code/tests MUST reference the ID so `grep [AUDIO-` finds spec->code->tests.
- **Strict TypeScript mode enabled (`strict: true`, `noImplicitAny: true`).**
- **Never explicitly type function return values when the type is inferred** (`explicit-function-return-type` = ILLEGAL).
- **Routinely format with prettier.**
- **NO REGEX on structured data.** Use real parsers for JSON/YAML/TOML/code.
- **`make test` ALWAYS computes coverage AND enforces it.** Threshold lives in `coverage-thresholds.json` at the repo root — NOT env vars, NOT gh repo variables, NOT CI YAML. Below threshold = pipeline fails. Ratchet only. See [COVERAGE-THRESHOLDS-JSON].

## Hard Rules — TypeScript

- No `any` (use `unknown` and narrow). No `!` non-null assertion. No `// @ts-ignore`/`@ts-nocheck`.
- No implicit `any` — annotate every parameter and return type.
- No `as Type` casts without a comment explaining safety.
- `tsconfig.json` MUST have `"strict": true`.
- No throwing — return `Result<T,E>` (library or discriminated union).

## CSS Budget

CSS BUDGET = 2k LOC - HARD CEILING.

## Logging Standards

- **Structured logging library only.** Use `pino` (`pino-pretty` for dev). Never `console.log`.
- **Log at entry/exit of significant operations.** Levels: `error|warn|info|debug|trace`. Silent failures are forbidden.
- **Structured fields, not string interpolation.** `{ userId: 42, action: "checkout" }` — never `"user 42 did checkout"`.
- **VS Code extensions:** detailed logs to a file in the extension's state folder AND to the VS Code Output Channel.
- **NEVER log PII** (names, emails, phone, IPs unless audit with consent).
- **NEVER log secrets.** Log `"key: present"` or a truncated hash, never the value.

## Too Many Cooks (Multi-Agent Coordination)

If the TMC server is available: register on start (name, intent, files), lock files before editing, broadcast your plan, check messages periodically, release locks when done. Never edit a locked file — wait or take another approach.

## Packages Layout

Monorepo under `packages/`:

- `packages/typediagram/` — core framework (parser, model, layout, render-svg, markdown). Owned by `typediagram-builder` agent.
- `packages/cli/` — CLI app (`typediagram` bin). Pure consumer of the framework public API. Owned by `type-model-claude`.
- `packages/web/` — web playground (Vite). Pure consumer of the framework public API. Owned by `type-model-claude`.
- `packages/vscode/` — VS Code extension.

Framework logic lives only in `packages/typediagram/`. `cli`, `web`, and `vscode` are glue — no parsing, layout, or rendering logic duplicated.

## Website

**Optimise for SEO + AI search.** When writing web content, apply:

- [Succeeding in Google's AI search experiences](https://developers.google.com/search/blog/2025/05/succeeding-in-ai-search)
- [SEO Starter Guide](https://developers.google.com/search/docs/fundamentals/seo-starter-guide)

## Build Commands

Cross-platform GNU Make. On Windows: `choco install make` or use the one in Git for Windows.

```bash
make build   # compile everything
make test    # FAIL-FAST tests + coverage + threshold (ONLY test entry point)
make lint    # all linters/analyzers (no formatting)
make fmt     # format in place
make clean   # remove build artifacts
make ci      # lint + test + build (full CI simulation)
make setup   # post-create dev environment setup
```

Only those 7 public targets are standard (see REPO-STANDARDS-SPEC [MAKE-TARGETS]). Repo-specific targets live below them in the `Repo Specific Targets` section. `make test` runs the test runner with its fail-fast flag, collects coverage, asserts measured >= threshold from `coverage-thresholds.json`, and exits non-zero on any failure. To debug a single test, invoke the runner directly — that is not a Makefile target.

**`make fmt`** formats code in-place. **`make lint`** runs linters/analyzers (read-only, no formatting). **`make test`** runs tests with coverage. Three separate targets — no overlap.

## Repo Structure

```
packages/
  typediagram/   — core framework (parser, model, layout, render-svg, markdown)
  cli/           — CLI app (typediagram bin)
  web/           — web playground (Vite)
  vscode/        — VS Code extension
docs/
  specs/         — specification documents
  plans/         — plan documents with TODO checklists
  design/        — design system docs and assets
```
