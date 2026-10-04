import { PluginSettingTab, Setting, getLanguage } from "obsidian";
import type { App } from "obsidian"; 
import SpatialTaskGraphPlugin from "./main"; 

const isSimplifiedChinese = (): boolean => {
    const obsidianLocale = getLanguage() || window.navigator.language || '';
    return /^(zh(?:-cn|-hans)?)(?:$|-)/i.test(obsidianLocale);
};

export class TaskGraphSettingTab extends PluginSettingTab {
    plugin: SpatialTaskGraphPlugin;

    constructor(app: App, plugin: SpatialTaskGraphPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        const zh = isSimplifiedChinese();
        const text = zh ? {
            advanced: '启用高级功能', advancedDesc: '启用实验性的任务图功能。',
            autoFit: '布局后自动适应视图', autoFitDesc: '运行智能布局后是否缩放以显示全部节点。',
            syncHierarchy: '布局前同步层级', syncHierarchyDesc: '布局前根据 checklist 缩进补充父子关系。',
            taskNotesHeading: 'TaskNotes 集成', enableTaskNotes: '启用 TaskNotes', enableTaskNotesDesc: '读取 TaskNotes frontmatter，并与 checklist 任务一起显示。',
            identification: '识别方式', tag: 'Frontmatter 标签', property: '属性和值', taskTag: '任务标签', taskTagDesc: '例如：task 或 tasks。',
            propertyName: '任务属性名', propertyValue: '任务属性值', titleProperty: '标题属性', statusProperty: '状态属性',
            backlog: '待办状态', inProgress: '进行中状态', finished: '完成状态', statusDesc: '用逗号分隔保存的状态值。',
            clearIndex: '清除任务索引', clearIndexDesc: '清除看板索引、任务引用和插件生成的块引用。不会删除任务内容。', clearIndexConfirm: '再次点击确认清除', clearIndexDone: '已清除（删除 {count} 个块引用）'
        } : {
            advanced: 'Enable advanced features', advancedDesc: 'Turn on to enable experimental task graph features.',
            autoFit: 'Auto-fit after layout', autoFitDesc: 'Whether to zoom out to show all nodes after running smart layout.',
            syncHierarchy: 'Sync hierarchy before layout', syncHierarchyDesc: 'Add missing parent-child links from checklist indentation before running layout.',
            taskNotesHeading: 'TaskNotes integration', enableTaskNotes: 'Enable TaskNotes', enableTaskNotesDesc: 'Read TaskNotes frontmatter alongside checklist tasks.',
            identification: 'Identification method', tag: 'Frontmatter tag', property: 'Property and value', taskTag: 'Task tag', taskTagDesc: 'For example: task or tasks.',
            propertyName: 'Task property name', propertyValue: 'Task property value', titleProperty: 'Title property', statusProperty: 'Status property',
            backlog: 'Backlog statuses', inProgress: 'In-progress statuses', finished: 'Finished statuses', statusDesc: 'Comma-separated stored status values.',
            clearIndex: 'Clear task index', clearIndexDesc: 'Clear board indexes, task references, and plugin-generated block references. Task content will not be deleted.', clearIndexConfirm: 'Click again to confirm', clearIndexDone: 'Cleared ({count} block references removed)'
        };

        containerEl.empty();

        new Setting(containerEl)
            .setName(text.advanced)
            .setDesc(text.advancedDesc)
            .addToggle(toggle => toggle
                .setValue(true)
                .onChange(async (value) => {
                    await this.plugin.saveSettings();
                }));
        new Setting(containerEl)
        .setName(text.autoFit)
        .setDesc(text.autoFitDesc)
        .addToggle(toggle => toggle
            .setValue(this.plugin.settings.autoFitAfterLayout)
            .onChange(async (value) => {
                this.plugin.settings.autoFitAfterLayout = value;
                await this.plugin.saveSettings();
            }));
        new Setting(containerEl)
        .setName(text.syncHierarchy)
        .setDesc(text.syncHierarchyDesc)
        .addToggle(toggle => toggle
            .setValue(this.plugin.settings.autoSyncHierarchy)
            .onChange(async (value) => {
                this.plugin.settings.autoSyncHierarchy = value;
                await this.plugin.saveSettings();
            }));

        new Setting(containerEl).setName(text.taskNotesHeading).setHeading();
        let taskNotesOptions: HTMLElement | null = null;
        new Setting(containerEl).setName(text.enableTaskNotes).setDesc(text.enableTaskNotesDesc)
            .addToggle(toggle => toggle.setValue(this.plugin.settings.taskNotes.enabled).onChange(async value => {
                this.plugin.settings.taskNotes.enabled = value;
                await this.plugin.saveSettings();
                this.plugin.refreshTaskNotesCache();
                if (taskNotesOptions) taskNotesOptions.style.display = value ? '' : 'none';
            }));
        taskNotesOptions = containerEl.createDiv();
        taskNotesOptions.style.display = this.plugin.settings.taskNotes.enabled ? '' : 'none';
        new Setting(taskNotesOptions).setName(text.identification).addDropdown(dropdown => dropdown
            .addOption('tag', text.tag).addOption('property', text.property)
            .setValue(this.plugin.settings.taskNotes.identificationMethod)
            .onChange(async value => {
                this.plugin.settings.taskNotes.identificationMethod = value as 'tag' | 'property';
                await this.plugin.saveSettings(); this.plugin.refreshTaskNotesCache();
            }));
        new Setting(taskNotesOptions).setName(text.taskTag).setDesc(text.taskTagDesc)
            .addText(text => text.setValue(this.plugin.settings.taskNotes.taskTag).onChange(async value => {
                this.plugin.settings.taskNotes.taskTag = value; await this.plugin.saveSettings(); this.plugin.refreshTaskNotesCache();
            }));
        new Setting(taskNotesOptions).setName(text.propertyName).addText(text => text.setValue(this.plugin.settings.taskNotes.propertyName).onChange(async value => {
            this.plugin.settings.taskNotes.propertyName = value; await this.plugin.saveSettings(); this.plugin.refreshTaskNotesCache();
        }));
        new Setting(taskNotesOptions).setName(text.propertyValue).addText(text => text.setValue(this.plugin.settings.taskNotes.propertyValue).onChange(async value => {
            this.plugin.settings.taskNotes.propertyValue = value; await this.plugin.saveSettings(); this.plugin.refreshTaskNotesCache();
        }));
        new Setting(taskNotesOptions).setName(text.titleProperty).addText(text => text.setValue(this.plugin.settings.taskNotes.titleProperty).onChange(async value => {
            this.plugin.settings.taskNotes.titleProperty = value; await this.plugin.saveSettings(); this.plugin.refreshTaskNotesCache();
        }));
        new Setting(taskNotesOptions).setName(text.statusProperty).addText(text => text.setValue(this.plugin.settings.taskNotes.statusProperty).onChange(async value => {
            this.plugin.settings.taskNotes.statusProperty = value; await this.plugin.saveSettings(); this.plugin.refreshTaskNotesCache();
        }));
        const statusSetting = (name: string, key: 'backlogStatuses' | 'inProgressStatuses' | 'finishedStatuses') => new Setting(taskNotesOptions)
            .setName(name).setDesc(text.statusDesc)
            .addText(text => text.setValue(this.plugin.settings.taskNotes[key]).onChange(async value => {
                this.plugin.settings.taskNotes[key] = value; await this.plugin.saveSettings(); this.plugin.refreshTaskNotesCache();
            }));
        statusSetting(text.backlog, 'backlogStatuses');
        statusSetting(text.inProgress, 'inProgressStatuses');
        statusSetting(text.finished, 'finishedStatuses');
        let clearArmed = false;
        let clearTimer: number | undefined;
        new Setting(taskNotesOptions).setName(text.clearIndex).setDesc(text.clearIndexDesc)
            .addButton(button => button.setButtonText(text.clearIndex).setWarning().onClick(() => {
                void (async () => {
                    if (!clearArmed) {
                        clearArmed = true;
                        button.setButtonText(text.clearIndexConfirm);
                        if (clearTimer !== undefined) window.clearTimeout(clearTimer);
                        clearTimer = window.setTimeout(() => {
                            clearArmed = false;
                            button.setButtonText(text.clearIndex);
                        }, 5000);
                        return;
                    }
                    clearArmed = false;
                    if (clearTimer !== undefined) window.clearTimeout(clearTimer);
                    const removedCount = await this.plugin.clearTaskIndexAndGeneratedBlockIds();
                    button.setButtonText(text.clearIndexDone.replace('{count}', String(removedCount)));
                    window.setTimeout(() => {
                        button.setButtonText(text.clearIndex);
                    }, 3000);
                })();
            }));
    }
}
