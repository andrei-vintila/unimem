# Unimem — convenience commands
# Usage: make <target>
# Run `make help` to list all targets.

.DEFAULT_GOAL := help

# ── Setup ──────────────────────────────────────────────────────────────────

.PHONY: install
install: ## Install all dependencies
	pnpm install

.PHONY: clean
clean: ## Remove all build artifacts and node_modules
	pnpm clean

# ── Development ────────────────────────────────────────────────────────────

.PHONY: dev
dev: ## Start web app in dev mode
	pnpm dev

.PHONY: dev-server
dev-server: ## Start Nitro server in dev mode
	pnpm dev:server

.PHONY: dev-desktop
dev-desktop: ## Start desktop app in dev mode (requires Rust)
	pnpm dev:desktop

.PHONY: dev-obsidian
dev-obsidian: ## Start Obsidian plugin in watch mode
	pnpm dev:obsidian

# ── Build ──────────────────────────────────────────────────────────────────

.PHONY: build
build: ## Build everything (packages + all apps)
	pnpm build:packages
	pnpm build:server
	pnpm build:web
	pnpm build:obsidian

.PHONY: build-packages
build-packages: ## Build shared packages (types → core → db)
	pnpm build:packages

.PHONY: build-server
build-server: build-packages ## Build Nitro server
	pnpm build:server

.PHONY: build-web
build-web: build-packages ## Build Nuxt web app
	pnpm build:web

.PHONY: build-obsidian
build-obsidian: build-packages ## Build Obsidian plugin
	pnpm build:obsidian

.PHONY: build-desktop
build-desktop: build-packages ## Build Tauri desktop app (requires Rust + system deps)
	pnpm build:desktop

# ── Quality ────────────────────────────────────────────────────────────────

.PHONY: typecheck
typecheck: build-packages ## Run TypeScript type checking
	pnpm typecheck

# ── Deploy ─────────────────────────────────────────────────────────────────
# Requires: CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in environment
# or in a .env file (not committed).

.PHONY: deploy-server
deploy-server: build-server ## Build + deploy server to Cloudflare Workers (production)
	cd apps/server && npx wrangler deploy --env production

.PHONY: deploy-server-staging
deploy-server-staging: build-server ## Build + deploy server to Cloudflare Workers (staging)
	cd apps/server && npx wrangler deploy

.PHONY: deploy-web
deploy-web: ## Build + deploy web app to Cloudflare Pages (production)
	pnpm build:packages
	pnpm --filter @unimem/web generate
	cd apps/web && npx wrangler pages deploy .output/public --project-name unimem-web

.PHONY: deploy-web-staging
deploy-web-staging: ## Build + deploy web app to Cloudflare Pages (staging branch)
	pnpm build:packages
	pnpm --filter @unimem/web generate
	cd apps/web && npx wrangler pages deploy .output/public --project-name unimem-web --branch staging

.PHONY: deploy
deploy: deploy-server deploy-web ## Deploy server + web to production

# ── Utilities ──────────────────────────────────────────────────────────────

.PHONY: help
help: ## Show this help message
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-22s\033[0m %s\n", $$1, $$2}'
