import * as React from 'react';
import { Notice } from 'obsidian';
import { Panel, useReactFlow } from 'reactflow';
import type { Node, Edge, Viewport } from 'reactflow';
import type TaskGraphPlugin from './main';
import type { TaskNodeData } from './TaskNode';
import type { AppNode, AppNodeData, TaskGraphView } from './TaskGraphView';
import { addGroup, cleanGroups, groupDescendants, groupParents, groupingError, migrateCollapsedGroups, removeGroup, treeSelection, nextGroupTitle, createEndpointResolver, translateGroupLayout } from './groups';
import type { GraphGroup } from './groups';
import { groupScene } from './GroupNode';
import { openTaskLocation } from './taskNavigation';
import { isSimplifiedChinese } from './language';
import { GroupCreateAction } from './GroupCreateAction';
import { ensureGraphObjectIds } from './groupConnections';

export function useGroupWorkspace(plugin: TaskGraphPlugin, boardId: string, view: TaskGraphView,
    nodes: AppNode[], setNodes: React.Dispatch<React.SetStateAction<AppNode[]>>, refresh: () => void) {
    const flow = useReactFlow<AppNodeData>();
    const [scope, setScope] = React.useState<string | null>(null);
    const [selectionPoint, setSelectionPoint] = React.useState<{ x: number; y: number } | null>(null);
    const [selecting, setSelecting] = React.useState(false);
    const selectionStart = () => setSelecting(true);
    const selectionEnd = (event: React.MouseEvent) => {
        setSelectionPoint({ x: event.clientX, y: event.clientY });
        setSelecting(false);
    };
    const [ungroupConfirmation, setUngroupConfirmation] = React.useState<string | null>(null);
    const viewports = React.useRef(new Map<string, Viewport>());
    const previousBoard = React.useRef(boardId);
    const dragPositions = React.useRef(new Map<string, { x: number; y: number }>());
    const zh = isSimplifiedChinese();
    const board = () => plugin.settings.boards.find(item => item.id === boardId);
    const groups = () => board()?.data.groups || [];
    const persist = async (next: GraphGroup[]) => {
        await plugin.saveBoardData(boardId, { groups: next }); refresh();
    };
    React.useEffect(() => {
        if (previousBoard.current !== boardId) { previousBoard.current = boardId; setScope(null); setSelectionPoint(null); setSelecting(false); viewports.current.clear(); }
    }, [boardId]);
    const currentScope = previousBoard.current === boardId && groups().some(group => group.id === scope) ? scope : null;
    const navigate = (id: string | null) => {
        viewports.current.set(currentScope || 'root', flow.getViewport());
        setScope(id);
        setSelectionPoint(null);
        setSelecting(false);
    };
    React.useEffect(() => {
        const timer = window.setTimeout(() => {
            const saved = viewports.current.get(currentScope || 'root');
            if (saved) void flow.setViewport(saved, { duration: 250 });
            else void flow.fitView({ nodes: flow.getNodes().filter(node => !node.hidden), duration: 250, padding: 0.15 });
        }, 100);
        return () => window.clearTimeout(timer);
    }, [currentScope, flow]);

    const sourcePath = (id: string): string | undefined => {
        const ids = groups().some(group => group.id === id) ? groupDescendants(groups(), id) : new Set([id]);
        return [...plugin.taskCache.values()].flat().find(task => ids.has(task.id) && task.source === 'checklist')?.path;
    };
    const collapse = async (id: string) => {
        const existing = groups().find(group => group.id === id || group.members.includes(id));
        if (existing) {
            const node = flow.getNode(existing.id);
            await persist(groups().map(group => group.id === existing.id ? { ...group, collapsed: !group.collapsed,
                position: node?.position || group.position } : group));
        } else {
            const tasks = [...plugin.taskCache.values()].flat();
            const next = migrateCollapsedGroups(groups(), { [id]: true }, tasks, board()?.data.edges || []);
            if (next.length === groups().length) { new Notice(zh ? '子树与已有分组冲突，请选择完整组合框。' : 'Select complete groups before collapsing this tree.'); return; }
            const created = next[next.length - 1]!;
            const mapping = await ensureGraphObjectIds(plugin, boardId, created.members);
            await persist([...groups(), { ...created, members: created.members.map(member => mapping.get(member) || member), rootTaskId: mapping.get(id) || id }]);
        }
    };
    const renameGroup = async (group: GraphGroup, title: string) => {
        await persist(groups().map(item => item.id === group.id ? { ...item, title } : item));
    };
    const ungroup = async (id: string, confirmed = false) => {
        const data = board()?.data;
        if (!data) return;
        const edges = data.edges.filter(edge => edge.source !== id && edge.target !== id);
        if (edges.length !== data.edges.length && !confirmed) { setUngroupConfirmation(id); return; }
        const parent = groupParents(groups()).get(id) || null;
        await plugin.saveBoardData(boardId, { groups: removeGroup(groups(), id), edges });
        if (scope === id) navigate(parent);
        setUngroupConfirmation(null);
        refresh();
    };
    const scene = (base: AppNode[], saved: Edge[], toggle: (id: string) => void) => {
        if (!plugin.isCacheInitialized) return { nodes: base, edges: saved };
        if (!groups().length && !Object.values(board()?.data.collapsedNodes || {}).some(Boolean)) {
            return { nodes: base, edges: saved };
        }
        const tasks = [...plugin.taskCache.values()].flat();
        const taskById = new Map(tasks.map(task => [task.id, task]));
        const allIds = new Set([...tasks.map(task => task.id), ...(board()?.data.textNodes || []).map(node => node.id)]);
        let next = cleanGroups(groups(), allIds);
        next = migrateCollapsedGroups(next, board()?.data.collapsedNodes || {}, tasks, saved);
        if (JSON.stringify(next) !== JSON.stringify(groups()) || Object.values(board()?.data.collapsedNodes || {}).some(Boolean)) {
            const config = board();
            if (config) {
                const removed = new Set(groups().filter(group => !next.some(item => item.id === group.id)).map(group => group.id));
                config.data.edges = config.data.edges.filter(edge => !removed.has(edge.source) && !removed.has(edge.target));
                config.data.groups = next; config.data.collapsedNodes = {};
                void plugin.saveSettings().then(async () => {
                    await ensureGraphObjectIds(plugin, boardId, next.flatMap(group => group.members));
                    refresh();
                }).catch(() => new Notice('Could not save group migration.'));
            }
        }
        const groupById = new Map(next.map(group => [group.id, group]));
        const baseById = new Map(base.map(node => [node.id, node]));
        const available = new Set(base.map(node => node.id));
        const rendered = next.filter(group => [...groupDescendants(next, group.id)].some(id => available.has(id)));
        const measured = base.map(node => {
            const previous = flow.getNode(node.id);
            return { ...node, width: previous?.width, height: previous?.height };
        });
        return groupScene(measured, rendered, saved, currentScope, group => {
            const actions = { label: group.title, collapsed: group.collapsed,
                onToggle: () => { void collapse(group.id); }, onEnter: () => navigate(group.id),
                onRename: (title: string) => { void renameGroup(group, title); }, onUngroup: () => { void ungroup(group.id); } };
            // Expanded frames do not display a checklist; build rows only when folded.
            const groupStatusColor = group.color || ({ backlog: '#8e8e93', pending: '#ff9500', in_progress: '#34c759', blocked: '#ff3b30', finished: '#af52de' }[group.status || 'backlog']);
            if (!group.collapsed) return { ...actions, status: group.status, color: groupStatusColor, rows: [] };
            const rows: { id: string; depth: number }[] = [];
            const seen = new Set<string>();
            const taskMembers = groupDescendants(next, group.id);
            const taskDepths = new Map<string, number>();
            const taskEdges = saved.filter(edge => taskMembers.has(edge.source) && taskMembers.has(edge.target));
            const children = new Map<string, string[]>();
            const targets = new Set<string>();
            for (const edge of taskEdges) {
                if (!children.has(edge.source)) children.set(edge.source, []);
                children.get(edge.source)!.push(edge.target); targets.add(edge.target);
            }
            const roots = [...taskMembers].filter(id => !targets.has(id));
            const queue = roots.map(id => ({ id, depth: 0 }));
            for (let i = 0; i < queue.length; i++) {
                const row = queue[i]!;
                if (taskDepths.has(row.id)) continue;
                taskDepths.set(row.id, row.depth);
                for (const id of children.get(row.id) || []) queue.push({ id, depth: row.depth + 1 });
            }
            const visit = (id: string, depth: number, seen: Set<string>) => {
                if (seen.has(id)) return; seen.add(id);
                const child = groupById.get(id);
                if (child) child.members.forEach(member => visit(member, depth + 1, seen));
                else rows.push({ id, depth: Math.max(depth, taskDepths.get(id) || 0) });
            };
            group.members.forEach(id => visit(id, 0, seen));
            const order = new Map<string, number>();
            const stack = [...roots, ...rows.map(row => row.id)].reverse();
            while (stack.length) {
                const id = stack.pop()!;
                if (order.has(id)) continue;
                order.set(id, order.size);
                stack.push(...(children.get(id) || []).slice().reverse());
            }
            rows.sort((a, b) => (order.get(a.id) || 0) - (order.get(b.id) || 0));
            const list = rows.flatMap(row => {
                    const task = taskById.get(row.id);
                    return task ? [{ ...row, label: task.text, checked: task.status === 'x',
                        onToggle: () => toggle(task.id), onOpen: () => { void openTaskLocation(plugin.app, task); } }] : [];
                });
            const root = group.rootTaskId ? baseById.get(group.rootTaskId) : undefined;
            const task = root?.type === 'task' ? root.data as TaskNodeData : undefined;
            const childrenRows = list.filter(row => row.id !== group.rootTaskId).map(row => ({ ...row, depth: Math.max(0, row.depth - 1) }));
            return { ...actions, status: group.status, color: groupStatusColor, rows: task ? childrenRows : list,
                task: task ? { ...task, hasChildren: true, isCollapsed: true, compactChildren: childrenRows,
                    onToggleCollapse: async () => { await collapse(group.id); } } : undefined };

        });
    };

    React.useEffect(() => {
        const doc = view.containerEl.ownerDocument;
        const onKey = (event: KeyboardEvent) => {
            const target = event.target;
            if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'a'
                || (target instanceof Element && target.closest('input, textarea, [contenteditable="true"]'))
                || !view.containerEl.closest('.workspace-leaf.mod-active')) return;
            const selected = flow.getNodes().filter(node => node.selected);
            if (!selected.length) return;
            event.preventDefault(); event.stopImmediatePropagation();
            const allTasks = new Set([...plugin.taskCache.values()].flat().map(task => task.id));
            const seeds = selected.flatMap(node => node.type === 'groupFrame' ? [...groupDescendants(groups(), node.id)] : [node.id]);
            const ids = treeSelection(seeds, board()?.data.edges || [], allTasks);
            const allowed = currentScope ? groupDescendants(groups(), currentScope) : null;
            const endpoint = createEndpointResolver(groups(), currentScope);
            const representatives = new Set([...ids].filter(id => !allowed || allowed.has(id)).map(endpoint));
            setNodes(current => current.map(node => ({ ...node, selected: (ids.has(node.id) && (!allowed || allowed.has(node.id))) || representatives.has(node.id) })));

        };
        doc.addEventListener('keydown', onKey, true);
        return () => doc.removeEventListener('keydown', onKey, true);
    });

    const selected = nodes.filter(node => node.selected && node.selectable !== false && !node.hidden).map(node => node.id);
    const beginCreate = async () => {
        const error = groupingError(selected, groups(), board()?.data.edges || []);
        if (error) { new Notice(error); return; }
        try {
            const title = nextGroupTitle(groups());
            const mapping = await ensureGraphObjectIds(plugin, boardId, selected);
            await persist(addGroup(groups(), selected.map(id => mapping.get(id) || id), title, board()?.data.edges || []));
        } catch (error) {
            new Notice(error instanceof Error ? error.message : 'Could not create group.');
        }
    };
    const dragStart = (_event: React.MouseEvent, node: Node) => {
        setSelecting(true);
        if (node.type !== 'groupFrame') return;
        const ids = new Set([node.id, ...groupDescendants(groups(), node.id)]);
        dragPositions.current = new Map(flow.getNodes().filter(item => ids.has(item.id)).map(item => [item.id, { ...item.position }]));
    };
    const drag = (_event: React.MouseEvent, node: Node) => {
        const origin = dragPositions.current.get(node.id);
        if (node.type !== 'groupFrame' || !origin) return;
        const dx = node.position.x - origin.x; const dy = node.position.y - origin.y;
        setNodes(current => current.map(item => {
            const pos = dragPositions.current.get(item.id);
            return pos && item.id !== node.id ? { ...item, position: { x: pos.x + dx, y: pos.y + dy } } : item;
        }));
    };
    const dragStop = async (node: Node) => {
        if (node.type !== 'groupFrame') return false;
        const config = board(); if (!config) return true;
        const ids = new Set([node.id, ...groupDescendants(groups(), node.id)]);
        const positions = new Map(flow.getNodes().filter(item => ids.has(item.id)).map(item => [item.id, item.position]));
        positions.set(node.id, node.position);
        const layout = { ...config.data.layout };
        for (const [id, position] of positions) if (!groups().some(group => group.id === id)) layout[id] = position;
        const textNodes = config.data.textNodes.map(item => ({ ...item, ...(positions.get(item.id) || { x: item.x, y: item.y }) }));
        await plugin.saveBoardData(boardId, { layout, textNodes, groups: groups().map(group => ({ ...group, position: positions.get(group.id) || group.position })) });
        dragPositions.current.clear(); refresh(); return true;
    };
    const moveGroups = (positions: Record<string, { x: number; y: number }>) => {
        const current = new Map(Object.entries(board()?.data.layout || {}));
        for (const item of board()?.data.textNodes || []) current.set(item.id, { x: item.x, y: item.y });
        for (const group of groups()) if (group.position) current.set(group.id, group.position);
        for (const node of flow.getNodes()) current.set(node.id, node.position);
        return translateGroupLayout(groups(), current, positions);
    };
    const path: GraphGroup[] = [];
    let ancestor = currentScope;
    while (ancestor && !path.some(group => group.id === ancestor)) {
        const group = groups().find(item => item.id === ancestor); if (!group) break;
        path.unshift(group); ancestor = groupParents(groups()).get(ancestor) || null;
    }
    const controls = <>
        {currentScope && <Panel position="top-left" className="task-group-navigation">
            <span className="task-group-path">{path.map(group => group.title).join(' / ')}</span>
        </Panel>}
        {selected.length >= 2 && selectionPoint && !selecting && <GroupCreateAction point={selectionPoint} onCreate={() => { void beginCreate(); }} container={view.containerEl} />}
        {ungroupConfirmation && <div className="edit-overlay" onMouseDown={event => event.stopPropagation()}><div className="edit-modal" role="dialog" aria-modal="true">
            <p>{zh ? '取消分组将删除组合框的外部连线，保留成员任务。继续？' : 'Ungrouping removes this frame’s connections and preserves members. Continue?'}</p>
            <button onClick={() => setUngroupConfirmation(null)}>{zh ? '取消' : 'Cancel'}</button>
            <button onClick={() => { void ungroup(ungroupConfirmation, true); }}>{zh ? '取消分组' : 'Ungroup'}</button>
        </div></div>}
    </>;
    const searchTargets = (sourceId: string) => {
        const source = nodes.find(node => node.id === sourceId);
        const parents = groupParents(groups());
        const owned = groups().some(group => group.id === sourceId) ? groupDescendants(groups(), sourceId) : new Set<string>();
        return nodes.filter(node => !node.hidden && node.id !== sourceId && !owned.has(node.id)
            && parents.get(node.id) === parents.get(source?.id || sourceId)
            && !board()?.data.edges.some(edge => edge.source === sourceId && edge.target === node.id))
            .map(node => ({ id: node.id, label: 'label' in node.data ? node.data.label : node.id,
                path: 'path' in node.data ? node.data.path : (zh ? '组合框' : 'Group') }));
    };
    return { selectionStart, selectionEnd, scope: currentScope, back: () => navigate(groupParents(groups()).get(currentScope || '') || null), scene, collapse, sourcePath, dragStart, drag, dragStop, controls, navigate, searchTargets, moveGroups };
}
