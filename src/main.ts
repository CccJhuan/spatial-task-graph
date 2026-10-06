import { Plugin, WorkspaceLeaf, TFile, debounce, Notice } from 'obsidian';
import type { Edge, Viewport } from 'reactflow';
import { TaskGraphView, VIEW_TYPE_TASK_GRAPH } from './TaskGraphView';
import { TaskGraphSettingTab } from './settings';
import { archiveBoard, restoreBoard, deleteArchivedBoard } from './boardArchive';
import { checklistRanges } from './checklistRanges';
import { SaveQueue } from './saveQueue';
import { taskListsEqual } from './taskCacheEquality';
import { readTaskSnapshot, writeTaskSnapshot, snapshotMatches, TaskSnapshotEntry } from './taskSnapshot';
import type { GraphGroup } from './groups';
import { remapGraphReferences } from './groups';
import { FilterCondition, getFilterConditions, createFilterMatcher } from './taskFilters';
import { frontmatterTags, matchesTaskNotesIdentifier, parseTaskNotesFrontmatter, taskNotesStatusForCategory, TaskNotesSettings, TaskNotesStatusCategory } from './tasknotesAdapter';

export interface TextNodeData { id: string; text: string; x: number; y: number; }

export interface TaskCacheItem {
    id: string;
    text: string;
    notes: string;
    status: string;
    file: string;
    path: string;
    line: number;
    endLine: number;
    rawText: string;
    source: 'checklist' | 'tasknotes';
    rawStatus: string;
    statusCategory: TaskNotesStatusCategory;
    parentLine?: number;
    notesStartLine?: number;
    notesEndLine?: number;
}

export interface GraphBoard {
	archived?: boolean;
	id: string; name: string;
	filters: { tags: string[]; excludeTags: string[]; folders: string[]; status: string[]; tagMode?: 'AND' | 'OR'; conditions?: FilterCondition[]; };
	data: { layout: Record<string, { x: number, y: number }>; edges: Edge[]; nodeStatus: Record<string, string>; textNodes: TextNodeData[]; viewport?: Viewport; collapsedNodes?: Record<string, boolean>; taskPaths?: string[]; generatedBlockIds?: string[]; groups?: GraphGroup[]; }
}

interface TaskGraphSettings { 
    boards: GraphBoard[]; 
    lastActiveBoardId: string; 
    taskNotes: TaskNotesSettings;
    autoFitAfterLayout: boolean; // 新增：排版后是否自动缩放
    autoSyncHierarchy: boolean;
}

const DEFAULT_BOARD: GraphBoard = {
	id: 'default', name: 'Main board',
	filters: { tags: [], excludeTags: [], folders: [], status: [' ', '/'], tagMode: 'OR' },
	data: { layout: {}, edges: [], nodeStatus: {}, textNodes: [] }
};
const DEFAULT_SETTINGS: TaskGraphSettings = { 
    boards: [DEFAULT_BOARD], 
    lastActiveBoardId: 'default',
    taskNotes: {
        enabled: false,
        identificationMethod: 'tag',
        taskTag: 'task',
        propertyName: '',
        propertyValue: '',
        titleProperty: 'title',
        statusProperty: 'status',
        backlogStatuses: 'open,todo,backlog',
        inProgressStatuses: 'in-progress,doing',
        finishedStatuses: 'done,completed'
    },
    autoFitAfterLayout: true,
    autoSyncHierarchy: false
};

export default class TaskGraphPlugin extends Plugin {
	settings: TaskGraphSettings;
	viewRefresh?: () => void;
    
    taskCache: Map<string, TaskCacheItem[]> = new Map();
    isCacheInitialized: boolean = false;
    private settingsWriter = new SaveQueue(() => this.saveData(this.settings));
    private taskSnapshots = new Map<string, TaskSnapshotEntry>();
    private snapshotSignature = '';
    private snapshotLoaded = false;
    private snapshotLoad: Promise<void> | undefined;
    private snapshotTimer: number | undefined;
    private snapshotDirty = false;
    private cacheRun = 0;
    private fileUpdates = new Map<string, number>();
    private snapshotWriter = new SaveQueue(async () => {
        await this.app.vault.adapter.write(this.snapshotPath(), writeTaskSnapshot(this.taskSnapshots, this.snapshotSignature));
    });

    private snapshotPath(): string {
        return `${this.manifest.dir || `${this.app.vault.configDir}/plugins/${this.manifest.id}`}/task-cache.json`;
    }

    private scheduleSnapshot(): void {
        this.snapshotDirty = true;
        if (!this.snapshotLoaded || this.snapshotTimer !== undefined) return;
        this.snapshotTimer = window.setTimeout(() => {
            this.snapshotTimer = undefined;
            this.snapshotDirty = false;
            void this.snapshotWriter.request().catch(error => console.error('Task graph cache write failed', error));
        }, 2000);
    }

	debouncedRefresh = debounce(() => {
		if (this.viewRefresh) this.viewRefresh();
	}, 500, true);

    refreshTaskNotesCache = debounce(() => {
        void this.initializeCache(true);
    }, 300);
    persistTaskPathIndexes = debounce(() => {
        void this.saveSettings();
    }, 1000);

	async onload() {
		await this.loadSettings();
        await this.loadSnapshot();
        
        this.addSettingTab(new TaskGraphSettingTab(this.app, this));

		this.registerView(VIEW_TYPE_TASK_GRAPH, (leaf) => new TaskGraphView(leaf, this));
		this.addRibbonIcon('network', 'Open task graph', () => { void this.activateView(); });
		
        this.addCommand({ id: 'open-task-graph', name: 'Open task graph', callback: () => { void this.activateView(); } });

        this.addCommand({ 
            id: 'layout-task-graph', 
            name: 'Auto-layout task graph (smart arrange)', 
            callback: () => { 
                const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_TASK_GRAPH);
                if (leaves.length > 0) {
                    const firstLeaf = leaves[0];
                    if (firstLeaf) {
                        const view = firstLeaf.view as TaskGraphView;
                        if (view.triggerLayout) {
                            view.triggerLayout();
                        } else {
                            new Notice("Layout engine is still loading...");
                        }
                    }
                } else {
                    new Notice("Task graph is not open.");
                }
            } 
        });
        this.addCommand({
            id: 'rebuild-task-index',
            name: 'Rebuild task document index',
            callback: () => { void this.initializeCache(true); }
        });

		this.registerEvent(this.app.metadataCache.on('changed', (file) => {
            void this.updateFileCache(file);
        }));
        this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
            this.taskSnapshots.delete(oldPath);
            this.fileUpdates.set(oldPath, (this.fileUpdates.get(oldPath) || 0) + 1);
            this.scheduleSnapshot();
            if (file instanceof TFile) void this.updateFileCache(file);
            if (this.taskCache.has(oldPath)) {
                const tasks = this.taskCache.get(oldPath);
                this.taskCache.delete(oldPath);
                const remap = (id: string) => id === oldPath ? file.path : id.startsWith(`${oldPath}::`) ? file.path + id.slice(oldPath.length) : id;
                if (tasks) this.taskCache.set(file.path, tasks.map(task => ({ ...task, id: remap(task.id), path: file.path,
                    file: file instanceof TFile ? file.basename : task.file })));
                for (const board of this.settings.boards) {
                    board.data = remapGraphReferences(board.data, remap);
                    if (board.data.taskPaths?.includes(oldPath)) {
                        board.data.taskPaths = board.data.taskPaths.map(path => path === oldPath ? file.path : path);
                    }
                }
                this.persistTaskPathIndexes();
                this.debouncedRefresh();
            }
        }));
        this.registerEvent(this.app.vault.on('delete', (file) => {
            this.taskSnapshots.delete(file.path);
            this.fileUpdates.set(file.path, (this.fileUpdates.get(file.path) || 0) + 1);
            this.scheduleSnapshot();
            if (this.taskCache.has(file.path)) {
                this.taskCache.delete(file.path);
                for (const board of this.settings.boards) {
                    if (board.data.taskPaths) board.data.taskPaths = board.data.taskPaths.filter(path => path !== file.path);
                }
                this.persistTaskPathIndexes();
                this.debouncedRefresh();
            }
        }));
        
        this.app.workspace.onLayoutReady(() => {
            void this.initializeCache();
        });
	}

    private async loadSnapshot(): Promise<void> {
        if (this.snapshotLoaded) return;
        if (!this.snapshotLoad) this.snapshotLoad = (async () => {
            const signature = JSON.stringify(this.settings.taskNotes);
            try {
                const raw = await this.app.vault.adapter.read(this.snapshotPath());
                const restored = readTaskSnapshot(raw, signature);
                // Metadata events that arrived during the read take precedence.
                for (const [path, entry] of this.taskSnapshots) restored.set(path, entry);
                this.taskSnapshots = restored;
            } catch { /* A missing cache is normal on first startup. */ }
            this.snapshotLoaded = true;
            this.snapshotSignature = signature;
        })();
        await this.snapshotLoad;
    }

    async initializeCache(forceFullScan = false) {
        const run = ++this.cacheRun;
        await this.loadSnapshot();
        if (run !== this.cacheRun) return;
        const signature = JSON.stringify(this.settings.taskNotes);
        if (forceFullScan || this.snapshotSignature !== signature) {
            this.taskSnapshots.clear();
            this.snapshotSignature = signature;
        }
        // Enumerating file stats also detects files added or deleted while Obsidian was closed.
        const files = this.app.vault.getMarkdownFiles();
        const paths = new Set(files.map(file => file.path));
        for (const path of this.taskSnapshots.keys()) if (!paths.has(path)) this.taskSnapshots.delete(path);
        for (const path of this.taskCache.keys()) if (!paths.has(path)) this.taskCache.delete(path);
        const pending: TFile[] = [];
        for (const file of files) {
            const entry = this.taskSnapshots.get(file.path);
            if (snapshotMatches(entry, file.stat)) {
                if (entry!.tasks.length) this.taskCache.set(file.path, entry!.tasks);
                else this.taskCache.delete(file.path);
            } else pending.push(file);
        }
        let nextIndex = 0;
        const worker = async () => {
            while (run === this.cacheRun && nextIndex < pending.length) {
                const file = pending[nextIndex++];
                if (file) await this.updateFileCache(file, false);
            }
        };
        await Promise.all(Array.from({ length: Math.min(8, pending.length) }, () => worker()));
        if (run !== this.cacheRun) return;
        const taskPaths = [...this.taskCache.keys()];
        if (this.settings.boards.some(board => JSON.stringify(board.data.taskPaths) !== JSON.stringify(taskPaths))) {
            for (const board of this.settings.boards) board.data.taskPaths = [...taskPaths];
            await this.saveSettings();
        }
        this.isCacheInitialized = true;
        this.scheduleSnapshot();
        this.debouncedRefresh();
    }

    async updateFileCache(file: import('obsidian').TAbstractFile, triggerRefresh = true) {
        if (!(file instanceof TFile) || file.extension !== 'md') return;
        
        const entry = this.taskSnapshots.get(file.path);
        if (this.snapshotSignature === JSON.stringify(this.settings.taskNotes) && snapshotMatches(entry, file.stat)) {
            this.storeFileTasks(file.path, entry!.tasks, triggerRefresh);
            return;
        }
        const cache = this.app.metadataCache.getFileCache(file);
        // Metadata may not be ready yet; do not persist a false empty result.
        if (!cache) return;
        const revision = (this.fileUpdates.get(file.path) || 0) + 1;
        this.fileUpdates.set(file.path, revision);
        const stat = { mtime: file.stat.mtime, size: file.stat.size };
        const signature = JSON.stringify(this.settings.taskNotes);
        const commit = (tasks: TaskCacheItem[]) => {
            if (this.fileUpdates.get(file.path) !== revision || file.stat.mtime !== stat.mtime
                || file.stat.size !== stat.size || JSON.stringify(this.settings.taskNotes) !== signature
                || this.app.vault.getAbstractFileByPath(file.path) !== file) return;
            const previous = this.taskSnapshots.get(file.path);
            if (!snapshotMatches(previous, stat) || !taskListsEqual(previous?.tasks, tasks)) {
                this.taskSnapshots.set(file.path, { ...stat, tasks });
                this.scheduleSnapshot();
            }
            this.storeFileTasks(file.path, tasks, triggerRefresh);
        };
        const hasTaskNotesCandidate = Boolean(this.settings.taskNotes.enabled && cache?.frontmatter && matchesTaskNotesIdentifier(cache.frontmatter, this.settings.taskNotes));
        const hasChecklistCandidate = Boolean(cache?.listItems?.some(item => Boolean(item?.task)));
        if (!hasTaskNotesCandidate && !hasChecklistCandidate) {
            commit([]);
            return;
        }
        const content = await this.app.vault.cachedRead(file);
        const lines = content.split('\n');
        const tasks: TaskCacheItem[] = [];

        if (hasTaskNotesCandidate && cache?.frontmatter) {
            const body = content.replace(/^---[\s\S]*?---\s*/, '');
            const taskNote = parseTaskNotesFrontmatter(cache.frontmatter, this.settings.taskNotes, file.basename, body);
            if (taskNote) {
                tasks.push({
                    id: file.path, text: taskNote.title, notes: taskNote.notes,
                    status: taskNote.category === 'finished' ? 'x' : taskNote.category === 'in_progress' ? '/' : ' ',
                    file: file.basename, path: file.path, line: -1, endLine: -1,
                    rawText: `${taskNote.title} ${frontmatterTags(cache.frontmatter.tags).map(tag => `#${tag}`).join(' ')}`,
                    source: 'tasknotes', rawStatus: taskNote.status,
                    statusCategory: taskNote.category
                });
            }
        }

        if (!cache?.listItems || tasks.some(task => task.source === 'tasknotes')) {
            commit(tasks);
            return;
        }


        const ranges = checklistRanges(cache.listItems, lines);
        const usedIds = new Set<string>();
        const duplicateCounts = new Map<string, number>();
        for (let i = 0; i < cache.listItems.length; i++) {
            const item = cache.listItems[i];
            if (!item || !item.task) continue;
            
            const range = ranges[i];
            if (!range) continue;
            const { startLine, endLine, notesStartLine, notesEndLine } = range;
            const rawLineText = lines[startLine];
            if (rawLineText === undefined) continue;

            let notesText = "";
            if (notesEndLine >= notesStartLine) {
                const notesLines = lines.slice(notesStartLine, notesEndLine + 1);
                let minIndent = Infinity;
                for (const nl of notesLines) {
                    if (nl.trim().length === 0) continue;
                    const match = nl.match(/^\s*/);
                    if (match) minIndent = Math.min(minIndent, match[0].length);
                }
                if (minIndent < Infinity) {
                    notesText = notesLines.map(nl => nl.length >= minIndent ? nl.substring(minIndent) : nl).join('\n');
                } else {
                    notesText = notesLines.join('\n');
                }
            }

            let stableId = "";
            const blockIdMatch = rawLineText.match(/\s\^([a-zA-Z0-9-]+)$/);
            
            if (blockIdMatch && blockIdMatch[1]) {
                stableId = `${file.path}::^${blockIdMatch[1]}`; 
            } else {
                const baseText = rawLineText.replace(/- \[[x\s/bc!-]\]\s/, '').trim();
                const cleanText = baseText.replace(/ ✅ \d{4}-\d{2}-\d{2}/, '').trim();
                const textHash = cleanText.substring(0, 30).replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '');
                stableId = `${file.path}::#${textHash}`; 
                
                const baseId = stableId;
                let counter = duplicateCounts.get(baseId) || 0;
                while (usedIds.has(stableId)) { counter++; stableId = `${baseId}_${counter}`; }
                duplicateCounts.set(baseId, counter);
            }

            usedIds.add(stableId);
            const displayText = rawLineText.replace(/- \[[x\s/bc!-]\]\s/, '').replace(/\s\^([a-zA-Z0-9-]+)$/, '').trim();

            tasks.push({
                id: stableId,
                text: displayText,
                notes: notesText,
                status: item.task,
                file: file.basename,
                path: file.path,
                line: startLine,
                endLine: endLine,
                rawText: rawLineText,
                source: 'checklist',
                rawStatus: item.task,
                statusCategory: item.task === 'x' ? 'finished' : item.task === '/' ? 'in_progress' : 'backlog',
                parentLine: item.parent,
                notesStartLine,
                notesEndLine
            });
        }

        commit(tasks);
    }

    private storeFileTasks(path: string, tasks: TaskCacheItem[], triggerRefresh: boolean) {
        const previous = this.taskCache.get(path);
        if ((!previous || previous.length === 0) && tasks.length === 0) {
            if (triggerRefresh && this.isCacheInitialized) this.trackTaskPath(path, false);
            return;
        }
        if (taskListsEqual(previous, tasks)) return;
        if (tasks.length) this.taskCache.set(path, tasks);
        else this.taskCache.delete(path);
        if (triggerRefresh && this.isCacheInitialized) this.trackTaskPath(path, tasks.length > 0);
        if (triggerRefresh && this.isCacheInitialized) this.debouncedRefresh();
    }

    private trackTaskPath(path: string, hasTasks: boolean) {
        let changed = false;
        for (const board of this.settings.boards) {
            if (!board.data.taskPaths) continue;
            const paths = board.data.taskPaths;
            const index = paths.indexOf(path);
            if (hasTasks && index === -1) {
                paths.push(path);
                changed = true;
            } else if (!hasTasks && index !== -1) {
                paths.splice(index, 1);
                changed = true;
            }
        }
        if (changed) this.persistTaskPathIndexes();
    }

    onunload() {
        this.cacheRun++;
        if (this.snapshotTimer !== undefined) window.clearTimeout(this.snapshotTimer);
        if (this.snapshotLoaded && this.snapshotDirty) {
            void this.snapshotWriter.request().catch(error => console.error('Task graph cache write failed', error));
        }
    }

	async loadSettings() {
        // 使用类型断言将 any 显式收敛为我们的目标类型
        const loadedData = (await this.loadData()) as Partial<TaskGraphSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, loadedData);
		this.settings.taskNotes = Object.assign({}, DEFAULT_SETTINGS.taskNotes, loadedData?.taskNotes);
		if (!this.settings.boards || this.settings.boards.length === 0) {
			this.settings.boards = [DEFAULT_BOARD];
		}
        const first = this.settings.boards[0];
        if (first && !this.settings.boards.some(board => !board.archived)) {
            this.settings.boards = archiveBoard(this.settings.boards, first.id).boards;
        }
        const active = this.settings.boards.find(board => board.id === this.settings.lastActiveBoardId && !board.archived)
            || this.settings.boards.find(board => !board.archived);
        if (active) this.settings.lastActiveBoardId = active.id;
	}

	async saveSettings() {
        await this.settingsWriter.request();
	}

    async archiveBoard(id: string): Promise<string> {
        const result = archiveBoard(this.settings.boards, id);
        this.settings.boards = result.boards;
        if (this.settings.lastActiveBoardId === id) this.settings.lastActiveBoardId = result.nextBoardId;
        await this.saveSettings();
        this.viewRefresh?.();
        return result.nextBoardId;
    }

    async restoreBoard(id: string): Promise<void> {
        this.settings.boards = restoreBoard(this.settings.boards, id);
        await this.saveSettings();
        this.viewRefresh?.();
    }

    async deleteArchivedBoard(id: string): Promise<void> {
        this.settings.boards = deleteArchivedBoard(this.settings.boards, id);
        await this.saveSettings();
        this.viewRefresh?.();
    }

    async updateTaskNotesStatus(path: string, category: TaskNotesStatusCategory) {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) return;
        const property = this.settings.taskNotes.statusProperty.trim() || 'status';
        await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
            (frontmatter as Record<string, unknown>)[property] = taskNotesStatusForCategory(category, this.settings.taskNotes);
        });
    }

    async updateTaskNotesContent(path: string, text: string) {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) return;
        const lines = text.split('\n');
        const title = lines.shift()?.trim() || file.basename;
        const body = lines.join('\n').trim();
        const titleProperty = this.settings.taskNotes.titleProperty.trim();
        if (titleProperty) {
            await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
                (frontmatter as Record<string, unknown>)[titleProperty] = title;
            });
        }
        const current = await this.app.vault.read(file);
        const withoutFrontmatter = current.replace(/^---[\s\S]*?---\s*/, '');
        const frontmatter = current.slice(0, current.length - withoutFrontmatter.length);
        await this.app.vault.modify(file, `${frontmatter}${body ? `${body}\n` : ''}`);
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
            // 【修改点】：使用 getLeaf('tab') 在中间的主工作区创建一个新的标签页
            const centerLeaf = workspace.getLeaf('tab');
            if (centerLeaf) {
                leaf = centerLeaf;
                await leaf.setViewState({ type: VIEW_TYPE_TASK_GRAPH, active: true });
            }
        }
        // 显式等待视图被激活和渲染
        if (leaf) workspace.setActiveLeaf(leaf, { focus: true });
	}

	async ensureBlockId(boardId: string, taskId: string): Promise<string> {
		if (taskId.includes('::^')) return taskId; 
		const parts = taskId.split('::#');
		const filePath = parts[0];
		if (!filePath) return taskId;

		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (!(file instanceof TFile)) return taskId;

		try {
			const cache = this.app.metadataCache.getFileCache(file);
			if (!cache || !cache.listItems) return taskId;
			
			const content = await this.app.vault.read(file);
			const lines = content.split('\n');
			const targetTaskObj = this.getTasks(boardId).find(t => t.id === taskId);
			if (!targetTaskObj) return taskId;

			const lineNumber = targetTaskObj.line;
            const originalLine = lines[lineNumber];
			if (originalLine === undefined) return taskId;

			const randomBlockId = Math.random().toString(36).substring(2, 8);
			lines[lineNumber] = `${originalLine.trimEnd()} ^${randomBlockId}`;
			await this.app.vault.modify(file, lines.join('\n'));

            const board = this.settings.boards.find(item => item.id === boardId);
            if (board) {
                const generatedBlockIds = new Set(board.data.generatedBlockIds || []);
                generatedBlockIds.add(randomBlockId);
                board.data.generatedBlockIds = [...generatedBlockIds];
                await this.saveSettings();
            }
			
			return `${filePath}::^${randomBlockId}`;
		} catch(err) { 
            console.error("TaskGraph Plugin Error ensuring block ID:", err);
            return taskId; 
        }
	}

    async clearTaskIndexAndGeneratedBlockIds(): Promise<number> {
        const generatedIds = new Set<string>();
        const indexedPaths = new Set<string>();
        for (const board of this.settings.boards) {
            for (const id of board.data.generatedBlockIds || []) generatedIds.add(id);
            for (const taskId of Object.keys(board.data.layout || {})) {
                const match = taskId.match(/::\^([a-zA-Z0-9-]+)$/);
                if (match?.[1]) generatedIds.add(match[1]);
            }
            for (const edge of board.data.edges || []) {
                for (const taskId of [edge.source, edge.target]) {
                    const match = taskId.match(/::\^([a-zA-Z0-9-]+)$/);
                    if (match?.[1]) generatedIds.add(match[1]);
                }
            }
            for (const path of board.data.taskPaths || []) indexedPaths.add(path);
            board.data.taskPaths = [];
            board.data.generatedBlockIds = [];
            board.data.layout = {};
            board.data.edges = [];
            board.data.nodeStatus = {};
            board.data.collapsedNodes = {};
            board.data.groups = [];
        }

        let removedCount = 0;
        if (generatedIds.size > 0) {
            const escapedIds = [...generatedIds].map(id => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
            const blockPattern = new RegExp(`\\s+\\^(?:${escapedIds.join('|')})(?=\\s*$)`, 'gm');
            for (const path of indexedPaths) {
                const file = this.app.vault.getAbstractFileByPath(path);
                if (!(file instanceof TFile)) continue;
                const content = await this.app.vault.read(file);
                const updated = content.replace(blockPattern, () => {
                    removedCount++;
                    return '';
                });
                if (updated !== content) await this.app.vault.modify(file, updated);
            }
        }

        this.taskCache.clear();
        this.taskSnapshots.clear();
        this.scheduleSnapshot();
        this.isCacheInitialized = true;
        await this.saveSettings();
        this.debouncedRefresh();
        return removedCount;
    }

	async updateTaskContent(filePath: string, startLine: number, endLine: number, newText: string) {
		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (!(file instanceof TFile)) return;
		try {
			const content = await this.app.vault.read(file);
			const lines = content.split('\n');
			if (startLine >= lines.length) return;
			
			const originalLine = lines[startLine];
            if (originalLine === undefined) return; 

            const lineRegex = /^(\s*- \[[x\s/bc!-]\]\s)?(.*?)(?:\s+(\^[a-zA-Z0-9-]+))?$/;
            const originalMatch = originalLine.match(lineRegex);

            const prefix = originalMatch && originalMatch[1] ? originalMatch[1] : '- [ ] ';
            const existingBlockId = originalMatch && originalMatch[3] ? originalMatch[3] : '';

            const taskIndent = (originalLine.match(/^\s*/) || [''])[0];
            const taskIndentLength = taskIndent.length;
            const isTaskLine = (line: string) => /^\s*- \[[x\s/bc!-]\]\s/.test(line);
            let firstChildLine: number | undefined;
            let noteEndLine = startLine;
            for (let i = startLine + 1; i < lines.length; i++) {
                const line = lines[i] || '';
                if (!isTaskLine(line)) {
                    noteEndLine = i;
                    continue;
                }
                const indentLength = (line.match(/^\s*/) || [''])[0].length;
                if (indentLength > taskIndentLength) {
                    firstChildLine = i;
                    break;
                }
                noteEndLine = i - 1;
                break;
            }
            if (firstChildLine !== undefined) noteEndLine = firstChildLine - 1;
            if (noteEndLine < startLine) noteEndLine = startLine;

            const newTextLines = newText.split('\n');
            const firstLine = newTextLines[0] || '';
            const cleanNewTitle = firstLine.replace(/(?:\s+\^[a-zA-Z0-9-]+)+$/, '').trim();
            const newNotes = newTextLines.slice(1);

            const finalBlockIdStr = existingBlockId ? ` ${existingBlockId}` : '';
            const newFirstLine = `${prefix}${cleanNewTitle}${finalBlockIdStr}`;

            const baseIndentMatch = prefix.match(/^\s*/);
            const baseIndent = baseIndentMatch ? baseIndentMatch[0] : '';
            const noteIndent = baseIndent + '\t';

            const formattedNotes = newNotes.map(n => n.trim() === '' ? '' : `${noteIndent}${n.trim()}`);
            const replacement = [newFirstLine, ...formattedNotes];

            // Replace only the task line and its direct note block. Child tasks
            // and their indentation remain untouched after the insertion point.
            lines.splice(startLine, noteEndLine - startLine + 1, ...replacement);

			await this.app.vault.modify(file, lines.join('\n'));
		} catch (err) { 
            console.error("TaskGraph Plugin Error updating task content:", err); 
        }
	}

	async appendTaskToFile(filePath: string, taskText: string): Promise<string | null> {
		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (!(file instanceof TFile)) return null;
		try {
			const content = await this.app.vault.read(file);
			const prefix = content.endsWith('\n') ? '' : '\n';
            
            const cleanText = taskText.replace(/(?:\s+\^[a-zA-Z0-9-]+)+$/, '').trim();
            const randomBlockId = Math.random().toString(36).substring(2, 8);
			
            const newTaskLine = `- [ ] ${cleanText} ^${randomBlockId}`;
			
            await this.app.vault.append(file, `${prefix}${newTaskLine}`);
            const id = `${filePath}::^${randomBlockId}`;
            const line = content.split('\n').length - (content.endsWith('\n') ? 1 : 0);
            const parts = cleanText.split('\n');
            const task: TaskCacheItem = { id, text: parts[0] || '', notes: parts.slice(1).join('\n'), status: ' ',
                file: file.basename, path: filePath, line, endLine: line + parts.length - 1,
                rawText: cleanText, source: 'checklist', rawStatus: ' ', statusCategory: 'backlog' };
            this.taskCache.set(filePath, [...(this.taskCache.get(filePath) || []).filter(item => item.id !== id), task]);
            this.trackTaskPath(filePath, true);
            this.debouncedRefresh();
            
            return id;
		} catch (err) { 
            console.error("TaskGraph Plugin Error appending task:", err);
            return null; 
        }
	}

	async saveBoardData(boardId: string, data: Partial<GraphBoard['data']>) {
		const boardIndex = this.settings.boards.findIndex(b => b.id === boardId);
		if (boardIndex === -1) return;
        const board = this.settings.boards[boardIndex];
        if (!board) return; 
		board.data = { ...board.data, ...data };
		await this.saveSettings();
	}

	async updateBoardConfig(boardId: string, config: Partial<GraphBoard>) {
		const boardIndex = this.settings.boards.findIndex(b => b.id === boardId);
		if (boardIndex === -1) return;
		this.settings.boards[boardIndex] = { ...this.settings.boards[boardIndex], ...config } as GraphBoard;
		await this.saveSettings();
	}

	getTasks(boardId: string): TaskCacheItem[] {
        if (!this.isCacheInitialized) return [];

		const board = this.settings.boards.find(b => b.id === boardId) || this.settings.boards[0];
        if (!board) return [];

		const filters = board.filters;
        const matchesConditions = createFilterMatcher(getFilterConditions(filters));
        
		const connectedTaskIds = new Set<string>();
        const groupedTaskIds = new Set((board.data.groups || []).flatMap(group => group.members));
        for (const id of groupedTaskIds) connectedTaskIds.add(id);
		board.data.edges.forEach((e: Edge) => { 
			connectedTaskIds.add(e.source);
			connectedTaskIds.add(e.target);
		});

        const allTasks: TaskCacheItem[] = [];

        const indexedPaths = board.data.taskPaths;
        const taskEntries = indexedPaths
            ? indexedPaths.map(path => [path, this.taskCache.get(path) || []] as const)
            : Array.from(this.taskCache.entries());
        for (const [path, fileTasks] of taskEntries) {

            const tasksByLine = new Map(fileTasks.filter(task => task.source === 'checklist').map(task => [task.line, task]));
            const includedMemo = new Map<string, boolean>();
            const matchesBaseFilters = (task: TaskCacheItem) => {
                const isConnected = connectedTaskIds.has(task.id);
                return (isConnected || filters.status.length === 0 || filters.status.includes(task.status));
            };
            const matchesTagFilters = (task: TaskCacheItem) => {
                if (!groupedTaskIds.has(task.id) && !matchesConditions(task.rawText, path)) return false;
                return filters.excludeTags.length === 0 || !filters.excludeTags.some(tag => task.rawText.includes(tag));
            };
            const isIncluded = (task: TaskCacheItem, visiting = new Set<string>()): boolean => {
                const cached = includedMemo.get(task.id);
                if (cached !== undefined) return cached;
                if (visiting.has(task.id)) return false;
                const nextVisiting = new Set(visiting).add(task.id);
                const directlyMatches = matchesBaseFilters(task) && matchesTagFilters(task);
                if (directlyMatches) {
                    includedMemo.set(task.id, true);
                    return true;
                }
                const parent = task.source === 'checklist' && task.parentLine !== undefined
                    ? tasksByLine.get(task.parentLine)
                    : undefined;
                // A descendant inherits its parent's scope, so nested checklist
                // items do not need to repeat the parent's tags.
                const inherited = Boolean(parent && matchesBaseFilters(task) && isIncluded(parent, nextVisiting));
                includedMemo.set(task.id, inherited);
                return inherited;
            };

            for (const task of fileTasks) {
                if (isIncluded(task)) allTasks.push(task);
            }
        }

		return allTasks;
	}
}
