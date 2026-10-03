import { PluginSettingTab, Setting } from "obsidian";
import type { App } from "obsidian"; 
import SpatialTaskGraphPlugin from "./main"; 

export class TaskGraphSettingTab extends PluginSettingTab {
    plugin: SpatialTaskGraphPlugin;

    constructor(app: App, plugin: SpatialTaskGraphPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;

        containerEl.empty();

        new Setting(containerEl)
            .setName('Enable advanced features')
            .setDesc('Turn on to enable experimental task graph features.')
            .addToggle(toggle => toggle
                .setValue(true)
                .onChange(async (value) => {
                    await this.plugin.saveSettings();
                }));
        new Setting(containerEl)
        .setName('Auto-fit after layout')
        .setDesc('Whether to zoom out to show all nodes after running smart layout.')
        .addToggle(toggle => toggle
            .setValue(this.plugin.settings.autoFitAfterLayout)
            .onChange(async (value) => {
                this.plugin.settings.autoFitAfterLayout = value;
                await this.plugin.saveSettings();
            }));
        new Setting(containerEl)
        .setName('Sync hierarchy before layout')
        .setDesc('Add missing parent-child links from checklist indentation before running layout.')
        .addToggle(toggle => toggle
            .setValue(this.plugin.settings.autoSyncHierarchy)
            .onChange(async (value) => {
                this.plugin.settings.autoSyncHierarchy = value;
                await this.plugin.saveSettings();
            }));

        // eslint-disable-next-line obsidianmd/ui/sentence-case
        new Setting(containerEl).setName('TaskNotes integration').setHeading();
        let taskNotesOptions: HTMLElement | null = null;
        // eslint-disable-next-line obsidianmd/ui/sentence-case
        new Setting(containerEl).setName('Enable TaskNotes').setDesc('Read TaskNotes frontmatter alongside checklist tasks.')
            .addToggle(toggle => toggle.setValue(this.plugin.settings.taskNotes.enabled).onChange(async value => {
                this.plugin.settings.taskNotes.enabled = value;
                await this.plugin.saveSettings();
                this.plugin.refreshTaskNotesCache();
                if (taskNotesOptions) taskNotesOptions.style.display = value ? '' : 'none';
            }));
        taskNotesOptions = containerEl.createDiv();
        taskNotesOptions.style.display = this.plugin.settings.taskNotes.enabled ? '' : 'none';
        new Setting(taskNotesOptions).setName('Identification method').addDropdown(dropdown => dropdown
            .addOption('tag', 'Frontmatter tag').addOption('property', 'Property and value')
            .setValue(this.plugin.settings.taskNotes.identificationMethod)
            .onChange(async value => {
                this.plugin.settings.taskNotes.identificationMethod = value as 'tag' | 'property';
                await this.plugin.saveSettings(); this.plugin.refreshTaskNotesCache();
            }));
        new Setting(taskNotesOptions).setName('Task tag').setDesc('For example: task or tasks.')
            .addText(text => text.setValue(this.plugin.settings.taskNotes.taskTag).onChange(async value => {
                this.plugin.settings.taskNotes.taskTag = value; await this.plugin.saveSettings(); this.plugin.refreshTaskNotesCache();
            }));
        new Setting(taskNotesOptions).setName('Task property name').addText(text => text.setValue(this.plugin.settings.taskNotes.propertyName).onChange(async value => {
            this.plugin.settings.taskNotes.propertyName = value; await this.plugin.saveSettings(); this.plugin.refreshTaskNotesCache();
        }));
        new Setting(taskNotesOptions).setName('Task property value').addText(text => text.setValue(this.plugin.settings.taskNotes.propertyValue).onChange(async value => {
            this.plugin.settings.taskNotes.propertyValue = value; await this.plugin.saveSettings(); this.plugin.refreshTaskNotesCache();
        }));
        new Setting(taskNotesOptions).setName('Title property').addText(text => text.setValue(this.plugin.settings.taskNotes.titleProperty).onChange(async value => {
            this.plugin.settings.taskNotes.titleProperty = value; await this.plugin.saveSettings(); this.plugin.refreshTaskNotesCache();
        }));
        new Setting(taskNotesOptions).setName('Status property').addText(text => text.setValue(this.plugin.settings.taskNotes.statusProperty).onChange(async value => {
            this.plugin.settings.taskNotes.statusProperty = value; await this.plugin.saveSettings(); this.plugin.refreshTaskNotesCache();
        }));
        const statusSetting = (name: string, key: 'backlogStatuses' | 'inProgressStatuses' | 'finishedStatuses') => new Setting(taskNotesOptions)
            .setName(name).setDesc('Comma-separated stored status values.')
            .addText(text => text.setValue(this.plugin.settings.taskNotes[key]).onChange(async value => {
                this.plugin.settings.taskNotes[key] = value; await this.plugin.saveSettings(); this.plugin.refreshTaskNotesCache();
            }));
        statusSetting('Backlog statuses', 'backlogStatuses');
        statusSetting('In-progress statuses', 'inProgressStatuses');
        statusSetting('Finished statuses', 'finishedStatuses');
    }
}
