# CLAUDE.md - AI Assistant Guide for Unimem

This document provides comprehensive guidance for AI assistants working with the Unimem codebase.

## Project Overview

**Unimem** is a neural memory architecture system that organizes information using cognitive memory systems. It's designed to mirror how human memory works, separating information into different memory layers (working, episodic, semantic, and procedural).

### Core Concept

The system implements a cognitive memory architecture:

- **Working Memory** (daily notes) - Short-term context, current tasks
- **Episodic Memory** (people, companies, projects) - Events and relationships
- **Semantic Memory** (areas, resources) - Abstract conceptual knowledge
- **Procedural Memory** (tasks) - Action-oriented workflows

### Key Technologies

- **Language**: TypeScript (strict mode enabled)
- **Package Manager**: pnpm v9.15.0 (workspaces)
- **Database**: PGlite (Postgres in browser) + Drizzle ORM
- **Sync**: ElectricSQL (local-first architecture)
- **Vector Search**: pgvector (for semantic similarity)
- **Embedding**: OpenAI API (configurable)
- **Node Version**: >=20.0.0

## Repository Structure

This is a **pnpm monorepo** with the following structure:

```
unimem/
├── packages/              # Shared libraries
│   ├── types/            # TypeScript type definitions
│   ├── core/             # Core memory engine logic
│   └── db/               # Database schema & adapters
├── apps/                 # Applications
│   ├── web/              # Nuxt 4 web application
│   ├── desktop/          # Tauri desktop app
│   └── server/           # Nitro v3 API server (Cloudflare Workers)
├── plugins/              # Platform plugins
│   └── obsidian/         # Obsidian plugin
├── pnpm-workspace.yaml   # Workspace configuration
└── tsconfig.json         # Root TypeScript config
```

### Package Details

#### `packages/types`
- Defines all TypeScript interfaces and types
- No runtime dependencies
- Referenced by all other packages
- Key exports: `Entity`, `MemoryLayerType`, `EntityType`, `VectorQuery`, etc.
- Located at: `packages/types/src/index.ts`

#### `packages/core`
- Core memory engine implementation
- `MemoryEngine` class - main orchestration
- Consolidation logic (memory processing)
- Retrieval algorithms (vector search, filtering)
- Embedding utilities
- Dependencies: `@unimem/types`

#### `packages/db`
- Drizzle ORM schema definitions
- PGlite client configuration
- Storage adapters
- Sync logic with ElectricSQL
- Key files:
  - `src/schema.ts` - Database tables (entities, people, projects, etc.)
  - `src/client.ts` - PGlite client setup
  - `src/storage-adapter.ts` - Storage interface implementation
  - `src/sync.ts` - ElectricSQL sync logic

#### `apps/web`
- **Framework**: Nuxt 4 (compatibility mode)
- **UI**: Tailwind CSS + Vue 3
- **State**: Pinia stores
- **Composables**: `useMemory` for memory operations
- **Components**: Vue SFCs in `app/components/`
- **Pages**: File-based routing in `app/pages/`
- Build: Transpiles workspace packages (`@unimem/*`)

#### `apps/server`
- **Framework**: Nitro v3
- **Preset**: `cloudflare-module` (Cloudflare Workers)
- **API Routes**: File-based routing in `routes/api/`
- **Endpoints**:
  - `/api/health` - Health check
  - `/api/embed.post` - Generate embeddings
  - `/api/sync/pull.get` - Pull sync changes
  - `/api/sync/push.post` - Push sync changes
- **Config**: `nitro.config.ts`
- **CORS**: Enabled for all `/api/**` routes

#### `apps/desktop`
- **Framework**: Tauri v2
- **Frontend**: Shares code with web app
- **Backend**: Rust (`src-tauri/`)
- Local-first architecture with PGlite

#### `plugins/obsidian`
- Obsidian plugin for vault integration
- Creates neural memory folder structure
- Commands for entity creation
- Build: esbuild (outputs `main.js`)

## Development Workflows

### Initial Setup

```bash
# Install dependencies (root and all workspaces)
pnpm install

# Build all packages (types → core → db)
pnpm run build:packages
```

### Development Commands

```bash
# Run specific app in dev mode
pnpm run dev              # Web app (Nuxt)
pnpm run dev:desktop      # Desktop app (Tauri)
pnpm run dev:server       # API server (Nitro)
pnpm run dev:obsidian     # Obsidian plugin

# Build commands
pnpm run build            # Build everything
pnpm run build:packages   # Build packages only (required before apps)
pnpm run build:web        # Build web app
pnpm run build:desktop    # Build desktop app
pnpm run build:server     # Build server
pnpm run build:obsidian   # Build Obsidian plugin

# Type checking
pnpm run typecheck        # TypeScript type check across workspace

# Clean everything
pnpm run clean            # Remove all node_modules and build artifacts
```

### Build Order Dependencies

**CRITICAL**: Always build packages in this order:
1. `@unimem/types` (no dependencies)
2. `@unimem/core` (depends on types)
3. `@unimem/db` (depends on types)
4. Apps (depend on all packages)

When making changes to packages, rebuild them before running/building apps.

## Key Conventions

### TypeScript

- **Strict mode**: Enabled (`strict: true`)
- **Module resolution**: `bundler`
- **Target**: ES2022
- **Path aliases**:
  ```typescript
  @unimem/types  → packages/types/src
  @unimem/core   → packages/core/src
  @unimem/db     → packages/db/src
  ```

### Code Organization

#### File Headers
All core files use structured headers:
```typescript
// =============================================================================
// Module Name - Brief Description
// =============================================================================

// -----------------------------------------------------------------------------
// Section Name
// -----------------------------------------------------------------------------
```

#### Entity Types
The system uses a strict entity type hierarchy:
- `daily-note` → working memory
- `person`, `company`, `project` → episodic memory
- `task` → procedural memory
- `area`, `resource` → semantic memory

#### Memory Layer Assignment
Each entity must have a `memoryLayer` field that determines its retention policy and consolidation behavior.

### Database Schema

- **IDs**: UUID v4 (`uuid('id').primaryKey().defaultRandom()`)
- **Timestamps**: All entities have `createdAt` and `updatedAt`
- **Soft deletes**: Not implemented (use hard deletes)
- **Indexes**: Created on frequently queried fields (type, memoryLayer, createdAt)
- **Relations**: Stored as JSONB arrays for flexibility
- **Embeddings**: Stored as `real[]` (future: native `vector` type)

### API Design

#### Nitro Event Handlers
```typescript
export default defineEventHandler(async (event) => {
  // Handler logic
});
```

#### Response Format
```typescript
interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: ApiError;
}
```

### Vue/Nuxt Conventions

- **Composition API**: Use `<script setup>` syntax
- **Auto-imports**: Nuxt auto-imports composables, components, utils
- **State Management**: Pinia stores in `app/stores/`
- **Styling**: Tailwind CSS classes, scoped styles when needed

## Important File Locations

### Type Definitions
- All types: `packages/types/src/index.ts` (single file)

### Core Logic
- Memory engine: `packages/core/src/memory-engine.ts`
- Consolidation: `packages/core/src/consolidation.ts`
- Retrieval: `packages/core/src/retrieval.ts`
- Embedding: `packages/core/src/embedding.ts`

### Database
- Schema: `packages/db/src/schema.ts`
- Client: `packages/db/src/client.ts`
- Drizzle config: `packages/db/drizzle.config.ts`

### Server
- Nitro config: `apps/server/nitro.config.ts`
- API routes: `apps/server/routes/api/**/*.ts`
- Auth utils: `apps/server/utils/auth.ts`

### Web App
- Nuxt config: `apps/web/nuxt.config.ts`
- Tailwind config: `apps/web/tailwind.config.ts`
- Main store: `apps/web/app/stores/memory.ts`
- Memory composable: `apps/web/app/composables/useMemory.ts`

### Obsidian Plugin
- Main plugin: `plugins/obsidian/main.ts`
- Manifest: `plugins/obsidian/manifest.json`
- Build config: `plugins/obsidian/esbuild.config.mjs`

## Common Patterns

### Creating Entities

Always use the `MemoryEngine.createEntity()` method:
```typescript
const entity = await memoryEngine.createEntity({
  type: 'person',
  title: 'John Doe',
  content: 'Software engineer at Acme Corp',
  memoryLayer: 'episodic',
  links: [],
  tags: ['colleague'],
});
```

### Vector Search

```typescript
const results = await memoryEngine.searchSimilar('project planning', {
  limit: 10,
  threshold: 0.7,
  filter: {
    types: ['project', 'task'],
    memoryLayers: ['episodic', 'procedural'],
  },
});
```

### Event Handling

```typescript
memoryEngine.on('entity:created', (event) => {
  console.log('New entity:', event.payload);
});
```

### Storage Adapter Pattern

All storage implementations must conform to the `StorageAdapter` interface defined in `packages/core/src/memory-engine.ts`.

## Testing Strategy

Currently, the project **does not have formal tests**. When adding tests:
- Use Vitest for unit tests
- Test packages independently before apps
- Mock external services (OpenAI API, database)
- Focus on core memory engine logic first

## Git Workflow

### Branch Naming
- Feature branches: `claude/description-sessionId`
- All development on feature branches
- Push to: `origin <branch-name>` with `-u` flag

### Commit Messages
- Use conventional commit format when possible
- Focus on "why" rather than "what"
- Reference related entities/features

### Ignored Files
Key items in `.gitignore`:
- `node_modules/`, `dist/`, `.output/`, `.nuxt/`
- `*.db` (PGlite databases)
- `.wrangler/`, `node-compile-cache/`
- `apps/desktop/src-tauri/target/`
- `drizzle/` (generated migrations)

## Runtime Configuration

### Environment Variables

#### Server (`apps/server`)
```bash
OPENAI_API_KEY=         # Required for embeddings
DATABASE_URL=           # Postgres connection (optional for local dev)
```

#### Web App (`apps/web`)
```bash
OPENAI_API_KEY=         # Server-side only
NUXT_PUBLIC_SYNC_SERVER_URL=  # Sync server URL
```

### Cloudflare Deployment
- Server uses `cloudflare-module` preset
- Configuration in `apps/server/wrangler.toml`
- Bindings: D1 database, environment variables

## Common Issues & Solutions

### Build Failures

**Issue**: "Cannot find module '@unimem/types'"
**Solution**: Run `pnpm run build:packages` before building apps

**Issue**: TypeScript errors in apps about workspace packages
**Solution**: Ensure packages are built and have `dist/` directories

### PGlite Issues

**Issue**: Worker/WASM errors in browser
**Solution**: Check Vite config excludes PGlite from optimization
```typescript
optimizeDeps: {
  exclude: ['@electric-sql/pglite'],
}
```

### Sync Conflicts

**Issue**: ElectricSQL sync conflicts
**Solution**: Check `syncLog` table for conflict records, implement resolution logic in `packages/db/src/sync.ts`

## AI Assistant Guidelines

### When Modifying Code

1. **Understand the memory layer architecture** - Don't violate the cognitive memory model
2. **Check entity type mappings** - Each type belongs to a specific memory layer
3. **Maintain strict TypeScript** - No `any` types, handle nulls properly
4. **Update types first** - If changing interfaces, start in `packages/types`
5. **Rebuild packages** - After changes to packages, rebuild before testing apps
6. **Follow file header conventions** - Maintain the structured comment format
7. **Consider embedding generation** - Content changes may require re-embedding
8. **Think local-first** - All operations should work offline

### When Adding Features

1. **Start with types** - Define interfaces in `packages/types`
2. **Core logic next** - Implement in `packages/core` or `packages/db`
3. **API layer** - Add server endpoints in `apps/server/routes/api/`
4. **UI last** - Build frontend in `apps/web` or `apps/desktop`
5. **Update this document** - Add new patterns/conventions to CLAUDE.md

### When Debugging

1. **Check build order** - Packages must be built before apps
2. **Verify imports** - Use workspace references (`@unimem/*`)
3. **Check console** - Event handlers log errors to console
4. **Inspect database** - Use PGlite dev tools or query directly
5. **Review sync status** - Check `syncStatus` field on entities

### Forbidden Actions

- **Don't skip type checking** - Always run `pnpm typecheck`
- **Don't break memory layer rules** - Each entity type has a fixed layer
- **Don't use `any` types** - Maintain strict typing
- **Don't create circular dependencies** - Respect package dependency tree
- **Don't commit without building** - Ensure builds succeed
- **Don't ignore consolidation policies** - Memory retention is architectural

## Architecture Diagrams

### Data Flow
```
User Input (Web/Desktop/Obsidian)
    ↓
Memory Engine (packages/core)
    ↓
Storage Adapter (packages/db)
    ↓
PGlite (local database)
    ↓
ElectricSQL Sync
    ↓
Server API (apps/server)
    ↓
Remote Database
```

### Memory Consolidation Flow
```
Working Memory (daily notes)
    ↓ (pattern detection)
Episodic Memory (people, projects)
    ↓ (abstraction)
Semantic Memory (areas, resources)
```

### Package Dependencies
```
types (no deps)
    ↑
    ├── core
    └── db
        ↑
        └── apps (web, desktop, server)
```

## Future Considerations

### Planned Features (from README)
- Auto-create entity files when referenced
- Weekly memory consolidation (automated)
- Pattern detection across daily notes
- Automatic backlink updates
- Timeline views for episodic memory

### Technical Debt
- Native pgvector support (currently using real[])
- Formal test suite
- Migration tooling (Drizzle migrations)
- Conflict resolution UI
- Performance optimization for large datasets

## Resources

- **Repository**: https://github.com/andreivintila/unimem
- **License**: MIT (Copyright 2025 Andrei Vintila)
- **Author**: Andrei Vintila

## Version Information

- **Current Version**: 0.1.0
- **Node Requirement**: >=20.0.0
- **Package Manager**: pnpm@9.15.0

---

**Last Updated**: 2025-12-30

This document should be updated whenever:
- New packages/apps are added
- Architecture changes significantly
- New conventions are established
- Build process changes
- Major dependencies are updated
