import type { TaskCacheItem } from './main';

const fields = [
    'id', 'text', 'notes', 'status', 'file', 'path', 'line', 'endLine', 'rawText',
    'source', 'rawStatus', 'statusCategory', 'parentLine', 'notesStartLine', 'notesEndLine'
] as const satisfies readonly (keyof TaskCacheItem)[];

export function taskListsEqual(previous: TaskCacheItem[] | undefined, next: TaskCacheItem[]): boolean {
    if (!previous) return next.length === 0;
    if (previous.length !== next.length) return false;
    return previous.every((task, index) => {
        const other = next[index];
        return other !== undefined && fields.every(field => task[field] === other[field]);
    });
}
