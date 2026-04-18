---
name: upgrade-packages
description: Upgrade all dependencies/packages to their latest versions for the detected language(s). Use when the user says "upgrade packages", "update dependencies", "bump versions", "update packages", or "upgrade deps".
argument-hint: "[--check-only] [--major] [package-name]"
---

<!-- agent-pmo:02a321a -->

# Upgrade Packages

Upgrade all project dependencies to their latest compatible (or latest major, if `--major`) versions.

This repo is a TypeScript/Node monorepo with `package.json` + `package-lock.json` at the root managing the `packages/typediagram`, `packages/cli`, `packages/vscode`, and `packages/web` workspaces. The package manager is **npm**.

## Arguments

- `--check-only` — List outdated packages without upgrading. Stop after Step 2.
- `--major` — Include major version bumps (breaking changes). Without this flag, stay within semver-compatible ranges.
- Any other argument is treated as a specific package name to upgrade (instead of all packages).

## Step 1 — Detect manifest files

Confirm the expected manifests exist. For this repo:

- Root: `package.json`, `package-lock.json`
- Workspaces: `packages/*/package.json`

If any of these are missing or the lockfile type has changed (e.g. a `yarn.lock` or `pnpm-lock.yaml` has appeared), STOP and tell the user before proceeding — the commands below assume npm.

## Step 2 — List outdated packages

Run `npm outdated` at the repo root BEFORE upgrading anything. Show the user what will change.

```bash
npm outdated
```

Also check each workspace individually if the root output groups them together confusingly:

```bash
npm outdated --workspace=packages/typediagram
npm outdated --workspace=packages/cli
npm outdated --workspace=packages/vscode
npm outdated --workspace=packages/web
```

**Read the docs:** https://docs.npmjs.com/cli/v10/commands/npm-update

If `--check-only` was passed, **stop here** and report the outdated list.

## Step 3 — Read the official upgrade docs

**Before running any upgrade command, you MUST fetch and read the official npm documentation URL above.** Use WebFetch to retrieve the page. This ensures you use the correct flags and understand the behavior. Do not guess at flags or options from memory.

If running with `--major`, also read:

- npm-check-updates: https://www.npmjs.com/package/npm-check-updates

## Step 4 — Upgrade packages

Run the upgrade. If a specific package name was given as an argument, upgrade only that package.

### Semver-compatible (default)

```bash
npm update
```

Across all workspaces: `npm update --workspaces`.

For a single package: `npm update <pkg>` (add `--workspace=<workspace>` to scope).

### Major version bumps (`--major`)

```bash
npx npm-check-updates -u           # bump package.json to latest majors (root)
npx npm-check-updates -u --deep    # include all workspaces
npm install
```

Review the resulting `package.json` / `package-lock.json` diffs carefully before proceeding.

## Step 5 — Verify the upgrade

After upgrading, run the full CI gate locally to confirm nothing broke:

```bash
make ci
```

`make ci` chains `_fmt_check -> lint -> test (fail-fast + coverage) -> build -> _bundle_size`. Any regression (lint, type, test, coverage threshold, or bundle-size budget) will fail the run.

If tests/lint/typecheck/bundle-size fail:

1. Read the failure output carefully.
2. Check the changelog / migration guide for the upgraded packages (fetch the release notes URL if available).
3. Fix breaking changes in the code.
4. Re-run `make ci`.
5. If stuck after 3 attempts on the same failure, report it to the user with the error details and the package that caused it.

## Step 6 — Report

Provide a summary:

- Packages upgraded (old version -> new version)
- Packages skipped (and why, e.g., major version bump without `--major` flag)
- Build/test result after upgrade
- Any breaking changes that were fixed
- Any packages that could not be upgraded (with error details)

## Rules

- **Always list outdated packages first** before upgrading anything
- **Always read the official docs** for npm before running upgrade commands
- **Always run `make ci` after upgrading** to catch breakage immediately
- **Never remove packages** unless they were explicitly deprecated and replaced
- **Never downgrade packages** unless rolling back a broken upgrade
- **Never modify `package-lock.json` manually** — let npm regenerate it
- **Commit nothing** — leave changes in the working tree for the user to review

## Success criteria

- All outdated packages upgraded to latest compatible (or latest major if `--major`)
- `make ci` passes (lint, typecheck, tests with coverage threshold, build, bundle-size)
- User has a clear summary of what changed
