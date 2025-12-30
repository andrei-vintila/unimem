import { App, Plugin, PluginSettingTab, Setting, TFile, Modal, normalizePath } from 'obsidian';

interface UnimemSettings {
	dailyNotesFolder: string;
	peopleFolder: string;
	companiesFolder: string;
	projectsFolder: string;
	tasksFolder: string;
	areasFolder: string;
	resourcesFolder: string;
	autoCreateEntities: boolean;
	enableConsolidation: boolean;
}

const DEFAULT_SETTINGS: UnimemSettings = {
	dailyNotesFolder: '00-daily',
	peopleFolder: '01-people',
	companiesFolder: '02-companies',
	projectsFolder: '03-projects',
	tasksFolder: '04-tasks',
	areasFolder: '05-areas',
	resourcesFolder: '06-resources',
	autoCreateEntities: true,
	enableConsolidation: false
};

export default class UnimemPlugin extends Plugin {
	settings: UnimemSettings;

	async onload() {
		await this.loadSettings();

		// Register event handlers
		this.registerEvent(
			this.app.metadataCache.on('resolved', () => {
				if (this.settings.autoCreateEntities) {
					this.detectAndCreateEntities();
				}
			})
		);

		// Add commands
		this.addCommand({
			id: 'create-daily-note',
			name: 'Create Daily Note',
			callback: () => this.createDailyNote()
		});

		this.addCommand({
			id: 'create-person',
			name: 'Create Person Entity',
			callback: () => this.createEntity('person')
		});

		this.addCommand({
			id: 'create-project',
			name: 'Create Project Entity',
			callback: () => this.createEntity('project')
		});

		this.addCommand({
			id: 'create-company',
			name: 'Create Company Entity',
			callback: () => this.createEntity('company')
		});

		// Add settings tab
		this.addSettingTab(new UnimemSettingTab(this.app, this));

		console.log('Unimem plugin loaded');
	}

	onunload() {
		console.log('Unimem plugin unloaded');
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async initializeFolders() {
		const folders = [
			this.settings.dailyNotesFolder,
			this.settings.peopleFolder,
			this.settings.companiesFolder,
			this.settings.projectsFolder,
			this.settings.tasksFolder,
			this.settings.areasFolder,
			this.settings.resourcesFolder
		];

		for (const folder of folders) {
			const normalizedPath = normalizePath(folder);
			if (!this.app.vault.getAbstractFileByPath(normalizedPath)) {
				await this.app.vault.createFolder(normalizedPath);
			}
		}
	}

	async createDailyNote() {
		const today = new Date();
		const dateStr = today.toISOString().split('T')[0];
		const fileName = `${dateStr}.md`;
		const filePath = normalizePath(`${this.settings.dailyNotesFolder}/${fileName}`);

		// Check if file already exists
		const existingFile = this.app.vault.getAbstractFileByPath(filePath);
		if (existingFile) {
			// Open existing file
			this.app.workspace.openLinkText(filePath, '', false);
			return;
		}

		const template = `---
date: ${dateStr}
type: daily
---

# Today's Focus

## Tasks
- [ ]

## Context


## Notes


---
## Memories Created Today
*Auto-linked by plugin*
`;

		await this.app.vault.create(filePath, template);
		this.app.workspace.openLinkText(filePath, '', false);
	}

	async createEntity(type: 'person' | 'project' | 'company') {
		const folderMap = {
			person: this.settings.peopleFolder,
			project: this.settings.projectsFolder,
			company: this.settings.companiesFolder
		};

		const templateMap = {
			person: `---
type: person
company: ""
tags: []
---

# Person Name

## Context


## Recent Interactions


## Related
Projects:
Areas:
`,
			project: `---
type: project
status: active
started: ${new Date().toISOString().split('T')[0]}
---

# Project Name

## Overview


## People


## Active Tasks


## Timeline

`,
			company: `---
type: company
tags: []
---

# Company Name

## Context


## People


## Projects


## Related
`
		};

		const folder = folderMap[type];
		const template = templateMap[type];

		// Prompt user for name
		const name = await this.promptForName(`Enter ${type} name:`);
		if (!name) return;

		const fileName = `${name.toLowerCase().replace(/\s+/g, '-')}.md`;
		const filePath = normalizePath(`${folder}/${fileName}`);

		// Check if file already exists
		const existingFile = this.app.vault.getAbstractFileByPath(filePath);
		if (existingFile) {
			this.app.workspace.openLinkText(filePath, '', false);
			return;
		}

		await this.app.vault.create(filePath, template.replace(/Name/g, name));
		this.app.workspace.openLinkText(filePath, '', false);
	}

	async promptForName(prompt: string): Promise<string | null> {
		return new Promise((resolve) => {
			const modal = new NamePromptModal(this.app, prompt, (name) => {
				resolve(name);
			});
			modal.open();
		});
	}

	detectAndCreateEntities() {
		// TODO: Implement entity detection from links
		// This will scan for [[entity]] links and auto-create entity files
		// if they don't exist yet
	}
}

class NamePromptModal extends Modal {
	prompt: string;
	onSubmit: (name: string) => void;

	constructor(app: App, prompt: string, onSubmit: (name: string) => void) {
		super(app);
		this.prompt = prompt;
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl('h3', { text: this.prompt });

		const inputEl = contentEl.createEl('input', {
			type: 'text',
			placeholder: 'Enter name...'
		});
		inputEl.style.width = '100%';
		inputEl.style.marginTop = '10px';

		inputEl.addEventListener('keypress', (e) => {
			if (e.key === 'Enter') {
				this.onSubmit(inputEl.value);
				this.close();
			}
		});

		inputEl.focus();
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

class UnimemSettingTab extends PluginSettingTab {
	plugin: UnimemPlugin;

	constructor(app: App, plugin: UnimemPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('h2', { text: 'Unimem Settings' });

		new Setting(containerEl)
			.setName('Create Folder Structure')
			.setDesc('Create all configured folders in your vault')
			.addButton(button => button
				.setButtonText('Create Folders')
				.setCta()
				.onClick(async () => {
					await this.plugin.initializeFolders();
					button.setButtonText('Folders Created!');
					setTimeout(() => {
						button.setButtonText('Create Folders');
					}, 2000);
				}));

		containerEl.createEl('h3', { text: 'Folder Locations' });

		new Setting(containerEl)
			.setName('Daily Notes Folder')
			.setDesc('Folder for daily notes (working memory)')
			.addText(text => text
				.setPlaceholder('00-daily')
				.setValue(this.plugin.settings.dailyNotesFolder)
				.onChange(async (value) => {
					this.plugin.settings.dailyNotesFolder = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('People Folder')
			.setDesc('Folder for people entities')
			.addText(text => text
				.setPlaceholder('01-people')
				.setValue(this.plugin.settings.peopleFolder)
				.onChange(async (value) => {
					this.plugin.settings.peopleFolder = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Companies Folder')
			.setDesc('Folder for company entities')
			.addText(text => text
				.setPlaceholder('02-companies')
				.setValue(this.plugin.settings.companiesFolder)
				.onChange(async (value) => {
					this.plugin.settings.companiesFolder = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Projects Folder')
			.setDesc('Folder for project entities')
			.addText(text => text
				.setPlaceholder('03-projects')
				.setValue(this.plugin.settings.projectsFolder)
				.onChange(async (value) => {
					this.plugin.settings.projectsFolder = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Tasks Folder')
			.setDesc('Folder for task entities')
			.addText(text => text
				.setPlaceholder('04-tasks')
				.setValue(this.plugin.settings.tasksFolder)
				.onChange(async (value) => {
					this.plugin.settings.tasksFolder = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Areas Folder')
			.setDesc('Folder for knowledge areas')
			.addText(text => text
				.setPlaceholder('05-areas')
				.setValue(this.plugin.settings.areasFolder)
				.onChange(async (value) => {
					this.plugin.settings.areasFolder = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Resources Folder')
			.setDesc('Folder for resources and references')
			.addText(text => text
				.setPlaceholder('06-resources')
				.setValue(this.plugin.settings.resourcesFolder)
				.onChange(async (value) => {
					this.plugin.settings.resourcesFolder = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Auto-create Entities')
			.setDesc('Automatically create entity files when linked')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.autoCreateEntities)
				.onChange(async (value) => {
					this.plugin.settings.autoCreateEntities = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Enable Consolidation')
			.setDesc('Enable weekly memory consolidation (experimental)')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableConsolidation)
				.onChange(async (value) => {
					this.plugin.settings.enableConsolidation = value;
					await this.plugin.saveSettings();
				}));
	}
}
