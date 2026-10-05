import { PluginSettingTab, Setting } from "obsidian";
import type { App } from "obsidian"; 
import SpatialTaskGraphPlugin from "./main";
import { isSimplifiedChinese } from "./language";
import { ClearIndexModal } from "./clearIndexModal";
import { addArchivedBoardControls } from './archivedBoardSettings';

// Kept local so the plugin can compile against older Obsidian type definitions.
// Obsidian 1.13+ consumes this shape for declarative settings search/rendering.
type SettingDefinition = {
    name: string;
    desc?: string;
    visible?: boolean | (() => boolean);
    action?: () => void;
    render?: (setting: Setting) => void;
    control?: { type: 'toggle' | 'text' | 'dropdown'; key: string; defaultValue?: unknown; options?: Record<string, string> };
};

export class TaskGraphSettingTab extends PluginSettingTab {
    plugin: SpatialTaskGraphPlugin;
    private clearIndexModal?: ClearIndexModal;

    constructor(app: App, plugin: SpatialTaskGraphPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    /**
     * Supplies searchable settings on Obsidian 1.13+ while display() remains
     * the fallback renderer for older Obsidian versions.
     */
    getSettingDefinitions(): SettingDefinition[] {
        const zh = isSimplifiedChinese();
        const text = zh ? {
            advanced: '启用高级功能', autoFit: '布局后自动适应视图', syncHierarchy: '布局前同步层级',
            taskNotes: 'TaskNotes 集成', enable: '启用 TaskNotes', identification: '识别方式', tag: 'Frontmatter 标签', property: '属性和值',
            taskTag: '任务标签', propertyName: '任务属性名', propertyValue: '任务属性值', title: '标题属性', status: '状态属性',
            backlog: '待办状态', progress: '进行中状态', finished: '完成状态', clear: '清除任务索引', clearDesc: '清除看板索引、任务引用和插件生成的块引用。不会删除任务内容。', confirm: '再次点击确认清除'
        } : {
            advanced: 'Enable advanced features', autoFit: 'Auto-fit after layout', syncHierarchy: 'Sync hierarchy before layout',
            taskNotes: 'TaskNotes integration', enable: 'Enable TaskNotes', identification: 'Identification method', tag: 'Frontmatter tag', property: 'Property and value',
            taskTag: 'Task tag', propertyName: 'Task property name', propertyValue: 'Task property value', title: 'Title property', status: 'Status property',
            backlog: 'Backlog statuses', progress: 'In-progress statuses', finished: 'Finished statuses', clear: 'Clear task index', clearDesc: 'Clear board indexes, task references, and plugin-generated block references. Task content will not be deleted.', confirm: 'Click again to confirm'
        };
        const control = (name: string, key: string, type: 'toggle' | 'text' | 'dropdown', options?: Record<string, string>): SettingDefinition => ({ name, control: { type, key, options } });
        const taskNotes = (definition: SettingDefinition): SettingDefinition => ({ ...definition, visible: () => this.plugin.settings.taskNotes.enabled });
        return [
            control(text.advanced, 'advanced', 'toggle'),
            control(text.autoFit, 'autoFitAfterLayout', 'toggle'),
            control(text.syncHierarchy, 'autoSyncHierarchy', 'toggle'),
            { name: text.taskNotes, render: setting => { setting.setHeading(); setting.nameEl.style.fontWeight = '700'; } },
            control(text.enable, 'taskNotes.enabled', 'toggle'),
            taskNotes(control(text.identification, 'taskNotes.identificationMethod', 'dropdown', { tag: text.tag, property: text.property })),
            taskNotes(control(text.taskTag, 'taskNotes.taskTag', 'text')),
            taskNotes(control(text.propertyName, 'taskNotes.propertyName', 'text')),
            taskNotes(control(text.propertyValue, 'taskNotes.propertyValue', 'text')),
            taskNotes(control(text.title, 'taskNotes.titleProperty', 'text')),
            taskNotes(control(text.status, 'taskNotes.statusProperty', 'text')),
            taskNotes(control(text.backlog, 'taskNotes.backlogStatuses', 'text')),
            taskNotes(control(text.progress, 'taskNotes.inProgressStatuses', 'text')),
            taskNotes(control(text.finished, 'taskNotes.finishedStatuses', 'text')),
            { name: text.clear, desc: text.clearDesc, action: () => this.confirmClearTaskIndex() },
            { name: zh ? '已归档画板' : 'Archived boards', render: setting => {
                setting.settingEl.empty();
                setting.settingEl.addClass('spatial-task-graph-archive-setting');
                this.renderArchivedBoards(setting.settingEl);
            } }
        ];
    }

    getControlValue(key: string): unknown {
        if (key === 'advanced') return true;
        const parts = key.split('.');
        let value: unknown = this.plugin.settings;
        for (const part of parts) {
            if (!value || typeof value !== 'object') return undefined;
            value = (value as Record<string, unknown>)[part];
        }
        return value;
    }

    setControlValue(key: string, value: unknown): void {
        if (key === 'advanced') return;
        const parts = key.split('.');
        let target: Record<string, unknown> = this.plugin.settings as unknown as Record<string, unknown>;
        for (const part of parts.slice(0, -1)) target = target[part] as Record<string, unknown>;
        const leaf = parts[parts.length - 1];
        if (!leaf) return;
        target[leaf] = value;
        void this.plugin.saveSettings();
        if (key.startsWith('taskNotes.')) this.plugin.refreshTaskNotesCache();
        (this as unknown as { update?: () => void }).update?.();
    }

    private confirmClearTaskIndex(): void {
        if (this.clearIndexModal) return;
        this.clearIndexModal = new ClearIndexModal(this.app,
            () => this.plugin.clearTaskIndexAndGeneratedBlockIds(),
            () => { this.clearIndexModal = undefined; });
        this.clearIndexModal.open();
    }

    private refreshSettings(): void {
        const update = (this as unknown as { update?: () => void }).update;
        if (update) update.call(this);
        else this.display();
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
        new Setting(containerEl).setName(text.clearIndex).setDesc(text.clearIndexDesc)
            .addButton(button => button.setButtonText(text.clearIndex).setWarning()
                .onClick(() => this.confirmClearTaskIndex()));
        this.renderArchivedBoards(containerEl);
    }

    private renderArchivedBoards(containerEl: HTMLElement): void {
        const zh = isSimplifiedChinese();
        const archivedSection = containerEl.createEl('details', { cls: 'spatial-task-graph-archived-boards' });
        const archivedSummary = archivedSection.createEl('summary', { text: `🗄️ ${zh ? '已归档画板' : 'Archived boards'}` });
        archivedSummary.setAttribute('aria-label', zh ? '显示已归档画板' : 'Show archived boards');
        const archived = this.plugin.settings.boards.filter(board => board.archived);
        if (!archived.length) {
            archivedSection.createDiv({ cls: 'setting-item-description', text: zh ? '暂无归档画板' : 'No archived boards' });
        }
        for (const board of archived) {
            addArchivedBoardControls(new Setting(archivedSection).setName(board.name), this.plugin, board.id, () => this.refreshSettings());
        }
    }
}
