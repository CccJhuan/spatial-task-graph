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
    }
}