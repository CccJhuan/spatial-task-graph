import { TFile } from 'obsidian';
import type { App } from 'obsidian';

interface TaskLocation { id: string; path: string; line: number; source: 'checklist' | 'tasknotes'; }

export async function openTaskLocation(app: App, task: TaskLocation): Promise<void> {
    const blockId = task.source === 'checklist' ? task.id.match(/::\^([^:]+)$/)?.[1] : undefined;
    const file = app.vault.getAbstractFileByPath(task.path);
    const block = file instanceof TFile && blockId ? app.metadataCache.getFileCache(file)?.blocks?.[blockId] : undefined;
    const line = task.source === 'tasknotes' ? 0 : block?.position.start.line ?? Math.max(0, task.line);
    await app.workspace.openLinkText(blockId ? `${task.path}#^${blockId}` : task.path, '', false, {
        active: true, eState: { line, focus: true }
    });
}
