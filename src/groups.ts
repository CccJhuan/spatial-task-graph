import type { Edge } from 'reactflow';
import type { GraphBoard } from './main';

export function remapGraphReferences(data: GraphBoard['data'], remap: (id: string) => string): GraphBoard['data'] {
    return { ...data,
        layout: Object.fromEntries(Object.entries(data.layout).map(([id, position]) => [remap(id), position])),
        edges: data.edges.map(edge => ({ ...edge, source: remap(edge.source), target: remap(edge.target) })),
        groups: (data.groups || []).map(group => ({ ...group, members: group.members.map(remap), rootTaskId: group.rootTaskId ? remap(group.rootTaskId) : undefined })),
        collapsedNodes: Object.fromEntries(Object.entries(data.collapsedNodes || {}).map(([id, value]) => [remap(id), value])),
        nodeStatus: Object.fromEntries(Object.entries(data.nodeStatus || {}).map(([id, value]) => [remap(id), value])) };
}

export interface GraphGroup {
    id: string;
    title: string;
    rootTaskId?: string;
    members: string[];
    collapsed: boolean;
    status?: 'backlog' | 'pending' | 'in_progress' | 'blocked' | 'finished';
    color?: string;
    position?: { x: number; y: number };
}

export function groupParents(groups: GraphGroup[]): Map<string, string> {
    return new Map(groups.flatMap(group => group.members.map(id => [id, group.id] as const)));
}

export function groupDescendants(groups: GraphGroup[], id: string): Set<string> {
    const byId = new Map(groups.map(group => [group.id, group]));
    const seen = new Set<string>();
    const queue = [...(byId.get(id)?.members || [])];
    for (let i = 0; i < queue.length; i++) {
        const member = queue[i]!;
        if (seen.has(member) || member === id) continue;
        seen.add(member);
        queue.push(...(byId.get(member)?.members || []));
    }
    return seen;
}

export function treeSelection(seeds: string[], edges: Edge[], tasks: Set<string>): Set<string> {
    const adjacent = new Map<string, string[]>();
    for (const edge of edges) {
        if (!tasks.has(edge.source) || !tasks.has(edge.target)) continue;
        if (!adjacent.has(edge.source)) adjacent.set(edge.source, []);
        if (!adjacent.has(edge.target)) adjacent.set(edge.target, []);
        adjacent.get(edge.source)!.push(edge.target);
        adjacent.get(edge.target)!.push(edge.source);
    }
    const seen = new Set(seeds.filter(id => tasks.has(id)));
    const queue = [...seen];
    for (let i = 0; i < queue.length; i++) for (const id of adjacent.get(queue[i]!) || []) {
        if (!seen.has(id)) { seen.add(id); queue.push(id); }
    }
    return seen;
}

/** Map a task edge to the direct objects at the selection's common level. */
export function groupingError(ids: string[], groups: GraphGroup[], edges: Edge[]): string | null {
    const selected = new Set(ids);
    if (selected.size < 2) return 'Select at least two connected objects.';
    const parents = groupParents(groups);
    if (new Set(ids.map(id => parents.get(id))).size !== 1) return 'Select whole groups at the same level; members cannot belong to two groups.';
    const mapped = projectLayoutEdges(groups, edges, parents.get(ids[0]!) || null);
    return treeSelection([ids[0]!], mapped, selected).size === selected.size ? null : 'Selected objects must be connected without unselected intermediate objects.';
}

/** Project edges onto the direct objects being laid out, including expanded groups. */
export function projectLayoutEdges(groups: GraphGroup[], edges: Edge[], scope: string | null): Edge[] {
    const parents = groupParents(groups);
    const resolved = new Map<string, string | null>();
    const endpoint = (id: string): string | null => {
        if (resolved.has(id)) return resolved.get(id)!;
        const original = id;
        const seen = new Set<string>();
        while (parents.has(id)) {
            if (seen.has(id)) { resolved.set(original, null); return null; }
            seen.add(id);
            const parent = parents.get(id)!;
            if (parent === scope) { resolved.set(original, id); return id; }
            id = parent;
        }
        const result = scope ? null : id;
        resolved.set(original, result);
        return result;
    };
    const pairs = new Map<string, Set<string>>();
    return edges.flatMap(edge => {
        const source = endpoint(edge.source); const target = endpoint(edge.target);
        if (!source || !target || source === target || pairs.get(source)?.has(target)) return [];
        if (!pairs.has(source)) pairs.set(source, new Set());
        pairs.get(source)!.add(target);
        return [{ ...edge, source, target }];
    });
}

/** Apply one translation to a group and all its descendants; preserve saved local offsets. */
export function translateGroupLayout(groups: GraphGroup[], current: Map<string, { x: number; y: number }>,
    layout: Record<string, { x: number; y: number }>): Record<string, { x: number; y: number }> {
    const result = { ...layout };
    const groupIds = new Set(groups.map(group => group.id));
    for (const [id, position] of Object.entries(layout)) {
        const origin = current.get(id);
        if (!groupIds.has(id) || !origin) continue;
        const dx = position.x - origin.x; const dy = position.y - origin.y;
        for (const member of groupDescendants(groups, id)) {
            const point = current.get(member);
            if (point) result[member] = { x: point.x + dx, y: point.y + dy };
        }
    }
    return result;
}

/** Keep the enclosing frame anchored when arranging its contents. */
export function anchorGroupLayout(layout: Record<string, { x: number; y: number }>,
    current: { position: { x: number; y: number } }[]): Record<string, { x: number; y: number }> {
    const points = Object.values(layout);
    if (!points.length || !current.length) return layout;
    const dx = Math.min(...current.map(node => node.position.x)) - Math.min(...points.map(point => point.x));
    const dy = Math.min(...current.map(node => node.position.y)) - Math.min(...points.map(point => point.y));
    return Object.fromEntries(Object.entries(layout).map(([id, point]) => [id, { x: point.x + dx, y: point.y + dy }]));
}

export function nextGroupTitle(groups: GraphGroup[]): string {
    let number = 1;
    const titles = new Set(groups.map(group => group.title));
    while (titles.has(`Group ${number}`)) number++;
    return `Group ${number}`;
}

export function addGroup(groups: GraphGroup[], ids: string[], title: string, edges: Edge[]): GraphGroup[] {
    const error = groupingError(ids, groups, edges);
    if (error) throw new Error(error);
    const parent = groupParents(groups).get(ids[0]!);
    const id = `group-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const members = new Set(ids);
    return [...groups.map(group => group.id === parent
        ? { ...group, members: [...group.members.filter(member => !members.has(member)), id] } : group),
    { id, title: title.trim() || 'Group', members: [...members], collapsed: false }];
}

export function removeGroup(groups: GraphGroup[], id: string): GraphGroup[] {
    const removed = groups.find(group => group.id === id);
    return groups.filter(group => group.id !== id).map(group => ({ ...group,
        members: group.members.flatMap(member => member === id ? removed?.members || [] : [member]) }));
}

export function cleanGroups(groups: GraphGroup[], available: Set<string>): GraphGroup[] {
    let next = groups.map(group => ({ ...group, members: [...group.members] }));
    let changed = true;
    while (changed) {
        const ids = new Set([...available, ...next.map(group => group.id)]);
        next = next.map(group => ({ ...group, members: group.members.filter(id => ids.has(id)) }));
        const previous = next.length;
        next = next.filter(group => group.members.length);
        changed = next.length !== previous;
    }
    return next;
}

/** Reuse parent indexes and resolved endpoints for one render instead of rebuilding per edge. */
export function createEndpointResolver(groups: GraphGroup[], scope: string | null): (id: string) => string | null {
    const parents = groupParents(groups);
    const byId = new Map(groups.map(group => [group.id, group]));
    const resolved = new Map<string, string | null>();
    return (id: string) => {
        if (resolved.has(id)) return resolved.get(id)!;
        let visible = id;
        let current = id;
        const seen = new Set<string>();
        while (parents.has(current) && !seen.has(current)) {
            seen.add(current);
            const parent = parents.get(current)!;
            if (parent === scope) { resolved.set(id, visible); return visible; }
            if (byId.get(parent)?.collapsed) visible = parent;
            current = parent;
        }
        const result = scope ? null : visible;
        resolved.set(id, result);
        return result;
    };
}

export function visibleEndpoint(id: string, groups: GraphGroup[], scope: string | null): string | null {
    return createEndpointResolver(groups, scope)(id);
}

export function migrateCollapsedGroups(groups: GraphGroup[], collapsed: Record<string, boolean>, tasks: { id: string; text: string }[], edges: Edge[]): GraphGroup[] {
    const taskById = new Map(tasks.map(task => [task.id, task]));
    // Previous tree groups were named after their parent task and had no explicit root.
    // Recognize that representation without changing manually named groups.
    const assigned = [...groups];
    let next = groups.map(group => {
        if (group.rootTaskId) return group;
        const matchingTitles = group.members.filter(id => taskById.get(id)?.text === group.title);
        if (!matchingTitles.length) return group;
        const members = groupDescendants(groups, group.id);
        const candidates = matchingTitles.filter(id => !edges.some(edge => edge.target === id && members.has(edge.source)));
        if (candidates.length !== 1) return group;
        const upgraded = { ...group, rootTaskId: candidates[0], title: nextGroupTitle(assigned) };
        assigned.push(upgraded);
        return upgraded;
    });
    const taskIds = new Set(tasks.map(task => task.id));
    const roots = Object.keys(collapsed).filter(id => collapsed[id] && taskIds.has(id));
    const descendants = (root: string) => {
        const seen = new Set([root]); const queue = [root];
        for (let i = 0; i < queue.length; i++) for (const edge of edges) {
            if (edge.source === queue[i] && taskIds.has(edge.target) && !seen.has(edge.target)) { seen.add(edge.target); queue.push(edge.target); }
        }
        return seen;
    };
    roots.sort((a, b) => descendants(b).size - descendants(a).size);
    for (const root of roots) {
        if (groupParents(next).has(root)) continue;
        const members = descendants(root);
        if (members.size < 2) continue;
        const parents = groupParents(next);
        const ids = [...members].filter(id => !parents.has(id));
        for (const group of next) {
            const leaves = [...groupDescendants(next, group.id)].filter(id => taskIds.has(id));
            if (!parents.has(group.id) && leaves.length && leaves.every(id => members.has(id))) ids.push(group.id);
        }
        if ([...members].some(id => parents.has(id) && !ids.some(groupId => groupDescendants(next, groupId).has(id)))) continue;
        if (groupingError(ids, next, edges)) continue;
        next = addGroup(next, ids, nextGroupTitle(next), edges);
        next[next.length - 1]!.collapsed = true;
        next[next.length - 1]!.rootTaskId = root;
    }
    return next;
}
