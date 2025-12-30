# Unimem

Neural memory architecture plugin for Obsidian - organize your notes using cognitive memory systems.

## Overview

Unimem structures your Obsidian vault based on how human memory actually works, separating information into:

- **Working Memory** (00-daily) - Daily notes as your immediate thought space
- **Episodic Memory** (01-people, 02-companies, 03-projects) - Context about events and relationships
- **Procedural Memory** (04-tasks) - Action-oriented knowledge
- **Semantic Memory** (05-areas, 06-resources) - Long-term conceptual knowledge

## Folder Structure

```
vault/
├── 00-daily/              # Working Memory layer
├── 01-people/             # Episodic - relationship context
├── 02-companies/          # Semantic - organizational knowledge
├── 03-projects/           # Episodic + Procedural
├── 04-tasks/              # Procedural memory
├── 05-areas/              # Semantic - domain knowledge
└── 06-resources/          # Long-term semantic storage
```

## Features

### Current (v0.1.0)

- **Automatic Folder Creation**: Creates the neural memory hierarchy on plugin activation
- **Quick Entity Creation**: Commands to create daily notes, people, companies, and projects
- **Smart Templates**: Pre-configured templates with YAML frontmatter for each entity type
- **Configurable Folders**: Customize folder names and locations in settings
- **Bidirectional Linking**: Templates encourage linking between entities

### Commands

- `Create Daily Note` - Generate today's daily note with template
- `Create Person Entity` - Create a new person with relationship template
- `Create Project Entity` - Create a new project with tracking template
- `Create Company Entity` - Create a new company with context template

### Planned Features

- Auto-create entity files when referenced in links (entity detection)
- Weekly memory consolidation (summarize daily notes into projects/areas)
- Pattern detection across daily notes
- Automatic backlink updates
- Timeline views for episodic memory

## Installation

### Manual Installation

1. Download the latest release from GitHub
2. Extract the files to `{vault}/.obsidian/plugins/unimem/`
3. Reload Obsidian
4. Enable the plugin in Settings > Community Plugins

### Development Installation

1. Clone this repo into your vault's plugins folder:
   ```bash
   cd {vault}/.obsidian/plugins
   git clone https://github.com/andreivintila/unimem.git
   cd unimem
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the plugin:
   ```bash
   npm run build
   ```

4. Reload Obsidian and enable the plugin

## Development

```bash
# Install dependencies
npm install

# Start development mode (auto-rebuild on changes)
npm run dev

# Build for production
npm run build

# Bump version
npm version patch|minor|major
```

## Settings

Configure folder paths for each memory layer:

- **Daily Notes Folder** - Default: `00-daily`
- **People Folder** - Default: `01-people`
- **Companies Folder** - Default: `02-companies`
- **Projects Folder** - Default: `03-projects`
- **Tasks Folder** - Default: `04-tasks`
- **Areas Folder** - Default: `05-areas`
- **Resources Folder** - Default: `06-resources`

Toggle features:

- **Auto-create Entities** - Automatically create files when linked (coming soon)
- **Enable Consolidation** - Weekly memory consolidation (experimental)

## Architecture

The plugin implements a cognitive memory architecture:

1. **Working Memory (Daily)**: Entry point for all information. Daily notes capture immediate thoughts and observations.

2. **Episodic Memory (People/Companies/Projects)**: Context-rich entities that represent experiences and relationships. Each entity links back to daily notes where it was mentioned.

3. **Procedural Memory (Tasks)**: Action-oriented knowledge - how to do things, workflows, and processes.

4. **Semantic Memory (Areas/Resources)**: Abstract conceptual knowledge extracted from repeated patterns in episodic memory.

### Memory Consolidation

Similar to how sleep consolidates memories in the brain, the plugin (planned feature) will periodically analyze daily notes to:

- Extract recurring patterns
- Update entity relationships
- Promote important information to semantic memory
- Suggest connections between entities

## Templates

### Daily Note

```markdown
---
date: YYYY-MM-DD
type: daily
---

# Today's Focus

## Tasks
- [ ]

## Context

## Notes

---
## Memories Created Today
```

### Person Entity

```markdown
---
type: person
company: ""
tags: []
---

# Person Name

## Context
## Recent Interactions
## Related
```

### Project Entity

```markdown
---
type: project
status: active
started: YYYY-MM-DD
---

# Project Name

## Overview
## People
## Active Tasks
## Timeline
```

## Philosophy

Unimem is built on the principle that knowledge management should mirror cognitive architecture. By separating information into memory systems that parallel human cognition, your vault becomes more intuitive and naturally organized.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT

## Support

For issues and feature requests, please visit the [GitHub repository](https://github.com/andreivintila/unimem).
