import { Plugin, WorkspaceLeaf, TFile, debounce } from 'obsidian';
import { TaskGraphView, VIEW_TYPE_TASK_GRAPH } from './TaskGraphView';
import { TaskGraphSettingTab } from './settings';

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
    
    // 增量缓存核心
    taskCache: Map<string, any[]> = new Map();
    isCacheInitialized: boolean = false;

	debouncedRefresh = debounce(() => {
		if (this.viewRefresh) this.viewRefresh();
	}, 500, true);

	async onload() {
		await this.loadSettings();
        
        // 注册设置面板
        this.addSettingTab(new TaskGraphSettingTab(this.app, this));

		this.registerView(VIEW_TYPE_TASK_GRAPH, (leaf) => new TaskGraphView(leaf, this));
		this.addRibbonIcon('network', 'Open Task Graph', () => { this.activateView(); });
		this.addCommand({ id: 'open-task-graph', name: 'Open Task Graph', callback: () => { this.activateView(); } });

        // 精细化监听文件变动，抛弃全量盲目刷新
		this.registerEvent(this.app.metadataCache.on('changed', (file) => {
            void this.updateFileCache(file);
        }));
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
            void this.initializeCache();
        });
	}

    // 初始化全量扫描（仅执行一次）
    async initializeCache() {
        const files = this.app.vault.getMarkdownFiles();
        for (const file of files) {
            await this.updateFileCache(file, false); 
        }
        this.isCacheInitialized = true;
        this.debouncedRefresh();
    }

    // 单文件级别的局部更新（时间复杂度 O(1)）
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

	onunload() { }

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
		if (!this.settings.boards || this.settings.boards.length === 0) {
			this.settings.boards = [DEFAULT_BOARD];
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async activateView() {
		const { workspace } = this.app;
		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(VIEW_TYPE_TASK_GRAPH);
		if (leaves.length > 0) {
            const firstLeaf = leaves[0];
            if (firstLeaf) {
                leaf = firstLeaf;
            }
        } else {
            const rightLeaf = workspace.getRightLeaf(false);
            if (rightLeaf) {
                leaf = rightLeaf;
                await leaf.setViewState({ type: VIEW_TYPE_TASK_GRAPH, active: true });
            }
        }
		if (leaf) workspace.revealLeaf(leaf);
	}

	async ensureBlockId(boardId: string, taskId: string): Promise<string> {
		if (taskId.includes('::^')) return taskId; 
		const [filePath] = taskId.split('::#');
		if (!filePath) return taskId;

		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (!(file instanceof TFile)) return taskId;

		try {
			const cache = this.app.metadataCache.getFileCache(file);
			if (!cache || !cache.listItems) return taskId;
			
			const content = await this.app.vault.read(file);
			const lines = content.split('\n');
			const targetTaskObj = (await this.getTasks(boardId)).find(t => t.id === taskId);
			if (!targetTaskObj) return taskId;

			const lineNumber = targetTaskObj.line;
            const originalLine = lines[lineNumber];
			if (originalLine === undefined) return taskId;

			const randomBlockId = Math.random().toString(36).substring(2, 8);
			lines[lineNumber] = `${originalLine.trimEnd()} ^${randomBlockId}`;
			await this.app.vault.modify(file, lines.join('\n'));
			
			return `${filePath}::^${randomBlockId}`;
		} catch(e) { 
            console.error("TaskGraph Plugin Error ensuring block ID:", e);
            return taskId; 
        }
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

            // 利用高阶正则安全提取“前缀(包含状态)”和“原有块 ID”
            const lineRegex = /^(\s*- \[[x\s\/bc!-]\]\s)?(.*?)(?:\s+(\^[a-zA-Z0-9\-]+))?$/;
            const originalMatch = originalLine.match(lineRegex);

            // 提取前缀，如果没有匹配到（极端情况），回退到默认未完成状态
            const prefix = originalMatch && originalMatch[1] ? originalMatch[1] : '- [ ] ';
            const existingBlockId = originalMatch && originalMatch[3] ? originalMatch[3] : '';

            // 清洗用户输入的新文本
            // 风险规避：强制剥离用户可能不小心粘贴进来的其他块 ID，并清除首尾不可见字符
            const cleanNewText = newText.replace(/(?:\s+\^[a-zA-Z0-9\-]+)+$/, '').trim();

            // 无损缝合
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
        if (!board) return; 
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
		this.settings.boards[boardIndex] = { ...this.settings.boards[boardIndex], ...config } as GraphBoard;
		await this.saveSettings();
	}

    // 已经转换为纯同步的增量消费者方法，去除 async 彻底解决 lint 报错
	getTasks(boardId: string) {
        // 防御性拦截：如果初始化还没完成，直接返回空，避免报错
        if (!this.isCacheInitialized) return [];

		const board = this.settings.boards.find(b => b.id === boardId) || this.settings.boards[0];
        if (!board) return [];

		const filters = board.filters;
        
        // 收集所有有连线的节点 ID
		const connectedTaskIds = new Set<string>();
		board.data.edges.forEach((e: any) => {
			connectedTaskIds.add(e.source);
			connectedTaskIds.add(e.target);
		});

        const allTasks: any[] = [];

        // 核心大换血：不再访问 getMarkdownFiles()，直接遍历内存 Map 实现 O(1) 量级提取
        for (const [path, fileTasks] of this.taskCache.entries()) {
            
            // 目录过滤极速剪枝
            if (filters.folders.length > 0 && !filters.folders.some(folder => path.startsWith(folder))) {
                continue;
            }

            for (const t of fileTasks) {
                const isConnected = connectedTaskIds.has(t.id);
                
                if (!isConnected && filters.status.length > 0 && !filters.status.includes(t.status)) continue;
                if (filters.tags.length > 0 && !filters.tags.some(tag => t.rawText.includes(tag))) continue;
                if (filters.excludeTags.length > 0 && filters.excludeTags.some(tag => t.rawText.includes(tag))) continue;

                allTasks.push(t);
            }
        }

		return allTasks;
	}
}