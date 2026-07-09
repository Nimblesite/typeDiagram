# Plan — Fix Marketplace publishing (OIDC) + ship v0.11.0

Status: in progress · Owner: release automation · Date: 2026-06-12

## Problem

The VS Code Marketplace is stuck at **0.8.0**. Releases 0.9.0 and 0.10.0 published to
npm + GitHub Releases but **never reached the Marketplace**: the release workflow's
publish step is gated on a `VSCE_PAT` secret that is not configured, and on a missing
PAT it prints a message and `exit 0` — so the step goes green and the miss is silent.

Two faults:

1. **Silent skip.** A missing publish credential must fail loudly, not pass.
2. **Wrong auth model.** `VSCE_PAT` (a long-lived stored token) is disallowed. Publishing
   must use **OIDC / Microsoft Entra workload identity federation** — matching
   `shipwright.json` (`oidcPublish: true`) and the Nimblesite runbook.

## Authoritative references

- Nimblesite/NimblesiteDeployment `docs/vscode-marketplace-oidc.md` (Part D job shape),
  `docs/onboarding-a-new-vsix.md`, `docs/azure-inventory.md`.
- Nimblesite/Shipwright `docs/specs/vsix-platform-bundling.md` (`SWR-VSIX-PUBLISH`,
  `SWR-VSIX-FAT`), `docs/specs/supply-chain-security.md`, `docs/specs/acceptance-gates.md`.

Key facts from the runbooks:

- One shared Entra app `Nimblesite-VSCode-Marketplace` publishes **all** Nimblesite
  extensions; authorization is at the **publisher** level (already a Contributor member
  via Identity GUID `767f2589-2687-6e24-bd6a-2b569a9e3308`). **No new Azure objects.**
- A **wildcard flexible federated credential** trusts
  `repo:Nimblesite/*:environment:release`. The publish job MUST run in a GitHub
  `environment: release` so the OIDC subject matches.
- `vsce publish --azure-credential` is buggy (vscode-vsce#1023). The working pattern
  mints a Marketplace-scoped token from the OIDC session and passes it as `VSCE_PAT`:
  `az account get-access-token --resource 499b84ac-1321-427f-aa17-267ca6975798`.
- typeDiagram's extension is **pure-JS → single fat VSIX** (`SWR-VSIX-FAT`); no
  `--target` platform matrix.
- Non-secret IDs: `AZURE_CLIENT_ID = beacf14a-c783-4bab-80a6-dd4936cb1da3`,
  `AZURE_TENANT_ID = 0a282151-85df-4a81-b083-52221a26d8e7`.

## Steps

### A. GitHub repo config (Part B onboarding) — `gh`, no Azure objects

- [x] Create `release` environment on `Nimblesite/typeDiagram`.
- [x] Set `AZURE_CLIENT_ID` + `AZURE_TENANT_ID` as `release`-environment secrets
      (non-sensitive directory identifiers, from inventory).
- [x] Confirm publisher membership already covers `nimblesite.*` (shared app) — the
      extension's publisher is `nimblesite`, covered by the shared Contributor member.
- [x] github-pages env: deploy-pages runs via `workflow_dispatch` on an operator-selected
      trusted ref, so privileged Pages deployment never checks out a `workflow_run` SHA.

### B. Rewrite `release.yml` marketplace publish

- [x] In the `release` job, upload the packaged VSIX as a workflow artifact for the
      publish job to consume.
- [x] Remove the `VSCE_PAT` env + silent-skip step entirely.
- [x] Add a separate `publish-marketplace` job: `needs: release`,
      `environment: release`, `permissions: { contents: read, id-token: write }`.
      Steps: download VSIX artifact → `azure/login` (OIDC, `allow-no-subscriptions`) →
      mint token via `az account get-access-token --resource 499b84ac-…` →
      `vsce publish` (pinned `@vscode/vsce@3.9.2`), `--pre-release` only for `-`-suffixed
      tags, `--skip-duplicate` for idempotent re-runs, `set -euo pipefail`, mask token.
      **No `exit 0` skip — any real failure fails the job (red release).**
- [x] Pin `azure/login` (`a457da9…`, v2.3.0) and `download-artifact` (`d3f86a1…`, v4.3.0)
      by 40-char commit SHA (`SWR-SEC-ACTION-PINNING`).

### C. Finish the docs/website content for the scalars + unknown-type feature

- [x] `language-reference.md`, `converters.md` (scalars + codegen strictness).
- [x] `cli.md` (exit-1 on unknown types).
- [x] `getting-started.md`, root `README.md` (UUID → Uuid).
- [x] New blog post announcing the release.
- [x] CI made path-selective so website/docs-only PRs skip the full pipeline.

### D. Ship v0.11.0

- [x] Commit all of the above on `fixes`; PR #45 → `main`; CI green; squash-merged
      (`d7f3f7e`).
- [x] Tag `v0.11.0` from `main` → release run 27376654355: stamped 0.11.0, published
      npm (`typediagram-core@0.11.0`, `typediagram@0.11.0`) + GitHub Release (6 assets),
      and the OIDC `publish-marketplace` job pushed the VSIX
      (`Published nimblesite.typediagram v0.11.0.`).
- [x] Verified live: Marketplace shows **0.11.0** as a stable (non-prerelease) release.
- [ ] Record typeDiagram in the NimblesiteDeployment onboarded-repos table (follow-up —
      that repo is outside this working tree).

### E. Website audit findings (fixed in follow-up PR #47)

- [x] `dist/sitemap.xml` was never shipped: the Vite copy plugin only emitted `.html`
      files while `robots.txt` advertised `/sitemap.xml` (crawl 404). Plugin now copies
      Eleventy's `.xml` outputs.
- [x] Sitemap listed 7 of 156 URLs: Eleventy pagination adds only the first page to
      `collections.all` by default, so every docs page except `introduction` was
      missing. Fixed with `addAllPagesToCollections: true`.
- [x] Blog post title `&` double-escaped in `<title>` — reworded.
- [x] Playwright smoke (desktop 1280×720 + mobile 375×667): pages load, zero console
      errors, no horizontal overflow, viewport meta correct.
- [x] `[CI-SCOPE-FILTER]` validated live: the website-only PR took the WEB path and
      skipped the framework matrix/e2e/gates. (First run exposed an ordering bug —
      type-aware lint before `typediagram-core` build — fixed by building core first.)

## Guard rails

- No stored PAT anywhere. No silent skips. Actions SHA-pinned. CI-only publish.
- `v0.11.0` is a clean (non-prerelease) tag → stable Marketplace release.
