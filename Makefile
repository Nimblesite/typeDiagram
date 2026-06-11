# agent-pmo:b636503
# =============================================================================
# Standard Makefile — typeDiagram
# Cross-platform: Linux, macOS, Windows (via GNU Make)
# =============================================================================

.PHONY: build test lint fmt clean ci setup rebuild-install-vsix dev dev-web clean-start test-playwright

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
##       packages/web runs vitest AND Playwright (desktop + mobile) and enforces
##       the threshold against their MERGED coverage — see packages/web/scripts/merge-coverage.ts.
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

## clean: Remove all build artifacts from every package (dist, per-package
##        coverage, root coverage, eleventy + typedoc output).
clean:
	@echo "==> Cleaning all packages..."
	$(RM) packages/typediagram/dist packages/cli/dist packages/web/dist packages/vscode/dist
	$(RM) packages/typediagram/coverage packages/cli/coverage packages/web/coverage packages/vscode/coverage
	$(RM) coverage
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

## test-playwright: Run Playwright end-to-end tests only (packages/web), both
##                  desktop and mobile viewports. Does NOT run vitest or enforce
##                  coverage threshold — for that, use `make test`. Useful for
##                  iterating on UI tests.
test-playwright:
	@echo "==> Playwright E2E (desktop + mobile)..."
	npm run -w packages/web test:e2e

## rebuild-install-vsix: Full clean rebuild-and-reinstall cycle for the VS Code
##                       extension (see REPO-STANDARDS-SPEC [MAKE-IDE-EXT]):
##                       uninstall -> clean -> rebuild -> package -> install.
rebuild-install-vsix:
	@$(MAKE) _vsix_uninstall
	@$(MAKE) _vsix_clean
	@$(MAKE) _vsix_rebuild
	@$(MAKE) _vsix_package
	@$(MAKE) _vsix_install

_vsix_uninstall:
	@echo "==> Uninstalling extension (if installed)..."
	-code --uninstall-extension nimblesite.typediagram

_vsix_clean:
	@echo "==> Cleaning VSIX build output..."
	$(RM) typediagram-*.vsix
	$(RM) packages/vscode/dist

_vsix_rebuild:
	@echo "==> Rebuilding extension from source..."
	npm run -w typediagram-core build
	npm run -w typediagram-vscode build

_vsix_package:
	@echo "==> Packaging VSIX..."
	npm run -w typediagram-vscode package

_vsix_install:
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

## clean-start: Full clean -> build -> dev. Use this when stale dist/ output
##              from another package (e.g. typediagram-core) is being served
##              by the web dev server and you need a guaranteed-fresh state.
##              Also kills any process already bound to the Vite dev port
##              (default 5173) so the new server can bind cleanly.
clean-start:
	@$(MAKE) _kill_dev_port
	@$(MAKE) clean
	@$(MAKE) build
	@$(MAKE) dev

# Vite dev server port. Kept here (not as an env var) so `make clean-start`
# always targets the same port the dev server will bind to.
DEV_PORT := 5173

ifeq ($(OS),Windows_NT)
_kill_dev_port:
	@echo "==> Killing any process on port $(DEV_PORT)..."
	@powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort $(DEV_PORT) -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $$_.OwningProcess -Force -ErrorAction SilentlyContinue }"
else
_kill_dev_port:
	@echo "==> Killing any process on port $(DEV_PORT)..."
	@PIDS=$$(lsof -ti tcp:$(DEV_PORT) 2>/dev/null || true); \
	if [ -n "$$PIDS" ]; then \
	  echo "  killing PIDs: $$PIDS"; \
	  kill -9 $$PIDS 2>/dev/null || true; \
	else \
	  echo "  port $(DEV_PORT) is free"; \
	fi
endif
