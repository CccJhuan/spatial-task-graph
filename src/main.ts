import { App, Plugin, PluginSettingTab, Setting, WorkspaceLeaf, TFile } from 'obsidian';
import { TaskGraphView, VIEW_TYPE_TASK_GRAPH } from './TaskGraphView';

// --- 数据结构定义 ---

// 单个看板的配置结构
export interface GraphBoard {
	id: string;
	name: string;
	filters: {
		tags: string[];        // 包含这些标签 (OR 逻辑)
		excludeTags: string[]; // 排除这些标签
		folders: string[];     // 在这些文件夹内
		status: string[];      // 任务状态: ' ' (todo), 'x' (done), '/' (progress), '-' (cancel)
	};
	// 存储节点位置和连线
	data: {
		layout: Record<string, { x: number, y: number }>;
		edges: any[];
		groups: any[]; // 存储分组框
	}
}

// 插件总设置
interface TaskGraphSettings {
	boards: GraphBoard[];
	lastActiveBoardId: string;
}

const DEFAULT_BOARD: GraphBoard = {
	id: 'default',
	name: 'Main Board',
	filters: {
		tags: [],
		excludeTags: [],
		folders: [],
		status: [' ', '/'] // 默认只看未完成和进行中
	},
	data: { layout: {}, edges: [], groups: [] }
};

const DEFAULT_SETTINGS: TaskGraphSettings = {
	boards: [DEFAULT_BOARD],
	lastActiveBoardId: 'default'
};

// --- 主插件类 ---

export default class TaskGraphPlugin extends Plugin {
	settings: TaskGraphSettings;

	async onload() {
		await this.loadSettings();

		this.registerView(
			VIEW_TYPE_TASK_GRAPH,
			(leaf) => new TaskGraphView(leaf, this)
		);

		this.addRibbonIcon('network', 'Open Task Graph', () => {
			this.activateView();
		});

		this.addCommand({
			id: 'open-task-graph',
			name: 'Open Task Graph',
			callback: () => {
				this.activateView();
			}
		});

		// 添加命令：创建新看板
		this.addCommand({
			id: 'create-new-board',
			name: 'Create New Graph Board',
			callback: async () => {
				const newBoard: GraphBoard = {
					...DEFAULT_BOARD,
					id: Date.now().toString(),
					name: `Board ${this.settings.boards.length + 1}`,
					data: { layout: {}, edges: [], groups: [] } // 深拷贝数据对象
				};
				this.settings.boards.push(newBoard);
				this.settings.lastActiveBoardId = newBoard.id;
				await this.saveSettings();
				this.activateView();
			}
		});

		this.addSettingTab(new TaskGraphSettingTab(this.app, this));
	}

	async activateView() {
		const { workspace } = this.app;
		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(VIEW_TYPE_TASK_GRAPH);

		if (leaves.length > 0) {
			leaf = leaves[0];
			workspace.revealLeaf(leaf);
		} else {
			leaf = workspace.getLeaf('tab');
			await leaf.setViewState({ type: VIEW_TYPE_TASK_GRAPH, active: true });
			workspace.revealLeaf(leaf);
		}
	}

	// --- 核心优化：高性能任务检索 ---
	async getTasks(boardId: string) {
		const board = this.settings.boards.find(b => b.id === boardId) || this.settings.boards[0];
		const filters = board.filters;
		
		const files = this.app.vault.getMarkdownFiles();
		const tasks = [];

		// 预处理筛选条件
		const hasTagFilter = filters.tags.length > 0;
		const hasFolderFilter = filters.folders.length > 0;
		
		// 性能优化 1: 文件夹过滤 (路径字符串匹配比读取文件快得多)
		let candidateFiles = files;
		if (hasFolderFilter) {
			candidateFiles = files.filter(f => filters.folders.some(folder => f.path.startsWith(folder)));
		}

		for (const file of candidateFiles) {
			const cache = this.app.metadataCache.getFileCache(file);
			if (!cache || !cache.listItems) continue;

			// 性能优化 2: 元数据预检 (Metadata First)
			// 如果设置了必须包含某些标签，先检查缓存里的 tags 列表
			// 注意：这只能检查文件级或块级标签，行内标签仍需扫描文本，但能过滤掉大部分无关文件
			if (hasTagFilter && cache.tags) {
				// 简单的启发式检查：如果文件缓存里根本没有我们需要的标签，可能可以直接跳过
				// 但考虑到行内标签的复杂性，这里我们暂时不做强过滤，防止漏掉
			}

			// 只有通过了初步筛选，才读取文件内容 (I/O 操作)
			const content = await this.app.vault.cachedRead(file);
			const lines = content.split('\n');

			for (const item of cache.listItems) {
				if (!item.task) continue; // 必须是任务

				// 1. 状态筛选
				if (filters.status.length > 0 && !filters.status.includes(item.task)) {
					continue;
				}

				const lineText = lines[item.position.start.line];

				// 2. 包含标签筛选 (OR 逻辑)
				if (filters.tags.length > 0) {
					const hasTag = filters.tags.some(tag => lineText.includes(tag));
					if (!hasTag) continue;
				}

				// 3. 排除标签筛选 (NOT 逻辑)
				if (filters.excludeTags.length > 0) {
					const hasExcludedTag = filters.excludeTags.some(tag => lineText.includes(tag));
					if (hasExcludedTag) continue;
				}

				tasks.push({
					id: `${file.path}-${item.position.start.line}`,
					text: lineText.replace(/- \[.\] /, '').trim(),
					status: item.task,
					file: file.basename,
					path: file.path,
					line: item.position.start.line
				});
			}
		}
		return tasks;
	}

	// --- 数据持久化 ---
	
	async saveBoardData(boardId: string, data: { nodes?: any[], edges?: any[], layout?: any }) {
		const boardIndex = this.settings.boards.findIndex(b => b.id === boardId);
		if (boardIndex === -1) return;

		// 只更新布局、连线和分组，不覆盖过滤器
		if (data.layout) this.settings.boards[boardIndex].data.layout = data.layout;
		if (data.edges) this.settings.boards[boardIndex].data.edges = data.edges;
		// 如果有分组逻辑后续可以加在这里

		await this.saveSettings();
	}

	async updateBoardConfig(boardId: string, config: Partial<GraphBoard>) {
		const boardIndex = this.settings.boards.findIndex(b => b.id === boardId);
		if (boardIndex === -1) return;

		this.settings.boards[boardIndex] = { ...this.settings.boards[boardIndex], ...config };
		await this.saveSettings();
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
		// 确保数据结构完整
		if (!this.settings.boards || this.settings.boards.length === 0) {
			this.settings.boards = [DEFAULT_BOARD];
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class TaskGraphSettingTab extends PluginSettingTab {
	plugin: TaskGraphPlugin;

	constructor(app: App, plugin: TaskGraphPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl('h2', { text: 'Task Graph Global Settings' });
		containerEl.createEl('p', { text: 'Manage specific board filters directly in the Graph View.' });
	}
}