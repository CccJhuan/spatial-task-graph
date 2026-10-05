import { Modal, Notice, Setting } from 'obsidian';
import type SpatialTaskGraphPlugin from './main';
import { isSimplifiedChinese } from './language';

class DeleteBoardModal extends Modal {
    constructor(private readonly plugin: SpatialTaskGraphPlugin, private readonly boardId: string, private readonly onDeleted: () => void) {
        super(plugin.app);
    }

    onOpen(): void {
        const zh = isSimplifiedChinese();
        const board = this.plugin.settings.boards.find(board => board.id === this.boardId);
        this.contentEl.createEl('h2', { text: zh ? '彻底删除归档画板' : 'Permanently delete archived board' });
        this.contentEl.createEl('p', { text: zh
            ? `将永久删除画板“${board?.name || ''}”及其筛选、布局和连线数据，无法撤销。任务文件不会被删除。`
            : `Permanently delete "${board?.name || ''}" and its filters, layout, and connections? This cannot be undone. Task files will be preserved.` });
        let busy = false;
        new Setting(this.contentEl)
            .addButton(button => button.setButtonText(zh ? '取消' : 'Cancel').onClick(() => { if (!busy) this.close(); }))
            .addButton(button => button.setButtonText(zh ? '彻底删除' : 'Delete permanently').setWarning().onClick(() => {
                if (busy) return;
                busy = true;
                button.setDisabled(true);
                void this.plugin.deleteArchivedBoard(this.boardId).then(() => {
                    this.close();
                    this.onDeleted();
                }).catch(() => {
                    busy = false;
                    button.setDisabled(false);
                    new Notice(zh ? '删除失败，请重试。' : 'Could not delete the board. Try again.');
                });
            }));
    }

    onClose(): void { this.contentEl.empty(); }
}

export function addArchivedBoardControls(setting: Setting, plugin: SpatialTaskGraphPlugin, boardId: string, onChanged: () => void): void {
    const zh = isSimplifiedChinese();
    setting.addButton(button => button.setButtonText(zh ? '取消归档' : 'Unarchive').onClick(() => {
        button.setDisabled(true);
        void plugin.restoreBoard(boardId).then(onChanged).catch(() => {
            button.setDisabled(false);
            new Notice(zh ? '取消归档失败，请重试。' : 'Could not restore the board. Try again.');
        });
    }));
    setting.addButton(button => button.setButtonText(zh ? '彻底删除' : 'Delete permanently').setWarning()
        .onClick(() => new DeleteBoardModal(plugin, boardId, onChanged).open()));
}
