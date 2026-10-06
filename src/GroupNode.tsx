import * as React from 'react';
import { Handle, Position, useViewport } from 'reactflow';
import type { Node, Edge } from 'reactflow';
import type { GraphGroup } from './groups';
import { groupDescendants, createEndpointResolver } from './groups';
import { TaskNode } from './TaskNode';
import type { TaskNodeData } from './TaskNode';
import { isSimplifiedChinese } from './language';

export interface GroupRow {
    id: string; label: string; depth: number; checked: boolean;
    onToggle: () => void; onOpen: () => void;
}
export interface GroupNodeData {
    label: string; collapsed: boolean; rows: GroupRow[];
    width: number; height: number;
    task?: TaskNodeData;
    status?: GraphGroup['status']; color?: string;
    onToggle: () => void; onEnter: () => void; onRename: (title: string) => void; onUngroup: () => void;
}

export const GroupNode = React.memo(({ data, isConnectable }: { data: GroupNodeData; isConnectable: boolean }) => {
    const zh = isSimplifiedChinese();
    const { zoom } = useViewport();
    const groupScale = Math.min(2, Math.max(0.75, 1 / Math.max(zoom, 0.35)));
    const titleSize = Math.min(60, Math.max(14, 17 / Math.max(zoom, 0.35)));
    const [editing, setEditing] = React.useState(false);
    const [draft, setDraft] = React.useState(data.label);
    const inputRef = React.useRef<HTMLInputElement>(null);
    React.useEffect(() => { if (!editing) setDraft(data.label); }, [data.label, editing]);
    React.useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);
    const finishRename = () => { setEditing(false); const next = draft.trim(); if (next && next !== data.label) data.onRename(next); };
    return <div className={`task-group-frame ${data.collapsed ? 'is-collapsed' : ''}`} style={{ width: data.width, minHeight: data.height, borderColor: data.color || 'var(--interactive-accent)', '--task-group-color': data.color || 'var(--interactive-accent)', '--task-group-scale': groupScale } as React.CSSProperties}>
        <Handle type="target" position={Position.Left} className="custom-handle task-group-handle-left" isConnectable={isConnectable} />
        <header className="task-group-title" onDoubleClick={event => { event.stopPropagation(); data.onEnter(); }}>
            {data.status && <span className="task-group-status" title={data.status}>{data.status === 'in_progress' ? 'In progress' : data.status.charAt(0).toUpperCase() + data.status.slice(1)}</span>}
            {editing ? <input ref={inputRef} className="task-group-title-input nodrag" value={draft}
                style={{ fontSize: `${titleSize}px` }} onChange={event => setDraft(event.target.value)}
                onBlur={finishRename} onMouseDown={event => event.stopPropagation()}
                onKeyDown={event => { event.stopPropagation(); if (event.key === 'Enter') { event.preventDefault(); finishRename(); } if (event.key === 'Escape') { setDraft(data.label); setEditing(false); } }} />
                : <strong style={{ fontSize: `${titleSize}px` }}>{data.label}</strong>}
            <div className="nodrag task-group-actions">
                <button onClick={event => { event.stopPropagation(); setEditing(true); }} aria-label={zh ? '重命名' : 'Rename'}>✎</button>
                <button onClick={data.onEnter} aria-label={zh ? '进入组合框' : 'Enter group'}>↗</button>
                <button onClick={data.onToggle} aria-label={zh ? '折叠或展开' : 'Collapse or expand'}>{data.collapsed ? '+' : '−'}</button>
                <button onClick={data.onUngroup} aria-label={zh ? '取消分组' : 'Ungroup'}>×</button>
            </div>
        </header>
        {data.collapsed && data.task && <div className="task-group-card"><TaskNode data={data.task} isConnectable={false} showHandles={false} /></div>}
        {data.collapsed && !data.task && <div className="nodrag task-group-list">{data.rows.map(row => <div key={row.id} className="task-group-row" style={{ paddingLeft: row.depth * 12 }}>
            <input type="checkbox" checked={row.checked} onChange={row.onToggle} />
            <span className={row.checked ? 'is-complete' : ''}>{row.label}</span>
            <button onClick={row.onOpen} aria-label={zh ? '打开任务' : 'Open task'}>↗</button>
        </div>)}</div>}
        <Handle type="source" position={Position.Right} className="custom-handle custom-handle-right task-group-handle-right" isConnectable={isConnectable} />
    </div>;
});

export function groupScene<T>(base: Node<T>[], groups: GraphGroup[], edges: Edge[], scope: string | null,
    dataFor: (group: GraphGroup) => Omit<GroupNodeData, 'width' | 'height'>): { nodes: Node<T | GroupNodeData>[]; edges: Edge[] } {
    const all: Node<T | GroupNodeData>[] = base.map(node => ({ ...node }));
    const byId = new Map(all.map(node => [node.id, node]));
    const visiting = new Set<string>();
    const groupById = new Map(groups.map(group => [group.id, group]));
    const build = (group: GraphGroup): Node<T | GroupNodeData> | undefined => {
        if (byId.has(group.id)) return byId.get(group.id);
        if (visiting.has(group.id)) return;
        visiting.add(group.id);
        const members = group.members.flatMap(id => {
            const child = groupById.get(id);
            const node = child ? build(child) : byId.get(id);
            return node ? [node] : [];
        });
        visiting.delete(group.id);
        if (!members.length) return;
        const x = Math.min(...members.map(node => node.position.x)) - 24;
        const y = Math.min(...members.map(node => node.position.y)) - 24;
        const width = Math.max(...members.map(node => node.position.x + (node.width || 240))) - x + 24;
        const height = Math.max(...members.map(node => node.position.y + (node.height || 160))) - y + 24;
        const data = dataFor(group);
        const node: Node<T | GroupNodeData> = { id: group.id, type: 'groupFrame',
            position: group.collapsed ? group.position || { x, y } : { x, y },
            width: group.collapsed ? 300 : width, height: group.collapsed ? (data.task ? 210 : 48) + data.rows.length * 32 : height,
            dragHandle: group.collapsed ? undefined : '.task-group-title', zIndex: -1,
            data: { ...data, width: group.collapsed ? 300 : width, height: group.collapsed ? (data.task ? 210 : 48) + data.rows.length * 32 : height } };
        all.push(node); byId.set(group.id, node); return node;
    };
    groups.forEach(build);
    const endpoint = createEndpointResolver(groups, scope);
    for (const node of all) {
        node.hidden = endpoint(node.id) !== node.id;
        node.selectable = !node.hidden;
        node.draggable = node.selectable;
        node.connectable = node.selectable;
        if (node.type === 'groupFrame') node.zIndex = -1 - groupDescendants(groups, node.id).size;
    }
    const projected = edges.flatMap(edge => {
        const source = endpoint(edge.source);
        const target = endpoint(edge.target);
        return source && target && source !== target && byId.has(source) && byId.has(target)
            ? [{ ...edge, source, target }] : [];
    });
    return { nodes: all, edges: projected };
}
