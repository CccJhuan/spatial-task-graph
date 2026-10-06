import type TaskGraphPlugin from './main';
import type { Node } from 'reactflow';
import { remapGraphReferences } from './groups';

/** Establish stable task IDs before persisting membership or connections. */
export async function ensureGraphObjectIds(plugin: TaskGraphPlugin, boardId: string, ids: string[]): Promise<Map<string, string>> {
    const groupIds = new Set(plugin.settings.boards.flatMap(board => (board.data.groups || []).map(group => group.id)));
    const mapping = new Map<string, string>();
    for (const id of new Set(ids)) mapping.set(id, groupIds.has(id) ? id : await plugin.ensureBlockId(boardId, id));
    const remap = (id: string) => mapping.get(id) || id;
    if ([...mapping].every(([before, after]) => before === after)) return mapping;
    for (const [path, tasks] of plugin.taskCache) {
        if (tasks.some(task => remap(task.id) !== task.id)) plugin.taskCache.set(path, tasks.map(task => ({ ...task, id: remap(task.id) })));
    }
    for (const board of plugin.settings.boards) {
        board.data = remapGraphReferences(board.data, remap);
    }
    await plugin.saveSettings();
    return mapping;
}

/** Shared by direct dragging, search connections, and newly created tasks. */
export async function connectGraphObjects(plugin: TaskGraphPlugin, boardId: string, source: string, target: string, nodes: Node[]): Promise<void> {
    const board = plugin.settings.boards.find(item => item.id === boardId);
    if (!board || source === target) return;
    const mapping = await ensureGraphObjectIds(plugin, boardId, [source, target]);
    const remap = (id: string) => mapping.get(id) || id;
    const sourceId = remap(source); const targetId = remap(target);
    const layout = { ...board.data.layout };
    for (const node of nodes) {
        if (node.type !== 'task') continue;
        const id = remap(node.id);
        layout[id] = layout[id] || node.position;
        if (id !== node.id) delete layout[node.id];
    }
    const edges = [...board.data.edges];
    if (!edges.some(edge => edge.source === sourceId && edge.target === targetId)) {
        edges.push({ id: `e${sourceId}-${targetId}`, source: sourceId, target: targetId, animated: true });
    }
    await plugin.saveBoardData(boardId, { edges, layout });
}
