# agent-pmo:02a321a
# =============================================================================
# Standard Makefile — typeDiagram
# Cross-platform: Linux, macOS, Windows (via GNU Make)
# =============================================================================

.PHONY: build test lint fmt clean ci setup install-vsix dev dev-web

# ---------------------------------------------------------------------------
# OS Detection
# ---------------------------------------------------------------------------
ifeq ($(OS),Windows_NT)
  SHELL := powershell.exe
  .SHELLFLAGS := -NoProfile -Command
  RM = Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
  MKDIR = New-Item -ItemType Directory -Force
  HOME ?= $(USERPROFILE)
else
  SHELL := /bin/bash
  # Fail-fast: -e exits on error, -u on undefined var, -o pipefail catches mid-pipe failures.
  .SHELLFLAGS := -eu -o pipefail -c
  RM = rm -rf
  MKDIR = mkdir -p
endif

# ---------------------------------------------------------------------------
# Coverage — single source of truth is coverage-thresholds.json
# See REPO-STANDARDS-SPEC [COVERAGE-THRESHOLDS-JSON].
# ---------------------------------------------------------------------------
COVERAGE_THRESHOLDS_FILE := coverage-thresholds.json

# =============================================================================
# Standard Targets (exactly 7 — see REPO-STANDARDS-SPEC [MAKE-TARGETS])
# =============================================================================

## build: Compile/assemble all artifacts
build:
	@echo "==> Building..."
	npm run -w typediagram-core build

## test: Fail-fast tests + coverage + threshold enforcement + ratchet.
##       See REPO-STANDARDS-SPEC [TEST-RULES] and [COVERAGE-THRESHOLDS-JSON].
##       Runs each package sequentially so coverage threshold failures exit non-zero.
##       After all tests pass, ratchets coverage-thresholds.json UP to max(current, measured - 1%).
test:
	@echo "==> Testing (fail-fast + coverage + threshold)..."
	npm run -w packages/typediagram test
	npm run -w packages/cli test
	npm run -w packages/vscode test
	npm run -w packages/web test
	$(MAKE) _coverage_check
	@echo "==> Ratcheting coverage thresholds..."
	node scripts/ratchet-coverage.mjs

## lint: Run all linters/analyzers (read-only). Does NOT format. Fails fast on first error.
##       Chains: typecheck -> eslint -> banned-deps.
lint:
	@echo "==> Pre-building typediagram-core (needed for consumer typecheck)..."
	npm run -w typediagram-core build
	@echo "==> Typechecking..."
	npm run -ws --if-present typecheck
	@$(MAKE) _eslint
	@$(MAKE) _banned_deps

## fmt: Format all code in-place.
fmt:
	@echo "==> Formatting (write)..."
	npx prettier --write .

## clean: Remove all build artifacts (dist, coverage, eleventy + typedoc output)
clean:
	@echo "==> Cleaning..."
	$(RM) packages/typediagram/dist packages/cli/dist packages/web/dist packages/vscode/dist coverage
	$(RM) packages/web/.eleventy-out packages/web/.typedoc-out

## ci: full CI simulation. Fail-fast on every gate, in order:
##     fmt-check -> lint -> test+coverage -> build -> bundle-size
ci:
	@$(MAKE) _fmt_check
	@$(MAKE) lint
	@$(MAKE) test
	@$(MAKE) build
	@$(MAKE) _bundle_size

## setup: Post-create dev environment setup (used by devcontainer)
setup:
	@echo "==> Setting up development environment..."
	npm ci
	npm run -w typediagram-core build
	@echo "==> Setup complete. Run 'make ci' to validate."


# =============================================================================
# Internal Targets (private — not public API, must not appear in .PHONY)
# =============================================================================

_coverage_check:
	@if [ ! -f "$(COVERAGE_THRESHOLDS_FILE)" ]; then echo "FAIL: $(COVERAGE_THRESHOLDS_FILE) not found"; exit 1; fi
	@echo "Coverage thresholds enforced per-package by vitest --coverage"
	@echo "Thresholds from $(COVERAGE_THRESHOLDS_FILE):"
	@jq -r '.projects | to_entries[] | "  \(.key): stmts=\(.value.statements)% branch=\(.value.branches)% fn=\(.value.functions)% lines=\(.value.lines)%"' "$(COVERAGE_THRESHOLDS_FILE)"
	@echo "If tests passed, coverage is above thresholds. vitest exits non-zero on breach."

_fmt_check:
	@echo "==> Format check (read-only)..."
	npx prettier --check .

_eslint:
	@echo "==> ESLint..."
	npx eslint .

_banned_deps:
	@echo "==> Banned-deps check..."
	npm run check-banned-deps --workspace=packages/typediagram

_bundle_size:
	@echo "==> Bundle-size budget..."
	npm run bundle-size --workspace=packages/typediagram


# =============================================================================
# Repo-Specific Targets (not part of the 7 standard targets)
# =============================================================================

## install-vsix: Package the VS Code extension to the repo root and install it into the local VS Code.
install-vsix:
	@echo "==> Packaging VSIX..."
	npm run -w typediagram-core build
	$(RM) typediagram-*.vsix
	npm run -w typediagram-vscode package
	@echo "==> Installing VSIX..."
	code --install-extension $$(ls typediagram-*.vsix | head -1) --force

## dev: Start the web playground dev server (cleans generated output first, then
##      runs typedoc + eleventy + eleventy --watch + vite in parallel with HMR).
dev: dev-web

dev-web:
	@echo "==> Building typediagram-core (required by web dev server)..."
	npm run -w typediagram-core build
	@echo "==> Starting web dev server (clean + eleventy --watch + vite)..."
	npm run -w packages/web dev
