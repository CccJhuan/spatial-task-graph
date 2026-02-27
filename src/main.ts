import { App, Plugin, WorkspaceLeaf, TFile, debounce } from 'obsidian';
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
	taskCache: Map<string, any[]> = new Map();
	isCacheInitialized: boolean = false;
    debouncedRefresh = debounce(() => {
        if (this.viewRefresh) this.viewRefresh();
    }, 500, true);
	async onload() {
		await this.loadSettings();
		this.registerView(VIEW_TYPE_TASK_GRAPH, (leaf) => new TaskGraphView(leaf, this));
		this.addRibbonIcon('network', 'Open Task Graph', () => { this.activateView(); });
		this.addCommand({ id: 'open-task-graph', name: 'Open Task Graph', callback: () => { this.activateView(); } });

		this.registerEvent(this.app.metadataCache.on('changed', (file) => this.updateFileCache(file)));
        this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
            if (this.taskCache.has(oldPath)) {
                const tasks = this.taskCache.get(oldPath);
                this.taskCache.delete(oldPath);
                if (tasks) this.taskCache.set(file.path, tasks);
                this.debouncedRefresh();
            }
		}));
		this.registerEvent(this.app.vault.on('delete', (file) => {
            if (this.taskCache.has(file.path)) {
                this.taskCache.delete(file.path);
                this.debouncedRefresh();
            }
        }));
		// 插件加载后，后台异步初始化缓存，不阻塞 UI
        this.app.workspace.onLayoutReady(() => {
            this.initializeCache();
        });
	}

	// 【新增】初始化全量扫描（仅执行一次）
    async initializeCache() {
        const files = this.app.vault.getMarkdownFiles();
        for (const file of files) {
            await this.updateFileCache(file, false); 
        }
        this.isCacheInitialized = true;
        this.debouncedRefresh();
    }

    // 【新增】单文件级别的局部更新（时间复杂度 O(1)）
    async updateFileCache(file: import('obsidian').TAbstractFile, triggerRefresh = true) {
        if (!(file instanceof TFile) || file.extension !== 'md') return;
        
        const cache = this.app.metadataCache.getFileCache(file);
        // 如果文件里压根没有列表/任务，直接清空缓存并退出，极大节省算力
        if (!cache || !cache.listItems) {
            if (this.taskCache.has(file.path)) {
                this.taskCache.delete(file.path);
                if (triggerRefresh && this.isCacheInitialized) this.debouncedRefresh();
            }
            return;
        }

        const content = await this.app.vault.cachedRead(file);
        const lines = content.split('\n');
        const tasks: any[] = [];

        for (const item of cache.listItems) {
            if (!item.task) continue;
            
            const lineText = lines[item.position.start.line];
            if (lineText === undefined) continue;

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
                while(tasks.some(t => t.id === stableId)) { 
                    counter++; 
                    stableId = `${file.path}::#${textHash}_${counter}`; 
                }
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

        this.taskCache.set(file.path, tasks);
        if (triggerRefresh && this.isCacheInitialized) {
            this.debouncedRefresh();
        }
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
        // 1. 防御性拦截：如果初始化还没完成，直接返回空，避免报错
        if (!this.isCacheInitialized) return [];

		const board = this.settings.boards.find(b => b.id === boardId) || this.settings.boards[0];
        if (!board) return [];

		const filters = board.filters;
        
        // 2. 需求5：收集所有有连线的节点 ID（这部分逻辑不变，因为是针对当前图板的）
		const connectedTaskIds = new Set<string>();
		board.data.edges.forEach((e: any) => {
			connectedTaskIds.add(e.source);
			connectedTaskIds.add(e.target);
		});

        const allTasks: any[] = [];

        // 3. 核心大换血：不再 getMarkdownFiles()，而是直接遍历内存 Map
        for (const [path, fileTasks] of this.taskCache.entries()) {
            
            // 如果图板设置了文件夹过滤，直接在这一层把无关文件的任务全部跳过，极速剪枝
            if (filters.folders.length > 0 && !filters.folders.some(folder => path.startsWith(folder))) {
                continue;
            }

            // 遍历该文件在内存中已经解析好的任务对象
            for (const t of fileTasks) {
                const isConnected = connectedTaskIds.has(t.id);
                
                // 过滤逻辑保持不变，但因为 t 是内存对象，不需要重新截取字符串
                if (!isConnected && filters.status.length > 0 && !filters.status.includes(t.status)) continue;
                if (filters.tags.length > 0 && !filters.tags.some(tag => t.rawText.includes(tag))) continue;
                if (filters.excludeTags.length > 0 && filters.excludeTags.some(tag => t.rawText.includes(tag))) continue;

                allTasks.push(t);
            }
        }

		return allTasks;
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
            if (originalLine === undefined) return; 

            // 第一步：利用高阶正则安全提取“前缀(包含状态)”和“原有块 ID”
            const lineRegex = /^(\s*- \[[x\s\/bc!-]\]\s)?(.*?)(?:\s+(\^[a-zA-Z0-9\-]+))?$/;
            const originalMatch = originalLine.match(lineRegex);

            // 提取前缀，如果没有匹配到（极端情况），回退到默认未完成状态
            const prefix = originalMatch && originalMatch[1] ? originalMatch[1] : '- [ ] ';
            const existingBlockId = originalMatch && originalMatch[3] ? originalMatch[3] : '';

            // 第二步：清洗用户输入的新文本
            // 风险规避：强制剥离用户可能不小心粘贴进来的其他块 ID，并清除首尾不可见字符
            const cleanNewText = newText.replace(/(?:\s+\^[a-zA-Z0-9\-]+)+$/, '').trim();

            // 第三步：无损缝合
            const finalBlockIdStr = existingBlockId ? ` ${existingBlockId}` : '';
            lines[lineNumber] = `${prefix}${cleanNewText}${finalBlockIdStr}`;

			await this.app.vault.modify(file, lines.join('\n'));
		} catch (e) { 
            console.error("TaskGraph Plugin Error updating task content:", e); 
        }
	}

	async appendTaskToFile(filePath: string, taskText: string): Promise<string | null> {
		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (!(file instanceof TFile)) return null;
		try {
			const content = await this.app.vault.read(file);
			const prefix = content.endsWith('\n') ? '' : '\n';
            
            // 清洗输入文本：防止拖拽/新建时带入冗余的空格或破坏性 ID
            const cleanText = taskText.replace(/(?:\s+\^[a-zA-Z0-9\-]+)+$/, '').trim();
            
            const randomBlockId = Math.random().toString(36).substring(2, 8);
			
            // 严格的单空格拼接规范
            const newTaskLine = `- [ ] ${cleanText} ^${randomBlockId}`;
			
            await this.app.vault.append(file, `${prefix}${newTaskLine}`);
            
            return `${filePath}::^${randomBlockId}`;
		} catch (e) { 
            console.error("TaskGraph Plugin Error appending task:", e);
            return null; 
        }
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