import type { TaskCacheItem } from './main';

// Bump when parsing rules or TaskCacheItem's persisted representation changes.
const VERSION = 1;
export interface TaskSnapshotEntry {
    mtime: number;
    size: number;
    tasks: TaskCacheItem[];
}
interface TaskSnapshot {
    version: number;
    signature: string;
    entries: [string, TaskSnapshotEntry][];
}

export function readTaskSnapshot(raw: string, signature: string): Map<string, TaskSnapshotEntry> {
    try {
        const data = JSON.parse(raw) as Partial<TaskSnapshot>;
        if (data.version !== VERSION || data.signature !== signature || !Array.isArray(data.entries)) return new Map();
        const entries = new Map<string, TaskSnapshotEntry>();
        for (const pair of data.entries) {
            if (!Array.isArray(pair) || pair.length !== 2) continue;
            const [path, entry] = pair;
            if (typeof path !== 'string' || !entry || !Number.isFinite(entry.mtime) || !Number.isFinite(entry.size)
                || !Array.isArray(entry.tasks)) continue;
            if (!entry.tasks.every(task => task && task.path === path
                && ['id', 'text', 'notes', 'status', 'file', 'rawText', 'rawStatus'].every(key => typeof task[key as keyof TaskCacheItem] === 'string')
                && Number.isFinite(task.line) && Number.isFinite(task.endLine)
                && (task.source === 'checklist' || task.source === 'tasknotes')
                && ['backlog', 'in_progress', 'finished'].includes(task.statusCategory))) continue;
            entries.set(path, entry);
        }
        return entries;
    } catch {
        return new Map();
    }
}

export function writeTaskSnapshot(entries: Map<string, TaskSnapshotEntry>, signature: string): string {
    return JSON.stringify({ version: VERSION, signature, entries: [...entries] } satisfies TaskSnapshot);
}

export function snapshotMatches(entry: TaskSnapshotEntry | undefined, stat: { mtime: number; size: number }): boolean {
    return entry !== undefined && entry.mtime === stat.mtime && entry.size === stat.size;
}
