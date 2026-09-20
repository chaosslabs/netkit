.PHONY: build test lint clean coverage release version install check ci help all dev commit-feat commit-fix commit-refactor commit-perf commit-security
.PHONY: build-dashboard test-dashboard lint-dashboard clean-dashboard install-dashboard install-backend dashboard-dev serve-dev build-all clean-all
.PHONY: changelog changelog-update changelog-init install-changelog-tools release-patch release-minor release-major release-prerelease release-prerelease-next
.PHONY: commit-docs commit-style commit-test commit-chore commit-breaking check-conventional-commits test-e2e test-e2e-ui test-e2e-headed test-docker-dashboard

# Build variables
BINARY_NAME=netkit
BIN_DIR=bin
GO=go
VERSION := $(shell git describe --tags --always --dirty)
GOLANGCI_LINT_VERSION=v2.1.6
DASHBOARD_DIR=dashboard

# Changelog and versioning variables
CHANGELOG_FILE=CHANGELOG.md
CLIFF_CONFIG=cliff.toml
GIT_CLIFF_VERSION=2.8.0

# Show help
help:
	@echo "Available targets:"
	@echo ""
	@echo "Setup commands:"
	@echo "  install                - Install Go development tools and frontend dependencies (complete setup)"
	@echo "  install-backend        - Install Go development tools only (golangci-lint, goimports)"
	@echo "  install-dashboard      - Install dashboard dependencies only"
	@echo "  install-changelog-tools- Install git-cliff and conventional commit tools"
	@echo "  deps                   - Download and tidy Go modules"
	@echo ""
	@echo "Build commands:"
	@echo "  build                  - Build the Go application"
	@echo "  build-dashboard        - Build the dashboard for production"
	@echo "  build-all              - Build both backend and dashboard"
	@echo "  build-embedded         - Build the Go application with embedded dashboard"
	@echo "  build-all-embedded     - Build both backend and dashboard with embedded dashboard"
	@echo ""
	@echo "Test commands:"
	@echo "  test                   - Run Go unit tests with coverage"
	@echo "  test-dashboard         - Run dashboard tests"
	@echo "  e2e                    - Run Go end-to-end tests"
	@echo "  test-e2e               - Run Playwright E2E tests (headless)"
	@echo "  test-e2e-ui            - Run Playwright E2E tests with UI mode (interactive)"
	@echo "  test-e2e-headed        - Run Playwright E2E tests in headed mode (watch browser)"
	@echo "  test-docker-dashboard  - Build the Docker image and verify it serves the embedded dashboard"
	@echo ""
	@echo "Lint commands:"
	@echo "  lint                   - Run golangci-lint for Go code"
	@echo "  lint-dashboard         - Run ESLint for dashboard code"
	@echo ""
	@echo "Development commands:"
	@echo "  dev                    - Start both backend and dashboard in development mode (fast start)"
	@echo "  dev-safe               - Start development mode after running all checks (tests, lint, build)"
	@echo "  serve-dev              - Start only the backend in development mode"
	@echo "  dashboard-dev          - Start only the dashboard in development mode"
	@echo ""
	@echo "Quality commands:"
	@echo "  check                  - Run all Go checks (deps, test, e2e, lint, build)"
	@echo "  ci                     - Run all CI checks (same as check)"
	@echo "  coverage               - Show Go coverage report in browser"
	@echo "  check-conventional-commits - Check if recent commits follow conventional commit format"
	@echo ""
	@echo "Changelog commands:"
	@echo "  changelog-init         - Initialize git-cliff configuration file"
	@echo "  changelog              - Generate full changelog from git history"
	@echo "  changelog-update       - Update changelog with latest commits since last tag"
	@echo ""
	@echo "Release commands:"
	@echo "  release-patch          - Create a patch release (1.0.0 -> 1.0.1 or 1.0.1-alpha.2 -> 1.0.1)"
	@echo "  release-minor          - Create a minor release (1.0.0 -> 1.1.0 or 1.1.0-alpha.2 -> 1.1.0)"
	@echo "  release-major          - Create a major release (1.0.0 -> 2.0.0 or 2.0.0-alpha.2 -> 2.0.0)"
	@echo "  release-prerelease     - Create/increment prerelease (1.0.0 -> 1.0.0-alpha.1 or 1.0.0-alpha.1 -> 1.0.0-alpha.2)"
	@echo "  release-prerelease-next- Create prerelease for next version (1.0.0 -> 1.0.1-alpha.0)"
	@echo "  release                - Create a new release tag (usage: make release version=1.0.0)"
	@echo ""
	@echo "Utility commands:"
	@echo "  clean                  - Clean Go build artifacts"
	@echo "  clean-dashboard        - Clean dashboard build artifacts"
	@echo "  clean-all              - Clean all build artifacts"
	@echo "  version                - Show current version"
	@echo "  help                   - Show this help message"
	@echo ""
	@echo "Conventional commit helpers:"
	@echo "  commit-feat            - Create a feature commit (usage: make commit-feat msg='your message')"
	@echo "  commit-fix             - Create a fix commit (usage: make commit-fix msg='your message')"
	@echo "  commit-docs            - Create a documentation commit (usage: make commit-docs msg='your message')"
	@echo "  commit-style           - Create a style commit (usage: make commit-style msg='your message')"
	@echo "  commit-refactor        - Create a refactor commit (usage: make commit-refactor msg='your message')"
	@echo "  commit-test            - Create a test commit (usage: make commit-test msg='your message')"
	@echo "  commit-chore           - Create a chore commit (usage: make commit-chore msg='your message')"
	@echo "  commit-perf            - Create a performance commit (usage: make commit-perf msg='your message')"
	@echo "  commit-security        - Create a security commit (usage: make commit-security msg='your message')"
	@echo "  commit-breaking        - Create a breaking change commit (usage: make commit-breaking msg='your message')"

# Install all development tools (backend + frontend)
install:
	@echo "🚀 Setting up complete development environment..."
	@echo ""
	@$(MAKE) install-backend
	@echo ""
	@$(MAKE) install-dashboard
	@echo ""
	@$(MAKE) install-changelog-tools
	@echo ""
	@echo "🎉 All setup complete! Backend, frontend, and changelog tools are ready."
	@echo ""
	@echo "Next steps:"
	@echo "  - Run 'make dev' to start both backend and frontend in development mode"
	@echo "  - Run 'make check' to run all Go checks before committing"
	@echo "  - Run 'make changelog-init' to set up changelog generation"

# Install backend development tools
install-backend:
	@echo "Installing Go development tools..."
	@echo "Checking Go version..."
	@go_version=$$(go version | sed 's/go version go\([0-9.]*\).*/\1/'); \
	required_version="1.24"; \
	if ! printf '%s\n%s\n' "$$required_version" "$$go_version" | sort -V -C; then \
		echo "❌ Error: Go $$go_version detected, but Go $$required_version or higher is required"; \
		echo ""; \
		echo "Please install Go 1.24 or higher:"; \
		echo "  - Download from: https://golang.org/dl/"; \
		echo "  - Or use Homebrew: brew install go"; \
		echo "  - Or use official installer script"; \
		echo ""; \
		exit 1; \
	else \
		echo "✅ Go $$go_version detected (meets requirement: >=$$required_version)"; \
	fi
	@echo "Checking golangci-lint..."
	@if command -v golangci-lint >/dev/null 2>&1; then \
		current_version=$$(golangci-lint --version | grep -o 'version [0-9.]*' | cut -d' ' -f2); \
		target_version=$$(echo "$(GOLANGCI_LINT_VERSION)" | sed 's/^v//'); \
		echo "✅ golangci-lint $$current_version is already installed"; \
		if [ "$$current_version" != "$$target_version" ]; then \
			echo "ℹ️  Target version is $$target_version, but $$current_version is sufficient"; \
		fi; \
	else \
		echo "Installing golangci-lint $(GOLANGCI_LINT_VERSION)..."; \
		curl -sSfL https://raw.githubusercontent.com/golangci/golangci-lint/master/install.sh | sh -s -- -b $$(go env GOPATH)/bin $(GOLANGCI_LINT_VERSION); \
		echo "✅ golangci-lint installed successfully"; \
	fi
	@echo "Checking goimports..."
	@if command -v goimports >/dev/null 2>&1; then \
		echo "✅ goimports is already installed"; \
	else \
		echo "Installing goimports..."; \
		$(GO) install golang.org/x/tools/cmd/goimports@latest; \
		echo "✅ goimports installed successfully"; \
	fi
	@echo "✅ All Go development tools are ready!"
	@echo ""
	@echo "Make sure $$(go env GOPATH)/bin is in your PATH:"
	@echo "  export PATH=\$$PATH:\$$(go env GOPATH)/bin"

# Install dashboard dependencies
install-dashboard:
	@echo "Installing dashboard dependencies..."
	@if [ ! -d "$(DASHBOARD_DIR)" ]; then \
		echo "❌ Error: Dashboard directory '$(DASHBOARD_DIR)' not found"; \
		echo "Please ensure the dashboard code is in the '$(DASHBOARD_DIR)' directory"; \
		exit 1; \
	fi
	@echo "Checking Node.js version..."
	@node_version=$$(node --version | sed 's/v\([0-9]*\).*/\1/'); \
	required_version="18"; \
	if [ "$$node_version" -lt "$$required_version" ]; then \
		echo "❌ Error: Node.js $$node_version detected, but Node.js $$required_version or higher is required"; \
		echo ""; \
		echo "Please install Node.js 18 or higher:"; \
		echo "  - Download from: https://nodejs.org/"; \
		echo "  - Or use nvm: nvm install 18"; \
		echo "  - Or use Homebrew: brew install node"; \
		echo ""; \
		exit 1; \
	else \
		echo "✅ Node.js $$node_version detected (meets requirement: >=$$required_version)"; \
	fi
	@echo "Checking dashboard dependencies..."
	@if [ -d "$(DASHBOARD_DIR)/node_modules" ] && [ -f "$(DASHBOARD_DIR)/package-lock.json" ]; then \
		echo "✅ Dashboard dependencies are already installed"; \
		echo "ℹ️  Run 'npm install --legacy-peer-deps' in $(DASHBOARD_DIR) to update if needed"; \
	else \
		echo "Installing dashboard dependencies..."; \
		cd $(DASHBOARD_DIR) && npm install --legacy-peer-deps; \
		echo "✅ Dashboard dependencies installed successfully!"; \
	fi

# Build the Go application
build:
	@mkdir -p $(BIN_DIR)
	$(GO) build -o $(BIN_DIR)/$(BINARY_NAME) ./cmd/netkit

# Build with embedded dashboard
build-embedded: build-dashboard
	@echo "Copying dashboard files for embedding..."
	@mkdir -p internal/dashboard/out
	@cp -r $(DASHBOARD_DIR)/out/* internal/dashboard/out/
	@echo "Building Go application with embedded dashboard..."
	@mkdir -p $(BIN_DIR)
	$(GO) build -tags embed_dashboard -o $(BIN_DIR)/$(BINARY_NAME) ./cmd/netkit
	@echo "✅ Embedded build completed successfully!"

# Build the dashboard for production
build-dashboard:
	@if [ ! -d "$(DASHBOARD_DIR)" ]; then \
		echo "❌ Error: Dashboard directory '$(DASHBOARD_DIR)' not found"; \
		exit 1; \
	fi
	@echo "Building dashboard for embedding..."
	@cd $(DASHBOARD_DIR) && npm run build:static --legacy-peer-deps
	@echo "✅ Dashboard built successfully!"

# Build both backend and dashboard
build-all: build build-dashboard

# Build everything with embedded dashboard
build-all-embedded: build-embedded

# Run Go unit tests with coverage
test:
	$(GO) test -v -race -coverprofile=coverage.txt -covermode=atomic ./... -tags=unit

# Run dashboard tests
test-dashboard:
	@if [ ! -d "$(DASHBOARD_DIR)" ]; then \
		echo "❌ Error: Dashboard directory '$(DASHBOARD_DIR)' not found"; \
		exit 1; \
	fi
	@cd $(DASHBOARD_DIR) && npm run test --legacy-peer-deps

# Run Playwright E2E tests (headless)
test-e2e:
	@if [ ! -d "$(DASHBOARD_DIR)" ]; then \
		echo "❌ Error: Dashboard directory '$(DASHBOARD_DIR)' not found"; \
		exit 1; \
	fi
	@echo "🎭 Running Playwright E2E tests..."
	@cd $(DASHBOARD_DIR) && npm run test:e2e

# Run Playwright E2E tests with UI mode (interactive)
test-e2e-ui:
	@if [ ! -d "$(DASHBOARD_DIR)" ]; then \
		echo "❌ Error: Dashboard directory '$(DASHBOARD_DIR)' not found"; \
		exit 1; \
	fi
	@echo "🎭 Running Playwright E2E tests in UI mode..."
	@cd $(DASHBOARD_DIR) && npm run test:e2e:ui

# Run Playwright E2E tests in headed mode (watch browser)
test-e2e-headed:
	@if [ ! -d "$(DASHBOARD_DIR)" ]; then \
		echo "❌ Error: Dashboard directory '$(DASHBOARD_DIR)' not found"; \
		exit 1; \
	fi
	@echo "🎭 Running Playwright E2E tests in headed mode..."
	@cd $(DASHBOARD_DIR) && npm run test:e2e:headed

# Build the Docker image and ensure the embedded dashboard is served, not fallback HTML
test-docker-dashboard:
	@./scripts/validate-docker-dashboard.sh

# Run end-to-end tests
e2e:
	$(GO) test -count=1 -v -race -coverprofile=coverage-e2e.txt -covermode=atomic ./test/e2e/... -tags=e2e

# Run golangci-lint for Go code
lint:
	golangci-lint run

# Run ESLint for dashboard code
lint-dashboard:
	@if [ ! -d "$(DASHBOARD_DIR)" ]; then \
		echo "❌ Error: Dashboard directory '$(DASHBOARD_DIR)' not found"; \
		exit 1; \
	fi
	@cd $(DASHBOARD_DIR) && npm run lint --legacy-peer-deps

# Start both backend and dashboard in development mode
dev: deps
	@echo "Starting netkit in development mode..."
	@echo "Backend will be available at http://localhost:8080"
	@echo "Dashboard will be available at http://localhost:3000"
	@echo ""
	@echo "Press Ctrl+C to stop both services"
	@trap 'kill %1 %2 2>/dev/null; exit' INT; \
	$(MAKE) serve-dev & \
	$(MAKE) dashboard-dev & \
	wait

# Start development environment after running all checks
dev-safe: check
	@echo "All checks passed! Starting netkit in development mode..."
	@echo "Backend will be available at http://localhost:8080"
	@echo "Dashboard will be available at http://localhost:3000"
	@echo ""
	@echo "Press Ctrl+C to stop both services"
	@trap 'kill %1 %2 2>/dev/null; exit' INT; \
	$(MAKE) serve-dev & \
	$(MAKE) dashboard-dev & \
	wait

# Start only the backend in development mode
serve-dev:
	@echo "Starting backend in development mode on port 8080..."
	@$(GO) run ./cmd/netkit serve --port 8080 --log-level debug --admin-port 8081 --dashboard=false

# Start only the dashboard in development mode
dashboard-dev:
	@if [ ! -d "$(DASHBOARD_DIR)" ]; then \
		echo "❌ Error: Dashboard directory '$(DASHBOARD_DIR)' not found"; \
		exit 1; \
	fi
	@echo "Starting dashboard in development mode on port 3000..."
	@cd $(DASHBOARD_DIR) && PORT=3000 npm run dev

# Show Go coverage report
coverage:
	$(GO) tool cover -html=coverage.txt

# Clean Go build artifacts
clean:
	rm -rf $(BIN_DIR) coverage.txt coverage-e2e.txt
	$(GO) clean

# Clean dashboard build artifacts
clean-dashboard:
	@if [ -d "$(DASHBOARD_DIR)" ]; then \
		cd $(DASHBOARD_DIR) && rm -rf dist/ node_modules/.cache/; \
	fi

# Clean all build artifacts
clean-all: clean clean-dashboard
	@if [ -d "$(DASHBOARD_DIR)" ]; then \
		cd $(DASHBOARD_DIR) && rm -rf node_modules/; \
	fi

# Install Go dependencies
deps:
	$(GO) mod download
	$(GO) mod tidy

# Run all Go checks (deps, test, e2e, lint, build)
check: deps test e2e lint build

# Run all checks for CI (same as check but with explicit steps)
ci: deps test e2e lint build
	@echo "✅ All CI checks passed!"

# Show current version
version:
	@echo "Current version: $(VERSION)"

# Install changelog and versioning tools
install-changelog-tools:
	@echo "Installing changelog and versioning tools..."
	@echo "Checking git-cliff..."
	@if command -v git-cliff >/dev/null 2>&1; then \
		current_version=$$(git-cliff --version 2>/dev/null | grep -o '[0-9]\+\.[0-9]\+\.[0-9]\+' | head -1); \
		if [ -n "$$current_version" ]; then \
			echo "✅ git-cliff $$current_version is already installed"; \
		else \
			echo "⚠️  git-cliff is installed but version cannot be determined"; \
		fi; \
	else \
		echo "Installing git-cliff $(GIT_CLIFF_VERSION)..."; \
		if command -v cargo >/dev/null 2>&1; then \
			cargo install git-cliff --version $(GIT_CLIFF_VERSION); \
			echo "✅ git-cliff installed successfully via cargo"; \
		elif [[ "$$OSTYPE" == "darwin"* ]] && command -v brew >/dev/null 2>&1; then \
			brew install git-cliff; \
			echo "✅ git-cliff installed successfully via Homebrew"; \
		else \
			echo "❌ Error: Cannot install git-cliff. Please install cargo or use:"; \
			echo "  - macOS: brew install git-cliff"; \
			echo "  - Or download from: https://github.com/orhun/git-cliff/releases"; \
			exit 1; \
		fi; \
	fi
	@echo "✅ All changelog tools are ready!"

# Initialize git-cliff configuration
changelog-init:
	@echo "Initializing git-cliff configuration..."
	@if [ -f "$(CLIFF_CONFIG)" ]; then \
		echo "⚠️  $(CLIFF_CONFIG) already exists. Use 'git-cliff --init --force' to overwrite."; \
	else \
		git-cliff --init; \
		echo "✅ $(CLIFF_CONFIG) created successfully!"; \
		echo ""; \
		echo "Next steps:"; \
		echo "  - Edit $(CLIFF_CONFIG) to customize your changelog format"; \
		echo "  - Run 'make changelog' to generate your first changelog"; \
	fi

# Generate full changelog from git history
changelog:
	@echo "Generating full changelog..."
	@if ! command -v git-cliff >/dev/null 2>&1; then \
		echo "❌ Error: git-cliff is not installed. Run 'make install-changelog-tools' first."; \
		exit 1; \
	fi
	@if [ ! -f "$(CLIFF_CONFIG)" ]; then \
		echo "⚠️  No $(CLIFF_CONFIG) found. Creating default configuration..."; \
		$(MAKE) changelog-init; \
	fi
	@echo "Generating changelog to $(CHANGELOG_FILE)..."
	@git-cliff --output $(CHANGELOG_FILE)
	@echo "✅ Changelog generated successfully!"
	@echo "📄 View changelog: cat $(CHANGELOG_FILE)"

# Update changelog with latest commits since last tag
changelog-update:
	@echo "Updating changelog with latest commits..."
	@if ! command -v git-cliff >/dev/null 2>&1; then \
		echo "❌ Error: git-cliff is not installed. Run 'make install-changelog-tools' first."; \
		exit 1; \
	fi
	@if [ ! -f "$(CLIFF_CONFIG)" ]; then \
		echo "⚠️  No $(CLIFF_CONFIG) found. Creating default configuration..."; \
		$(MAKE) changelog-init; \
	fi
	@echo "Updating changelog with unreleased commits..."
	@git-cliff --output $(CHANGELOG_FILE)
	@echo "✅ Changelog updated successfully!"
	@echo "📄 View changelog: cat $(CHANGELOG_FILE)"

# Update changelog for a specific release version (internal use)
changelog-release:
	@if [ "$(version)" = "" ]; then \
		echo "Error: version is required for changelog-release target"; \
		exit 1; \
	fi
	@echo "Updating changelog for release v$(version)..."
	@if ! command -v git-cliff >/dev/null 2>&1; then \
		echo "❌ Error: git-cliff is not installed. Run 'make install-changelog-tools' first."; \
		exit 1; \
	fi
	@if [ ! -f "$(CLIFF_CONFIG)" ]; then \
		echo "⚠️  No $(CLIFF_CONFIG) found. Creating default configuration..."; \
		$(MAKE) changelog-init; \
	fi
	@git-cliff --unreleased --tag v$(version) --prepend $(CHANGELOG_FILE)
	@echo "✅ Changelog updated for release v$(version)!"

# Check if recent commits follow conventional commit format
check-conventional-commits:
	@echo "Checking recent commits for conventional commit format..."
	@last_tag=$$(git describe --tags --abbrev=0 2>/dev/null || echo "HEAD~10"); \
	commits=$$(git rev-list $$last_tag..HEAD --oneline); \
	if [ -z "$$commits" ]; then \
		echo "✅ No new commits to check."; \
		exit 0; \
	fi; \
	non_conventional=0; \
	echo "Checking commits since $$last_tag:"; \
	echo "$$commits" | while read commit; do \
		hash=$$(echo "$$commit" | cut -d' ' -f1); \
		message=$$(echo "$$commit" | cut -d' ' -f2-); \
		if echo "$$message" | grep -qE '^(feat|fix|docs|style|refactor|test|chore|perf|ci|build|revert)(\(.+\))?!?:'; then \
			echo "✅ $$hash: $$message"; \
		else \
			echo "❌ $$hash: $$message"; \
			non_conventional=$$((non_conventional + 1)); \
		fi; \
	done; \
	if [ $$non_conventional -gt 0 ]; then \
		echo ""; \
		echo "❌ Found $$non_conventional non-conventional commit(s)."; \
		echo ""; \
		echo "Conventional commit format: <type>[optional scope]: <description>"; \
		echo "Valid types: feat, fix, docs, style, refactor, test, chore, perf, ci, build, revert"; \
		echo "Examples:"; \
		echo "  feat: add new user authentication"; \
		echo "  fix(api): resolve CORS issue"; \
		echo "  docs: update README with installation steps"; \
		exit 1; \
	else \
		echo ""; \
		echo "✅ All recent commits follow conventional commit format!"; \
	fi

# Create a patch release (1.0.0 -> 1.0.1 or 1.0.1-alpha.2 -> 1.0.1)
release-patch: check-conventional-commits
	@echo "Creating patch release..."
	@current_version=$$(git describe --tags --abbrev=0 2>/dev/null | sed 's/^v//'); \
	if [ -z "$$current_version" ]; then \
		current_version="0.0.0"; \
	fi; \
	echo "Current version: $$current_version"; \
	if [ "$$current_version" = "0.0.0" ]; then \
		new_version="0.0.1"; \
	else \
		if echo "$$current_version" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$$'; then \
			new_version=$$(echo "$$current_version" | awk -F. '{print $$1"."$$2"."$$3+1}'); \
		elif echo "$$current_version" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+-'; then \
			new_version=$$(echo "$$current_version" | sed 's/-.*//'); \
			echo "Graduating prerelease to stable version"; \
		else \
			echo "❌ Error: Invalid current version format: $$current_version"; \
			echo "Expected format: x.y.z or x.y.z-prerelease (e.g., 1.0.0 or 1.0.1-alpha.0)"; \
			exit 1; \
		fi; \
	fi; \
	echo "Bumping version from $$current_version to $$new_version"; \
	$(MAKE) _do_release version=$$new_version

# Create a minor release (1.0.0 -> 1.1.0 or 1.1.0-alpha.2 -> 1.1.0)
release-minor: check-conventional-commits
	@echo "Creating minor release..."
	@current_version=$$(git describe --tags --abbrev=0 2>/dev/null | sed 's/^v//'); \
	if [ -z "$$current_version" ]; then \
		current_version="0.0.0"; \
	fi; \
	echo "Current version: $$current_version"; \
	if [ "$$current_version" = "0.0.0" ]; then \
		new_version="0.1.0"; \
	else \
		if echo "$$current_version" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$$'; then \
			new_version=$$(echo "$$current_version" | awk -F. '{print $$1"."$$2+1".0"}'); \
		elif echo "$$current_version" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+-'; then \
			base_version=$$(echo "$$current_version" | sed 's/-.*//'); \
			new_version=$$(echo "$$base_version" | awk -F. '{print $$1"."$$2+1".0"}'); \
			echo "Bumping minor version from prerelease"; \
		else \
			echo "❌ Error: Invalid current version format: $$current_version"; \
			echo "Expected format: x.y.z or x.y.z-prerelease (e.g., 1.0.0 or 1.1.0-alpha.0)"; \
			exit 1; \
		fi; \
	fi; \
	echo "Bumping version from $$current_version to $$new_version"; \
	$(MAKE) _do_release version=$$new_version

# Create a major release (1.0.0 -> 2.0.0 or 2.0.0-alpha.2 -> 2.0.0)
release-major: check-conventional-commits
	@echo "Creating major release..."
	@current_version=$$(git describe --tags --abbrev=0 2>/dev/null | sed 's/^v//'); \
	if [ -z "$$current_version" ]; then \
		current_version="0.0.0"; \
	fi; \
	echo "Current version: $$current_version"; \
	if [ "$$current_version" = "0.0.0" ]; then \
		new_version="1.0.0"; \
	else \
		if echo "$$current_version" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$$'; then \
			new_version=$$(echo "$$current_version" | awk -F. '{print $$1+1".0.0"}'); \
		elif echo "$$current_version" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+-'; then \
			base_version=$$(echo "$$current_version" | sed 's/-.*//'); \
			new_version=$$(echo "$$base_version" | awk -F. '{print $$1+1".0.0"}'); \
			echo "Bumping major version from prerelease"; \
		else \
			echo "❌ Error: Invalid current version format: $$current_version"; \
			echo "Expected format: x.y.z or x.y.z-prerelease (e.g., 1.0.0 or 2.0.0-alpha.0)"; \
			exit 1; \
		fi; \
	fi; \
	echo "Bumping version from $$current_version to $$new_version"; \
	$(MAKE) _do_release version=$$new_version

# Create a prerelease (1.0.0 -> 1.0.0-alpha.1 or 1.0.0-alpha.1 -> 1.0.0-alpha.2)
release-prerelease:
	@if [ "$(name)" = "" ]; then \
		echo "Error: prerelease name is required. Usage: make release-prerelease name=alpha"; \
		exit 1; \
	fi
	@echo "Creating prerelease with name '$(name)'..."
	@current_version=$$(git describe --tags --abbrev=0 2>/dev/null | sed 's/^v//'); \
	if [ -z "$$current_version" ]; then \
		current_version="0.0.0"; \
	fi; \
	echo "Current version: $$current_version"; \
	if [ "$$current_version" = "0.0.0" ]; then \
		new_version="0.0.0-$(name).1"; \
	elif echo "$$current_version" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$$'; then \
		new_version="$$current_version-$(name).1"; \
	elif echo "$$current_version" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+-$(name)\.[0-9]+$$'; then \
		base_version=$$(echo "$$current_version" | sed 's/-$(name)\.[0-9]*//'); \
		prerelease_num=$$(echo "$$current_version" | grep -oE '[0-9]+$$'); \
		new_prerelease_num=$$((prerelease_num + 1)); \
		new_version="$$base_version-$(name).$$new_prerelease_num"; \
		echo "Incrementing $(name) prerelease number"; \
	elif echo "$$current_version" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+-[a-zA-Z]+\.[0-9]+$$'; then \
		old_name=$$(echo "$$current_version" | sed -E 's/.*-([a-zA-Z]+)\.[0-9]+$$/\1/'); \
		echo "⚠️  Warning: Current prerelease is '$$old_name', but you requested '$(name)'"; \
		echo "Switching prerelease identifier from $$old_name to $(name)"; \
		base_version=$$(echo "$$current_version" | sed -E 's/-[a-zA-Z]+\.[0-9]+$$//'); \
		new_version="$$base_version-$(name).1"; \
	else \
		echo "❌ Error: Invalid current version format: $$current_version"; \
		echo "Expected format: x.y.z or x.y.z-prerelease.num (e.g., 1.0.0 or 1.0.0-alpha.1)"; \
		exit 1; \
	fi; \
	echo "Bumping version from $$current_version to $$new_version"; \
	$(MAKE) _do_release version=$$new_version

# Create a prerelease for the next version (1.0.0 -> 1.0.1-alpha.0)
release-prerelease-next:
	@if [ "$(name)" = "" ]; then \
		echo "Error: prerelease name is required. Usage: make release-prerelease-next name=alpha"; \
		echo "Hint: Use 'make release-prerelease' to increment current version prerelease"; \
		exit 1; \
	fi
	@echo "Creating prerelease for next version with name '$(name)'..."
	@current_version=$$(git describe --tags --abbrev=0 2>/dev/null | sed 's/^v//'); \
	if [ -z "$$current_version" ]; then \
		current_version="0.0.0"; \
	fi; \
	echo "Current version: $$current_version"; \
	if [ "$$current_version" = "0.0.0" ]; then \
		new_version="0.0.1-$(name).0"; \
	elif echo "$$current_version" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$$'; then \
		base_version=$$(echo "$$current_version" | awk -F. '{print $$1"."$$2"."$$3+1}'); \
		new_version="$$base_version-$(name).0"; \
	elif echo "$$current_version" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+-[a-zA-Z]+\.[0-9]+$$'; then \
		base_version=$$(echo "$$current_version" | sed -E 's/-[a-zA-Z]+\.[0-9]+$$//'); \
		next_patch=$$(echo "$$base_version" | awk -F. '{print $$1"."$$2"."$$3+1}'); \
		new_version="$$next_patch-$(name).0"; \
		echo "Creating prerelease for next patch version"; \
	else \
		echo "❌ Error: Invalid current version format: $$current_version"; \
		echo "Expected format: x.y.z or x.y.z-prerelease.num (e.g., 1.0.0 or 1.0.0-alpha.1)"; \
		exit 1; \
	fi; \
	echo "Bumping version from $$current_version to $$new_version"; \
	$(MAKE) _do_release version=$$new_version

# Internal target to perform the actual release
_do_release:
	@if [ "$(version)" = "" ]; then \
		echo "Error: version is required for internal release target"; \
		exit 1; \
	fi
	@echo "🚀 Creating release v$(version)..."
	@echo "📝 Updating changelog..."
	@$(MAKE) changelog-release version=$(version)
	@echo "✅ Building and testing..."
	@$(MAKE) check
	@echo "📦 Committing changelog..."
	@git add $(CHANGELOG_FILE)
	@git commit -m "chore(release): prepare release v$(version)" || echo "No changes to commit"
	@echo "🏷️  Creating git tag..."
	@git tag -a "v$(version)" -m "Release v$(version)"
	@echo "✅ Release v$(version) created successfully!"
	@echo ""
	@echo "Next steps:"
	@echo "  1. Review the changes: git show v$(version)"
	@echo "  2. Push the release: git push origin main --tags"
	@echo "  3. Create a GitHub/GitLab release from the tag"
	@echo "  4. Build and publish artifacts as needed"

# Conventional commit helpers - Enhanced with more types
commit-feat:
	@if [ "$(msg)" = "" ]; then \
		echo "Error: commit message is required. Usage: make commit-feat msg='your message'"; \
		exit 1; \
	fi
	git commit -m "feat: $(msg)"

commit-fix:
	@if [ "$(msg)" = "" ]; then \
		echo "Error: commit message is required. Usage: make commit-fix msg='your message'"; \
		exit 1; \
	fi
	git commit -m "fix: $(msg)"

commit-docs:
	@if [ "$(msg)" = "" ]; then \
		echo "Error: commit message is required. Usage: make commit-docs msg='your message'"; \
		exit 1; \
	fi
	git commit -m "docs: $(msg)"

commit-style:
	@if [ "$(msg)" = "" ]; then \
		echo "Error: commit message is required. Usage: make commit-style msg='your message'"; \
		exit 1; \
	fi
	git commit -m "style: $(msg)"

commit-refactor:
	@if [ "$(msg)" = "" ]; then \
		echo "Error: commit message is required. Usage: make commit-refactor msg='your message'"; \
		exit 1; \
	fi
	git commit -m "refactor: $(msg)"

commit-test:
	@if [ "$(msg)" = "" ]; then \
		echo "Error: commit message is required. Usage: make commit-test msg='your message'"; \
		exit 1; \
	fi
	git commit -m "test: $(msg)"

commit-chore:
	@if [ "$(msg)" = "" ]; then \
		echo "Error: commit message is required. Usage: make commit-chore msg='your message'"; \
		exit 1; \
	fi
	git commit -m "chore: $(msg)"

commit-perf:
	@if [ "$(msg)" = "" ]; then \
		echo "Error: commit message is required. Usage: make commit-perf msg='your message'"; \
		exit 1; \
	fi
	git commit -m "perf: $(msg)"

commit-security:
	@if [ "$(msg)" = "" ]; then \
		echo "Error: commit message is required. Usage: make commit-security msg='your message'"; \
		exit 1; \
	fi
	git commit -m "security: $(msg)"

commit-breaking:
	@if [ "$(msg)" = "" ]; then \
		echo "Error: commit message is required. Usage: make commit-breaking msg='your message'"; \
		exit 1; \
	fi
	@if [ "$(scope)" != "" ]; then \
		git commit -m "feat($(scope))!: $(msg)"; \
	else \
		git commit -m "feat!: $(msg)"; \
	fi

# Create a new release tag (legacy command for backward compatibility)
release:
	@if [ "$(version)" = "" ]; then \
		echo "Error: version is required. Usage: make release version=1.0.0"; \
		echo ""; \
		echo "Or use semantic release commands:"; \
		echo "  make release-patch    # 1.0.0 -> 1.0.1"; \
		echo "  make release-minor    # 1.0.0 -> 1.1.0"; \
		echo "  make release-major    # 1.0.0 -> 2.0.0"; \
		exit 1; \
	fi
	@$(MAKE) _do_release version=$(version)

# Default target
all: help
