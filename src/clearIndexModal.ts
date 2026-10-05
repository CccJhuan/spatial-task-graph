import { Modal, Notice, Setting } from 'obsidian';
import type { App } from 'obsidian';
import { isSimplifiedChinese } from './language';

export class ClearIndexModal extends Modal {
    constructor(app: App, private readonly clearIndex: () => Promise<number>, private readonly onDismiss: () => void) {
        super(app);
    }

    onOpen(): void {
        const zh = isSimplifiedChinese();
        this.contentEl.createEl('h2', { text: zh ? '确认清除任务索引' : 'Confirm clearing task index' });
        this.contentEl.createEl('p', { text: zh
            ? '将清除看板索引、任务引用和插件生成的块引用。任务正文会保留，但引用这些块的链接可能失效。此操作不能自动撤销。'
            : 'This removes board indexes, task references, and plugin-generated block references. Task content is preserved, but links to those blocks may stop working. This cannot be undone automatically.' });
        let acknowledged = false;
        let busy = false;
        const actions = new Setting(this.contentEl);
        actions.addButton(button => button.setButtonText(zh ? '取消' : 'Cancel').onClick(() => { if (!busy) this.close(); }));
        actions.addButton(button => {
            button.setButtonText(zh ? '确认清除' : 'Clear index').setWarning().setDisabled(true).onClick(() => {
                if (!acknowledged || busy) return;
                busy = true;
                button.setDisabled(true);
                void this.clearIndex().then(count => {
                    new Notice(zh ? `已清除索引，删除 ${count} 个块引用。` : `Index cleared; ${count} block references removed.`);
                    this.close();
                }).catch(() => {
                    busy = false;
                    button.setDisabled(false);
                    new Notice(zh ? '清除失败，请重试。' : 'Could not clear the index. Try again.');
                });
            });
            const acknowledgement = new Setting(this.contentEl).setName(zh ? '我理解此操作会删除插件生成的块引用' : 'I understand that plugin-generated block references will be deleted');
            acknowledgement.addToggle(toggle => toggle.setValue(false).onChange(value => {
                acknowledged = value;
                button.setDisabled(!value || busy);
            }));
            this.contentEl.insertBefore(acknowledgement.settingEl, actions.settingEl);
        });
    }

    onClose(): void {
        this.contentEl.empty();
        this.onDismiss();
    }
}
