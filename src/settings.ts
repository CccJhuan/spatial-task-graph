import { PluginSettingTab, Setting } from "obsidian";
import type { App } from "obsidian"; // 修复 3: 使用 type 导入
import SpatialTaskGraphPlugin from "./main"; // 确保与 main.ts 里的类名一致

export class TaskGraphSettingTab extends PluginSettingTab {
    plugin: SpatialTaskGraphPlugin;

    constructor(app: App, plugin: SpatialTaskGraphPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;

        containerEl.empty();

        // 修复 4: 使用官方标准 API 生成标题，取代 createEl('h2')
        new Setting(containerEl)
            .setName('Spatial Task Graph Settings')
            .setHeading();

        // 示例设置项：你可以根据需要修改或添加
        new Setting(containerEl)
            .setName('Plugin Information')
            .setDesc('Visualize your Obsidian tasks on an infinite canvas.')
            .addButton(btn => btn
                .setButtonText('View Documentation')
                .onClick(() => {
                    window.open('https://github.com/CccJhuan/obsidian-spatial-task-graph');
                }));

    }
}