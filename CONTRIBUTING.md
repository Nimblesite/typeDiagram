# Contributing to typeDiagram

> **Run `make ci` and make it pass before opening a PR.** Red CI = no merge.

```bash
make ci      # runs EVERYTHING CI runs, fail-fast
```

If it fails, the output tells you what broke. Fix, re-run, push.

---

## Writing the PR description

> **Base the PR description on the ACTUAL DIFF — nothing else.** Not the git log, not the branch name, not the chat you had with your agent, not what you intended to do. The diff.

If you're using and agent, run the [`/submit-pr` skill](.claude/skills/submit-pr/SKILL.md) — it reads the real diff and writes the description from that. AI-generated PR summaries drawn from surrounding context (commit messages, conversation history) routinely describe things the diff doesn't actually contain. Reviewers rely on the description being accurate.

---

## File an issue first

For any feature or non-trivial fix, **open an issue and get agreement on the approach before writing code.** Rejected PRs waste everyone's time.

## What we want

- Bug reports with a minimal repro.
- Bug fixes with a failing test that now passes.
- Website corrections (typos, broken links, SEO).
- GitHub Discussions for ideas and design questions.

## What we don't want

- Large PRs without an agreed design. AI agent generated work is welcome. Just open an issue or discussion first so we can agree on scope before you (or your agent) spend hours on it.
- Drive-by refactors. One PR, one concern.
- Untested code.
- Style-only churn.

## Specs & plans

Non-trivial work is captured in [docs/specs/](docs/specs/) (what the system should do) and [docs/plans/](docs/plans/) (TODO checklists for getting there). Specs use hierarchical IDs like `[GROUP-TOPIC-DETAIL]` that link spec → code → tests. For a new feature, expect to add or update a spec and a plan alongside the code.

---

## Code of conduct

Be decent. Disagree on technical merits, never on the person. No harassment or personal attacks — violations get you banned. English in issues, PRs, commits.

## Nimblesite conventions

This repo follows Nimblesite house standards, shortly codified under **AgentPMO** (coming soon) — the shared set of repo, workflow, and coding standards used across Nimblesite projects. Until then, the rulebook for this repo is [CLAUDE.md](CLAUDE.md). Read it before your first PR.

Non-negotiables: no classes, no `any`, no `throw` in library code (return `Result<T, E>`), no `console.log` (use `pino`), no linter suppressions, functions < 20 lines, files < 500 lines, no duplication, never delete or skip tests.

---

## Questions

[GitHub Discussions](https://github.com/Nimblesite/typeDiagram/discussions) or file an issue.
