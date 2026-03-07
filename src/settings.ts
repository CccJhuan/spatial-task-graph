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
    }
}