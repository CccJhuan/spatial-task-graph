import type { Edge } from 'reactflow';
import type { TaskCacheItem } from './main';

interface RelationData { origin?: 'document'; }

/** Reconcile only tracked document edges; untracked and manual edges remain intact. */
export function synchronizeHierarchy(tasks: TaskCacheItem[], edges: Edge<RelationData>[]) {
    const checklist = tasks.filter(task => task.source === 'checklist');
    const byLine = new Map(checklist.map(task => [`${task.path}::${task.line}`, task]));
    const expected = new Map<string, Edge<RelationData>>();
    const pair = (source: string, target: string) => JSON.stringify([source, target]);
    for (const child of checklist) {
        if (child.parentLine === undefined || child.parentLine < 0) continue;
        const parent = byLine.get(`${child.path}::${child.parentLine}`);
        if (!parent || parent.id === child.id) continue;
        expected.set(pair(parent.id, child.id), {
            id: `e${parent.id}-${child.id}`, source: parent.id, target: child.id,
            animated: true, data: { origin: 'document' }
        });
    }
    const nextEdges = edges.filter(edge => edge.data?.origin !== 'document' || expected.has(pair(edge.source, edge.target)));
    const removed = edges.length - nextEdges.length;
    const existing = new Set(nextEdges.map(edge => pair(edge.source, edge.target)));
    let added = 0;
    for (const [key, edge] of expected) {
        if (existing.has(key)) continue;
        nextEdges.push(edge);
        existing.add(key);
        added++;
    }
    return { edges: nextEdges, added, removed };
}
