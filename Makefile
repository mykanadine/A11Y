# A11y-Agent — Developer Makefile
#
# Targets:
#   make            → install + build engine  (default)
#   make install    → npm install in a11y-agent
#   make build      → compile TypeScript engine
#   make ext        → compile VS Code extension
#   make local FILE=<path>              → scan a local file
#   make local FILE=<path> JIRA=<spec>  → scan with Jira spec
#   make scan PR=42 REPO=owner/repo     → scan a GitHub PR (dry-run)
#   make scan PR=42 REPO=owner/repo DRY=  → scan and post PR comment
#   make mcp        → start the MCP server (for Bob integration)
#   make clean      → remove dist/ and out/

AGENT_DIR := a11y-agent
EXT_DIR   := $(AGENT_DIR)/vscode-extension
ENGINE    := $(AGENT_DIR)/dist/index.js
NODE      := node
NPM       := npm

# Default: full install + build
.PHONY: all
all: install build

.PHONY: install
install:
	@echo "[a11y] Installing dependencies..."
	cd $(AGENT_DIR) && $(NPM) install --silent

.PHONY: build
build: install
	@echo "[a11y] Building engine..."
	cd $(AGENT_DIR) && $(NPM) run build --silent
	@echo "[a11y] Engine ready → $(ENGINE)"

.PHONY: ext
ext:
	@echo "[a11y] Building VS Code extension..."
	cd $(EXT_DIR) && $(NODE) node_modules/typescript/bin/tsc -p tsconfig-ext.json
	@echo "[a11y] Extension built → $(EXT_DIR)/out/extension.js"
	@echo "[a11y] Open $(EXT_DIR) in VS Code and press F5."

# Scan a local file. Required: FILE=path/to/file.tsx
# Optional: JIRA=path/to/spec.md
.PHONY: local
local: build
ifndef FILE
	$(error FILE is required. Usage: make local FILE=path/to/file.html)
endif
	@echo "[a11y] Scanning $(FILE)..."
	$(NODE) $(ENGINE) local $(FILE) $(if $(JIRA),--jira $(JIRA),)

# Scan a GitHub PR. Required: PR=<number> REPO=<owner/repo>
# Optional: DRY=1 (default dry-run; pass DRY= to actually post the comment)
DRY ?= 1
.PHONY: scan
scan: build
ifndef PR
	$(error PR is required. Usage: make scan PR=42 REPO=owner/repo)
endif
ifndef REPO
	$(error REPO is required. Usage: make scan PR=42 REPO=owner/repo)
endif
	@[ -n "$$GITHUB_TOKEN" ] || (echo "[a11y] ERROR: GITHUB_TOKEN not set. Export it first." && exit 1)
	@echo "[a11y] Scanning PR #$(PR) in $(REPO)$(if $(filter 1,$(DRY)), [dry-run],)..."
	$(NODE) $(ENGINE) scan $(PR) --repo $(REPO) $(if $(filter 1,$(DRY)),--dry-run,)

.PHONY: mcp
mcp: build
	@echo "[a11y] Starting MCP server (stdio)..."
	$(NODE) $(AGENT_DIR)/dist/mcp-server.js

.PHONY: clean
clean:
	@echo "[a11y] Cleaning build artifacts..."
	rm -rf $(AGENT_DIR)/dist $(EXT_DIR)/out
	@echo "[a11y] Clean."

# Convenience: scan the bundled test file
.PHONY: demo
demo: build
	@echo "[a11y] Running demo scan on test-sample.html..."
	$(NODE) $(ENGINE) local $(AGENT_DIR)/test-sample.html
