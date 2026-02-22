import { App, Plugin, WorkspaceLeaf, TFile } from 'obsidian';
import { TaskGraphView, VIEW_TYPE_TASK_GRAPH } from './TaskGraphView';

export interface TextNodeData { id: string; text: string; x: number; y: number; }

export interface GraphBoard {
	id: string; name: string;
	filters: { tags: string[]; excludeTags: string[]; folders: string[]; status: string[]; };
	data: { layout: Record<string, { x: number, y: number }>; edges: any[]; nodeStatus: Record<string, string>; textNodes: TextNodeData[]; }
}

interface TaskGraphSettings { boards: GraphBoard[]; lastActiveBoardId: string; }

const DEFAULT_BOARD: GraphBoard = {
	id: 'default', name: 'Main Board',
	filters: { tags: [], excludeTags: [], folders: [], status: [' ', '/'] },
	data: { layout: {}, edges: [], nodeStatus: {}, textNodes: [] }
};
const DEFAULT_SETTINGS: TaskGraphSettings = { boards: [DEFAULT_BOARD], lastActiveBoardId: 'default' };

export default class TaskGraphPlugin extends Plugin {
	settings: TaskGraphSettings;
	viewRefresh?: () => void;

	async onload() {
		await this.loadSettings();
		this.registerView(VIEW_TYPE_TASK_GRAPH, (leaf) => new TaskGraphView(leaf, this));
		this.addRibbonIcon('network', 'Open Task Graph', () => { this.activateView(); });
		this.addCommand({ id: 'open-task-graph', name: 'Open Task Graph', callback: () => { this.activateView(); } });

		this.registerEvent(
			this.app.metadataCache.on('changed', () => {
				if (this.viewRefresh) this.viewRefresh();
			})
		);
	}

	async activateView() {
		const { workspace } = this.app;
		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(VIEW_TYPE_TASK_GRAPH);
		
        // Fix TS2322 & TS2345
		if (leaves.length > 0 && leaves[0]) { 
            leaf = leaves[0] as WorkspaceLeaf; 
            workspace.revealLeaf(leaf); 
        } else { 
            leaf = workspace.getLeaf('tab'); 
            if (leaf) {
                await leaf.setViewState({ type: VIEW_TYPE_TASK_GRAPH, active: true }); 
                workspace.revealLeaf(leaf); 
            }
        }
	}

	async getTasks(boardId: string) {
		const board = this.settings.boards.find(b => b.id === boardId) || this.settings.boards[0];
        if (!board) return []; // Fix TS18048

		const filters = board.filters;
		const files = this.app.vault.getMarkdownFiles();
		const tasks: any[] = []; // Fix TS7034
		let candidateFiles = files;
		
		if (filters.folders.length > 0) { candidateFiles = files.filter(f => filters.folders.some(folder => f.path.startsWith(folder))); }

		for (const file of candidateFiles) {
			const cache = this.app.metadataCache.getFileCache(file);
			if (!cache || !cache.listItems) continue;
			const content = await this.app.vault.cachedRead(file);
			const lines = content.split('\n');

			for (const item of cache.listItems) {
				if (!item.task) continue;
				if (filters.status.length > 0 && !filters.status.includes(item.task)) continue;
				
                const lineText = lines[item.position.start.line];
                if (lineText === undefined) continue; // Fix TS18048

				if (filters.tags.length > 0 && !filters.tags.some(tag => lineText.includes(tag))) continue;
				if (filters.excludeTags.length > 0 && filters.excludeTags.some(tag => lineText.includes(tag))) continue;

                let stableId = "";
                const blockIdMatch = lineText.match(/\s\^([a-zA-Z0-9\-]+)$/);
                
                if (blockIdMatch && blockIdMatch[1]) {
                    stableId = `${file.path}::^${blockIdMatch[1]}`; 
                } else {
                    const baseText = lineText.replace(/- \[[x\s\/bc!-]\]\s/, '').trim();
                    const cleanText = baseText.replace(/ ✅ \d{4}-\d{2}-\d{2}/, '').trim();
                    const textHash = cleanText.substring(0, 30).replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '');
                    stableId = `${file.path}::#${textHash}`; 
                    
                    let counter = 0;
                    while(tasks.some(t => t.id === stableId)) { counter++; stableId = `${file.path}::#${textHash}_${counter}`; }
                }

                const displayText = lineText.replace(/- \[[x\s\/bc!-]\]\s/, '').replace(/\s\^([a-zA-Z0-9\-]+)$/, '').trim();

				tasks.push({
					id: stableId,
					text: displayText,
					status: item.task,
					file: file.basename,
					path: file.path,
					line: item.position.start.line,
					rawText: lineText
				});
			}
		}
		return tasks;
	}

    async ensureBlockId(boardId: string, nodeId: string): Promise<string> {
        if (nodeId.includes('::^')) return nodeId; 

        const tasks = await this.getTasks(boardId);
        const task = tasks.find(t => t.id === nodeId);
        if (!task) return nodeId; 

        const randomBlockId = Math.random().toString(36).substring(2, 8);
        const newId = `${task.path}::^${randomBlockId}`;

        const file = this.app.vault.getAbstractFileByPath(task.path);
        if (file instanceof TFile) {
            const content = await this.app.vault.read(file);
            const lines = content.split('\n');
            const targetLine = lines[task.line];
            // Fix TS2532
            if (targetLine !== undefined && !targetLine.match(/\s\^([a-zA-Z0-9\-]+)$/)) {
                lines[task.line] = targetLine.trimEnd() + ` ^${randomBlockId}`;
                await this.app.vault.modify(file, lines.join('\n'));
            }
        }

        const boardIndex = this.settings.boards.findIndex(b => b.id === boardId);
        if (boardIndex > -1) {
            const board = this.settings.boards[boardIndex];
            if (!board) return newId; // Fix TS18048
            
            board.data.edges.forEach((e: any) => {
                if (e.source === nodeId) e.source = newId;
                if (e.target === nodeId) e.target = newId;
            });
            if (board.data.layout[nodeId]) {
                board.data.layout[newId] = board.data.layout[nodeId];
                delete board.data.layout[nodeId];
            }
            if (board.data.nodeStatus[nodeId]) {
                board.data.nodeStatus[newId] = board.data.nodeStatus[nodeId];
                delete board.data.nodeStatus[nodeId];
            }
            await this.saveSettings();
        }

        return newId;
    }

	async updateTaskContent(filePath: string, lineNumber: number, newText: string) {
		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (!(file instanceof TFile)) return;
		try {
			const content = await this.app.vault.read(file);
			const lines = content.split('\n');
			if (lineNumber >= lines.length) return;
			const originalLine = lines[lineNumber];
            if (originalLine === undefined) return; // Fix TS18048
            
            const blockIdMatch = originalLine.match(/(\s\^[a-zA-Z0-9\-]+)$/);
            const blockIdStr = (blockIdMatch && blockIdMatch[1]) ? blockIdMatch[1] : '';

			const match = originalLine.match(/^(\s*- \[[x\s\/bc!-]\]\s)/);
			if (match && match[1]) { lines[lineNumber] = match[1] + newText + blockIdStr; } 
            else { lines[lineNumber] = newText + blockIdStr; }
			await this.app.vault.modify(file, lines.join('\n'));
		} catch (e) { console.error(e); }
	}

	async appendTaskToFile(filePath: string, taskText: string): Promise<string | null> {
		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (!(file instanceof TFile)) return null;
		try {
			const content = await this.app.vault.read(file);
			const prefix = content.endsWith('\n') ? '' : '\n';
            
            const randomBlockId = Math.random().toString(36).substring(2, 8);
			const newTaskLine = `- [ ] ${taskText} ^${randomBlockId}`;
			await this.app.vault.append(file, `${prefix}${newTaskLine}`);
            
            return `${filePath}::^${randomBlockId}`;
		} catch (e) { return null; }
	}

	async saveBoardData(boardId: string, data: Partial<GraphBoard['data']>) {
		const boardIndex = this.settings.boards.findIndex(b => b.id === boardId);
		if (boardIndex === -1) return;
        const board = this.settings.boards[boardIndex];
        if (!board) return; // Fix TS2532
		const currentData = board.data;
		if (data.layout) currentData.layout = data.layout;
		if (data.edges) currentData.edges = data.edges;
		if (data.nodeStatus) currentData.nodeStatus = data.nodeStatus;
		if (data.textNodes) currentData.textNodes = data.textNodes;
		await this.saveSettings();
	}

	async updateBoardConfig(boardId: string, config: Partial<GraphBoard>) {
		const boardIndex = this.settings.boards.findIndex(b => b.id === boardId);
		if (boardIndex === -1) return;
        // Fix TS2322
		this.settings.boards[boardIndex] = { ...this.settings.boards[boardIndex], ...config } as GraphBoard;
		await this.saveSettings();
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
		if (!this.settings.boards || this.settings.boards.length === 0) this.settings.boards = [DEFAULT_BOARD];
	}
	async saveSettings() { await this.saveData(this.settings); }
}