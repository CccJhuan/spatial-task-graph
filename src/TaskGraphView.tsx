import { ItemView, WorkspaceLeaf, Menu, Notice, TFile, debounce } from 'obsidian';
import * as React from 'react';
import { createRoot, Root } from 'react-dom/client';
import ReactFlow, {
  Background,
  useNodesState,
  useEdgesState,
  Node,
  Connection,
  Edge,
  Panel,
  Handle,
  Position,
  ReactFlowProvider,
  useReactFlow,
  SelectionMode,
  ConnectionLineType,
  Viewport,
  OnConnectStartParams
} from 'reactflow';

import TaskGraphPlugin, { GraphBoard } from './main';
import { synchronizeHierarchy } from './taskHierarchy';
import { FilterCondition, getFilterConditions, filterSuggestions } from './taskFilters';
import { isSimplifiedChinese } from './language';
import { PanelDropdown } from './PanelDropdown';
import { TaskSearch } from './TaskSearch';
import { openTaskLocation } from './taskNavigation';
import { GroupNode } from './GroupNode';
import { GraphToolbar } from './GraphToolbar';
import { TaskNode, STATUS_COLORS } from './TaskNode';
import type { TaskNodeData } from './TaskNode';
import type { GroupNodeData } from './GroupNode';
import { useGroupWorkspace } from './useGroupWorkspace';
import { groupDescendants, groupParents, projectLayoutEdges, anchorGroupLayout } from './groups';
import { connectGraphObjects } from './groupConnections';
import { ConnectionActions } from './ConnectionActions';

export const VIEW_TYPE_TASK_GRAPH = 'task-graph-view';


interface TextNodeData {
    id: string; label: string;
    onSave: (id: string, text: string) => Promise<void>;
}

// 【终极架构修复】：定义 Data 联合类型，并据此衍生全局 AppNode
export type AppNodeData = TaskNodeData | TextNodeData | GroupNodeData;
export type AppNode = Node<AppNodeData>;

// 自定义类型守卫，精准指引 TypeScript 识别节点身份
const isTaskNode = (node: AppNode): node is Node<TaskNodeData, 'task'> => node.type === 'task';



const TextNode = React.memo(({ data, isConnectable }: { data: TextNodeData, isConnectable: boolean }) => {
    const [text, setText] = React.useState(data.label);
    const handleBlur = () => { if (text !== data.label) void data.onSave(data.id, text); };
    const rows = Math.max(1, text.split('\n').length);
    const stopKeys = (e: React.KeyboardEvent) => e.stopPropagation();

    return (
        <div className="text-node-wrapper">
            <Handle type="target" position={Position.Left} isConnectable={isConnectable} className="custom-handle" style={{ left: '-20px', width: '40px', height: '40px', top: '50%', transform: 'translateY(-50%)' }} />
            <textarea className="text-node-textarea nodrag" value={text} onChange={(e) => setText(e.target.value)} onBlur={handleBlur} rows={rows} placeholder="Note..." onMouseDown={(e) => e.stopPropagation()} onKeyDown={stopKeys} onKeyUp={stopKeys} style={{ height: 'auto' }} />
            <Handle type="source" position={Position.Right} isConnectable={isConnectable} className="custom-handle custom-handle-right" style={{ right: '-20px', width: '40px', height: '40px', top: '50%', transform: 'translateY(-50%)' }} />
        </div>
    );
});

const nodeTypes = { task: TaskNode, text: TextNode, groupFrame: GroupNode };

const EditTaskModal = ({ initialText, onClose, onSave, allTags }: { initialText: string, onClose: () => void, onSave: (text: string) => void | Promise<void>, allTags: string[] }) => {
    const [text, setText] = React.useState(initialText);
    const [suggestions, setSuggestions] = React.useState<string[]>([]);
    const [suggestionPos, setSuggestionPos] = React.useState({ top: 0, left: 0 });
    const [metadataPrompt, setMetadataPrompt] = React.useState<{ symbol: string, label: string, value: string, kind: 'date' | 'recurrence' } | null>(null);
    const textareaRef = React.useRef<HTMLTextAreaElement>(null);

    const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const val = e.target.value; setText(val);
        const cursorPos = e.target.selectionStart; const textBeforeCursor = val.slice(0, cursorPos); const match = textBeforeCursor.match(/#([\w\u4e00-\u9fa5]*)$/);
        if (match) { const query = (match[1] || '').toLowerCase(); const filtered = allTags.filter(t => t.toLowerCase().includes(query)).slice(0, 10); if (filtered.length > 0) { setSuggestions(filtered); setSuggestionPos({ top: 140, left: 30 }); } else { setSuggestions([]); } } else { setSuggestions([]); }
    };
    const insertTag = (tag: string) => { const cursorPos = textareaRef.current?.selectionStart || text.length; const textBeforeCursor = text.slice(0, cursorPos); const textAfterCursor = text.slice(cursorPos); const lastHashIndex = textBeforeCursor.lastIndexOf('#'); const newText = textBeforeCursor.slice(0, lastHashIndex) + tag + ' ' + textAfterCursor; setText(newText); setSuggestions([]); textareaRef.current?.focus(); };
    const appendToFirstLine = (value: string) => {
        const lines = text.split('\n');
        const firstLine = (lines.shift() || '').trimEnd();
        lines.unshift(`${firstLine}${firstLine ? ' ' : ''}${value}`.trim());
        setText(lines.join('\n'));
        setMetadataPrompt(null);
        textareaRef.current?.focus();
    };
    const insertMetadata = (symbol: string) => appendToFirstLine(symbol);
    const openDatePrompt = (symbol: string, label: string) => {
        const match = text.split('\n')[0]?.match(new RegExp(`${symbol}\\s+(\\d{4}-\\d{2}-\\d{2})`));
        setMetadataPrompt({ symbol, label, value: match?.[1] || new Date().toISOString().slice(0, 10), kind: 'date' });
    };
    const openRecurrencePrompt = () => setMetadataPrompt({ symbol: '🔁', label: 'Recurring schedule', value: 'every week', kind: 'recurrence' });

    const handleKeyDown = (e: React.KeyboardEvent) => { e.stopPropagation(); if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void onSave(text); } };

    return (
        <div className="edit-overlay">
            <div className="edit-modal" onClick={(e) => e.stopPropagation()}>
                <h3 style={{ margin: 0, fontWeight: 600, color: 'var(--text-normal)' }}>Edit task</h3>
                <div style={{ position: 'relative' }}>
                    <textarea ref={textareaRef} value={text} onChange={handleInput} onKeyDown={handleKeyDown} onKeyUp={(e) => e.stopPropagation()} style={{ width: '100%', height: '120px', resize: 'vertical', padding: '12px', borderRadius: '8px', border: '1px solid var(--background-modifier-border)', fontSize: '14px', lineHeight: '1.5', background: 'var(--background-secondary)', color: 'var(--text-normal)' }} placeholder="Task description...&#10;Press Shift+Enter to add notes." autoFocus />
                    {suggestions.length > 0 && (<div className="suggestion-list" style={{ top: suggestionPos.top, left: suggestionPos.left }}>{suggestions.map(tag => (<div key={tag} className="suggestion-item" onClick={() => insertTag(tag)}>{tag}</div>))}</div>)}
                </div>
                <div className="metadata-toolbar">
                    <div className="metadata-btn" onClick={() => openDatePrompt('📅', 'Due date')} title="Due date">📅 <span className="metadata-label">Due</span></div>
                    <div className="metadata-btn" onClick={() => openDatePrompt('🛫', 'Start date')} title="Start date">🛫 <span className="metadata-label">Start</span></div>
                    <div className="metadata-btn" onClick={() => openDatePrompt('⏳', 'Scheduled date')} title="Scheduled date">⏳ <span className="metadata-label">Sched</span></div>
                    <div className="metadata-btn" onClick={openRecurrencePrompt} title="Recurring">🔁 <span className="metadata-label">Recur</span></div>
                    <div style={{ width: 1, height: 16, background: 'var(--background-modifier-border)', margin: '0 4px' }}></div>
                    <div className="metadata-btn" onClick={() => insertMetadata('🔺')} title="High priority">🔺</div>
                    <div className="metadata-btn" onClick={() => insertMetadata('🔼')} title="Medium priority">🔼</div>
                    <div className="metadata-btn" onClick={() => insertMetadata('🔽')} title="Low priority">🔽</div>
                </div>
                {metadataPrompt && (
                    <div className="metadata-prompt" onKeyDown={e => e.stopPropagation()}>
                        <div className="metadata-prompt-title">{metadataPrompt.label}</div>
                        {metadataPrompt.kind === 'date' ? (
                            <input className="metadata-prompt-input" type="date" value={metadataPrompt.value} onChange={e => { if (e.target.value) appendToFirstLine(`${metadataPrompt.symbol} ${e.target.value}`); }} autoFocus />
                        ) : (
                            <>
                                <select className="metadata-prompt-input" value={metadataPrompt.value} onChange={e => { if (e.target.value) appendToFirstLine(`${metadataPrompt.symbol} ${e.target.value}`); else setMetadataPrompt({ ...metadataPrompt, value: '' }); }}>
                                    <option value="every day">Every day</option>
                                    <option value="every week">Every week</option>
                                    <option value="every month">Every month</option>
                                    <option value="every year">Every year</option>
                                    <option value="">Custom</option>
                                </select>
                                <input className="metadata-prompt-input" value={metadataPrompt.value} onChange={e => setMetadataPrompt({ ...metadataPrompt, value: e.target.value })} placeholder="e.g. every 2 weeks" />
                            </>
                        )}
                        <div className="metadata-prompt-actions">
                            <button type="button" onClick={() => setMetadataPrompt(null)}>Cancel</button>
                            <button type="button" onClick={() => { if (metadataPrompt.value.trim()) appendToFirstLine(`${metadataPrompt.symbol} ${metadataPrompt.value.trim()}`); }}>Insert</button>
                        </div>
                    </div>
                )}
                <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: 'auto' }}><button onClick={onClose} style={{ padding: '6px 12px', borderRadius: '6px', border: '1px solid var(--background-modifier-border)', background: 'transparent', color: 'var(--text-normal)' }}>Cancel</button><button onClick={() => { void onSave(text); }} style={{ padding: '6px 16px', borderRadius: '6px', border: 'none', background: 'var(--interactive-accent)', color: 'white', fontWeight: 500 }}>Save</button></div>
            </div>
        </div>
    );
};

const ConfirmModal = ({ message, onConfirm, onClose }: { message: string, onConfirm: () => void | Promise<void>, onClose: () => void }) => {
    return (
        <div className="edit-overlay" onClick={onClose}>
            <div className="edit-modal" style={{ width: '320px', alignItems: 'center', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                <h3 style={{ margin: '0 0 10px 0', color: 'var(--text-normal)' }}>Confirm action</h3>
                <p style={{ color: 'var(--text-muted)', marginBottom: '20px', fontSize: '14px' }}>{message}</p>
                <div style={{ display: 'flex', gap: '12px', width: '100%', justifyContent: 'center' }}>
                    <button onClick={onClose} style={{ padding: '8px 16px', borderRadius: '6px', border: '1px solid var(--background-modifier-border)', background: 'transparent', color: 'var(--text-normal)', cursor: 'pointer' }}>Cancel</button>
                    <button onClick={() => { void onConfirm(); onClose(); }} style={{ padding: '8px 16px', borderRadius: '6px', border: 'none', background: 'var(--interactive-accent)', color: 'white', fontWeight: 500, cursor: 'pointer' }}>Confirm</button>
                </div>
            </div>
        </div>
    );
};

const TaskSidebar = React.memo(({ nodes, onNodeCenter, onStatusChange, onSearch }: { nodes: AppNode[], onNodeCenter: (nodeId: string) => void, onStatusChange: (id: string, status: string) => Promise<void>, onSearch: () => void }) => {
    const sidebarRef = React.useRef<HTMLDivElement>(null);
    const [availableHeight, setAvailableHeight] = React.useState(600);
    React.useLayoutEffect(() => {
        const parent = sidebarRef.current?.parentElement;
        if (!parent) return;
        const updateHeight = () => setAvailableHeight(parent.clientHeight);
        updateHeight();
        const observer = new ResizeObserver(updateHeight);
        observer.observe(parent);
        return () => observer.disconnect();
    }, []);
    // Reserve panel padding, headings, and section gaps; allocate whole rows.
    const rowHeight = 36;
    const rowGap = 6;
    const maxRows = Math.max(1, Math.floor((availableHeight - 198) / (3 * (rowHeight + rowGap))));
    const { inProgress, pending, backlog } = React.useMemo(() => {
        const tasks = nodes.filter(isTaskNode);
        const groups = nodes.filter(node => node.type === 'groupFrame');
        const statusOf = (node: AppNode) => isTaskNode(node) ? (node.data.customStatus || 'backlog') : ((node.data as GroupNodeData).status || 'backlog');
        return {
            inProgress: [...tasks, ...groups].filter(n => statusOf(n) === 'in_progress'),
            pending: [...tasks, ...groups].filter(n => statusOf(n) === 'pending'),
            backlog: [...tasks, ...groups].filter(n => statusOf(n) === 'backlog' || statusOf(n) === 'default')
        };
    }, [nodes]);
    const stopProp = (e: React.MouseEvent | React.WheelEvent) => e.stopPropagation();

    const handleDragStart = (e: React.DragEvent, nodeId: string) => { e.dataTransfer.setData('nodeId', nodeId); e.dataTransfer.effectAllowed = 'move'; };
    const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; };
    const handleDrop = (e: React.DragEvent, targetStatus: string) => { e.preventDefault(); const nodeId = e.dataTransfer.getData('nodeId'); if (nodeId) void onStatusChange(nodeId, targetStatus); };

    const renderList = (title: string, items: AppNode[], color: string, className: string, statusKey: string) => (
        <div className={`sidebar-section${items.length === 0 ? ' is-empty' : ''}`} onDragOver={handleDragOver} onDrop={(e) => handleDrop(e, statusKey)}>
            <div className="sidebar-title" style={{ color: color }}><div style={{ width: 6, height: 6, borderRadius: '50%', background: color }}></div>{title} <span style={{ opacity: 0.5 }}>({items.length})</span></div>
            <div className="sidebar-list" style={{ height: items.length ? Math.min(items.length, maxRows) * (rowHeight + rowGap) - rowGap : 16 }}>
                {items.map(node => (
                    <div key={node.id} className={`sidebar-item item-${className} ${node.type === 'groupFrame' ? 'sidebar-group-item' : ''}`} onClick={() => onNodeCenter(node.id)} draggable onDragStart={(e) => handleDragStart(e, node.id)}>{node.type === 'groupFrame' ? `▣ ${node.data.label}` : node.data.label.replace(/#\S+/g, '').trim()}</div>
                ))}
                {items.length === 0 && <div style={{ fontSize: '11px', color: 'var(--text-faint)', paddingLeft: '10px' }}>Empty - Drop here</div>}
            </div>
        </div>
    );
    return (<div ref={sidebarRef} className="task-sidebar" onMouseDown={stopProp} onWheel={stopProp} onContextMenu={stopProp}><div style={{ marginBottom: '16px', fontSize: '16px', lineHeight: '24px', flexShrink: 0, fontWeight: '800', letterSpacing: '-0.5px', color: 'var(--text-normal)'  , display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>My tasks<button type="button" className="task-sidebar-search" aria-label={isSimplifiedChinese() ? "搜索任务" : "Search tasks"} onClick={onSearch}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></svg></button></div>{renderList('In progress', inProgress, STATUS_COLORS['in_progress'], 'in-progress', 'in_progress')}{renderList('Pending', pending, STATUS_COLORS['pending'], 'pending', 'pending')}{renderList('Backlog', backlog, STATUS_COLORS['backlog'], 'backlog', 'backlog')}</div>);
}, (previous, next) => previous.onNodeCenter === next.onNodeCenter
    && previous.onStatusChange === next.onStatusChange && previous.onSearch === next.onSearch
    && previous.nodes.length === next.nodes.length && previous.nodes.every((node, index) => {
        const current = next.nodes[index];
        if (!current || node.id !== current.id || node.type !== current.type) return false;
        if (isTaskNode(node) && isTaskNode(current)) return node.data.label === current.data.label && node.data.customStatus === current.data.customStatus;
        if (node.type === 'groupFrame' && current.type === 'groupFrame') {
            const before = node.data as GroupNodeData; const after = current.data as GroupNodeData;
            return before.label === after.label && before.status === after.status;
        }
        return false;
    }));


interface ControlPanelProps {
    boards: GraphBoard[];
    activeBoardId: string;
    onSwitchBoard: (id: string) => void;
    onAddBoard: () => void;
    onRenameBoard: (name: string) => Promise<void>;
    onArchiveBoard: (id: string) => Promise<void>;
    onAutoLayout: () => Promise<void>;
    onSyncRelations: () => Promise<void>;
    onResetView: () => void;
    currentBoard: GraphBoard | undefined;
    onUpdateFilter: (type: string, value: string) => Promise<void>;
    onApplyFilters: (conditions: FilterCondition[]) => Promise<void>;
    onRequestConfirm: (msg: string, action: () => void) => void;
    allTags: string[];
    allFolders: string[];
}

const sharedInputStyle: React.CSSProperties = { background: 'var(--background-modifier-form-field)', border: 'none', color: 'var(--text-normal)', padding: '8px', borderRadius: '8px', width: '100%', marginBottom: '8px', fontSize: '12px' };

const AutocompleteInput = ({ value, onChange, options, placeholder }: { value: string, onChange: (v:string)=>void, options: string[], placeholder: string }) => {
    const [show, setShow] = React.useState(false);
    const [selectedIndex, setSelectedIndex] = React.useState(-1);

    const parts = value.split(/[,，]/).map(s => s.trim());
    const currentTyping = parts.pop()?.toLowerCase() || '';
    const existing = parts.filter(p => p !== '');

    let filtered = options.filter(o => !existing.includes(o));
    filtered = filterSuggestions(filtered, currentTyping);

    React.useEffect(() => {
        setSelectedIndex(-1);
    }, [currentTyping]);

    const handleSelect = (opt: string) => {
        const newParts = [...parts];
        newParts.push(opt);
        onChange(newParts.join(', '));
        setShow(false);
        setSelectedIndex(-1);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        e.stopPropagation();
        if (!show || filtered.length === 0) return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setSelectedIndex(prev => (prev < filtered.length - 1 ? prev + 1 : 0));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setSelectedIndex(prev => (prev > 0 ? prev - 1 : filtered.length - 1));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (selectedIndex >= 0 && selectedIndex < filtered.length) {
                const selectedOpt = filtered[selectedIndex];
                if (selectedOpt !== undefined) {
                    handleSelect(selectedOpt);
                }
            }
        } else if (e.key === 'Escape') {
            setShow(false);
        }
    };

    return (
        <div style={{ position: 'relative', width: '100%' }}>
            <input
                style={{...sharedInputStyle, marginBottom: 0}}
                placeholder={placeholder}
                value={value}
                onChange={e => { onChange(e.target.value); setShow(true); }}
                onFocus={() => setShow(true)}
                onBlur={() => window.setTimeout(() => setShow(false), 200)}
                onKeyDown={handleKeyDown}
                onKeyUp={e => e.stopPropagation()}
            />
            {show && filtered.length > 0 && (
                <div className="suggestion-list" style={{ position: 'absolute', top: '100%', left: 0, width: '100%', zIndex: 101, maxHeight: '160px', overflowY: 'auto', marginTop: '4px' }}>
                    {filtered.map((opt, index) => (
                        <div
                            key={opt}
                            className={`suggestion-item ${index === selectedIndex ? 'selected' : ''}`}
                            onMouseDown={(e) => {
                                e.preventDefault();
                                handleSelect(opt);
                            }}
                        >
                            {opt}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

const ControlPanel = ({ boards, activeBoardId, onSwitchBoard, onAddBoard, onRenameBoard, onArchiveBoard, onAutoLayout, onSyncRelations, onResetView, currentBoard, onUpdateFilter, onApplyFilters, onRequestConfirm, allTags, allFolders }: ControlPanelProps) => {
    const [showFilters, setShowFilters] = React.useState(false);
    const [isRenaming, setIsRenaming] = React.useState(false);
    const [tempName, setTempName] = React.useState('');

    const [conditions, setConditions] = React.useState<FilterCondition[]>([]);
    const zh = isSimplifiedChinese();
    const updateCondition = (index: number, patch: Partial<FilterCondition>) => setConditions(rows => rows.map((row, i) => i === index ? { ...row, ...patch } : row));
    const [actionStates, setActionStates] = React.useState<Record<string, 'idle' | 'running' | 'done' | 'error'>>({});
    const feedbackTimers = React.useRef<number[]>([]);
    React.useEffect(() => () => feedbackTimers.current.forEach(timer => window.clearTimeout(timer)), []);
    const runAction = async (name: string, action: () => Promise<void>) => {
        if (actionStates[name] === 'running') return;
        setActionStates(states => ({ ...states, [name]: 'running' }));
        try {
            await action();
            setActionStates(states => ({ ...states, [name]: 'done' }));
        } catch (error) {
            console.error(`Task graph ${name} failed:`, error);
            setActionStates(states => ({ ...states, [name]: 'error' }));
        }
        const timer = window.setTimeout(() => {
            setActionStates(states => ({ ...states, [name]: 'idle' }));
            feedbackTimers.current = feedbackTimers.current.filter(item => item !== timer);
        }, 1600);
        feedbackTimers.current.push(timer);
    };
    const actionLabel = (name: string, fallback: string) => actionStates[name] === 'running' ? (zh ? '处理中…' : 'Working…')
        : actionStates[name] === 'done' ? (zh ? '✓ 已完成' : '✓ Done')
        : actionStates[name] === 'error' ? (zh ? '重试' : 'Retry') : fallback;

    React.useEffect(() => {
        setIsRenaming(false);
        setTempName(currentBoard?.name || '');
        if (currentBoard) {
            setConditions(getFilterConditions(currentBoard.filters));
        }
    }, [currentBoard]);

    const handleSaveName = () => { if (tempName.trim()) void onRenameBoard(tempName); setIsRenaming(false); };

    const handleArchive = () => { void onArchiveBoard(activeBoardId); };

    const handleResetClick = () => { onResetView(); };

    const handleApplyFiltersClick = () => { void runAction('filters', () => onApplyFilters(conditions)); };

    const stopPropagation = (e: React.MouseEvent | React.KeyboardEvent) => { e.stopPropagation(); };
    const stopKeys = (e: React.KeyboardEvent) => e.stopPropagation();

    const btnStyle = { background: 'var(--background-secondary)', border: '1px solid var(--background-modifier-border)', color: 'var(--text-normal)', padding: '6px 12px', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s', fontWeight: '500' };
    const activeBtnStyle = { ...btnStyle, background: 'var(--interactive-accent)', color: 'white', border: 'none', boxShadow: '0 2px 8px rgba(var(--interactive-accent-rgb), 0.3)' };

    return (<Panel position="top-right" className={showFilters ? "task-control-panel filters-open" : "task-control-panel"} style={{ position: 'absolute', top: '20px', right: '20px', background: 'var(--background-secondary)', opacity: '0.98', padding: '16px', borderRadius: '20px', border: '1px solid var(--background-modifier-border)', display: 'flex', flexDirection: 'column', gap: '12px', width: '280px', boxShadow: '0 10px 40px rgba(0,0,0,0.2)', cursor: 'default', pointerEvents: 'all', zIndex: 100 }} onMouseDown={stopPropagation} onClick={stopPropagation}><div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>{isRenaming ? (<><input value={tempName} onChange={(e) => setTempName(e.target.value)} onKeyDown={stopKeys} onKeyUp={stopKeys} style={{ ...sharedInputStyle, marginBottom: 0, flex: 1 }} autoFocus /><button style={activeBtnStyle} onClick={handleSaveName}>Save</button></>) : (<><PanelDropdown className="task-board-dropdown" label="Board" value={activeBoardId} onChange={onSwitchBoard} options={boards.map(board => ({ value: board.id, label: board.name }))} /><button style={btnStyle} onClick={() => setIsRenaming(true)} title="Rename">✎</button><button style={btnStyle} onClick={() => void onAddBoard()} title="New">+</button></>)}</div><div className="task-control-actions"><div className="task-control-actions-inner"><div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}><button disabled={actionStates.layout === "running"} style={actionStates.layout === "done" ? activeBtnStyle : btnStyle} onClick={() => void runAction("layout", onAutoLayout)}>{actionLabel("layout", "⚡ Layout")}</button><button disabled={actionStates.sync === "running"} style={actionStates.sync === "done" ? activeBtnStyle : btnStyle} onClick={() => void runAction("sync", onSyncRelations)}>{actionLabel("sync", "🔗 Sync")}</button><button style={showFilters ? activeBtnStyle : btnStyle} onClick={() => setShowFilters(!showFilters)}>Filters</button></div><div style={{ display: 'flex', gap: '8px' }}><button style={{...btnStyle, flex:1, color: '#ff3b30'}} onClick={handleResetClick}>Reset</button><button style={{...btnStyle, flex:1, color: '#ff3b30'}} onClick={handleArchive}>{zh ? '归档' : 'Archive'}</button></div></div></div>{showFilters && currentBoard && (<div style={{ marginTop: '4px', paddingTop: '12px', borderTop: '1px solid var(--background-modifier-border)' }}>

        <div className="task-filter-conditions">
            {conditions.map((condition, index) => (
                <div className="task-filter-row" key={index}>
                    {index === 0 ? <span className="task-filter-first">{zh ? '当' : 'When'}</span> : (
                        <PanelDropdown className="task-filter-logic" label="Condition logic" value={condition.operator}
                            onChange={value => updateCondition(index, { operator: value as 'AND' | 'OR' })}
                            options={[{ value: 'AND', label: zh ? '与' : 'And' }, { value: 'OR', label: zh ? '或' : 'Or' }]} />
                    )}
                    <PanelDropdown className="task-filter-type" label="Filter type" value={condition.field}
                        onChange={value => updateCondition(index, { field: value as 'tag' | 'path', value: '' })}
                        options={[{ value: 'tag', label: zh ? '标签' : 'Tag' }, { value: 'path', label: zh ? '路径' : 'Path' }]} />
                    <div className="task-filter-value">
                        <AutocompleteInput value={condition.value} onChange={value => updateCondition(index, { value })} options={condition.field === 'tag' ? allTags : allFolders} placeholder={condition.field === 'tag' ? '#task-example' : 'Projects/Work'} />
                    </div>
                    <input className="task-filter-enable" aria-label="Enable condition" type="checkbox" checked={condition.enabled} onChange={e => updateCondition(index, { enabled: e.target.checked })} />
                    <button className="task-filter-remove" type="button" aria-label="Remove condition" onClick={() => setConditions(rows => rows.filter((_, i) => i !== index))}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6" /></svg></button>
                </div>
            ))}
        </div>
        <button className="task-add-condition" type="button" style={{ ...btnStyle, width: '100%' }} onClick={() => setConditions(rows => [...rows, { operator: 'AND', field: 'tag', value: '', enabled: true }])}>{zh ? '+ 添加筛选条件' : '+ Add condition'}</button>
        <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '6px' }}>{zh ? '按从上到下的顺序组合条件。' : 'Conditions combine from top to bottom.'}</div>

        <div style={{ display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap' }}>{[' ', '/', 'x'].map(status => (<label key={status} style={{fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', color: 'var(--text-normal)'}}><input type="checkbox" className="filter-checkbox" checked={currentBoard.filters.status.includes(status)} onChange={() => { void onUpdateFilter('status', status); }} /> {status === ' ' ? 'Todo' : status === '/' ? 'Doing' : 'Done'}</label>))}</div>

        <button style={{...btnStyle, width: '100%', marginTop: '14px',
                        background: actionStates.filters === 'done' ? 'var(--interactive-success, #28a745)' : 'var(--interactive-accent)',
                        color: 'white', border: 'none', transition: 'background 0.3s ease'}}
                disabled={actionStates.filters === "running"} onClick={handleApplyFiltersClick}>
            {actionLabel('filters', 'Apply filters')}
        </button>

    </div>)}</Panel>);
};

const HelpPanel = ({ onClose }: { onClose: () => void }) => {
    const [lang, setLang] = React.useState<'en' | 'zh'>(() => isSimplifiedChinese() ? 'zh' : 'en');

    const content = {
        en: {
            title: '📖 User guide',
            sections: [
                { heading: '🎯 Tasks & connections', items: [
                    'Link: Drag from a node\'s handle to another to create a dependency.',
                    'Drag a connection into empty space, then drop on the search icon to connect a task or the plus icon to create one.',
                    'Status: Click the checkbox to toggle completion, or Right-click a task for more status options.',
                    'Delete link: Right-click a connection line to remove it.'
                ]},
                { heading: '📝 Canvas & notes', items: [
                    'Add note: Right-click empty canvas space -> "Add note". Link notes to tasks to act as categories.',
                    'Task details: Use Shift+Enter when editing a task to add multi-line notes underneath it.',
                    'Select & pan: Middle/Right-drag to pan. Left-drag on empty space to box-select. Shift+click to multi-select.'
                ]},
                { heading: '🔍 Boards & filters', items: [
                    'Filter: Use the top-right panel to filter by Tags/Folders. Use Up/Down arrows and Enter to autocomplete.',
                    'Logic: Add tag or path conditions and choose And/Or. Conditions combine from top to bottom.',
                    'Boards: Create multiple boards. Zoom/pan positions are independently saved per board.'
                ]},
                { heading: '📐 Layout & shortcuts', items: [
                    'Auto-layout: Click "⚡ Layout" to automatically organize all nodes.',
                    'Hotkey: Assign a global shortcut for "Auto-layout task graph" in Obsidian\'s hotkey settings for faster arrangement.'
                ]},
            ]
        },
        zh: {
            title: '📖 操作指南',
            sections: [
                { heading: '🎯 任务与连线', items: [
                    '建立依赖：拖拽节点两侧的圆点进行连线。',
                    '拖线到空白处：拖到放大镜连接已有任务，拖到加号创建子任务。',
                    '状态流转：点击复选框切换完成状态；右键点击节点选择更多状态。',
                    '取消连线：右键点击连线即可删除。'
                ]},
                { heading: '📝 画布与批注', items: [
                    '独立批注：右键点击画布空白处选择 "Add note"。',
                    '任务详情：在编辑任务时使用 Shift+Enter 换行，即可为该任务添加折叠注释！',
                    '批量与漫游：中键/右键平移画布。左键拖拽进行框选；按住 Shift 点击进行多选。'
                ]},
                { heading: '🔍 画板与检索', items: [
                    '高效检索：支持键盘上下键与回车快速补全路径和标签。',
                    '逻辑筛选：添加标签或路径条件，选择与/或，按从上到下的顺序组合。',
                    '多画板：系统将为您独立保存每一个画板的专属缩放与坐标位置。'
                ]},
                { heading: '📐 排版与快捷键', items: [
                    '一键排版：点击 "⚡ Layout" 自动梳理节点层级。',
                    '快捷绑定：在 Obsidian 设置 -> 快捷键中搜索 "Auto-layout"，绑定全局热键。'
                ]},
            ]
        }
    };

    const c = content[lang];

    return (
        <div className="task-graph-help-panel" style={{ position: 'absolute', right: 0, bottom: '44px', width: '380px', maxHeight: '60vh', overflowY: 'auto' }}>
            <button className="task-graph-help-close" onClick={onClose}>✕</button>
            <h3 style={{ marginTop: 0, marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                {c.title}
                <span className="task-graph-help-lang-toggle" style={{ marginRight: '28px' }}>
                    <button className={`task-graph-help-lang-btn ${lang === 'en' ? 'active' : ''}`} onClick={() => setLang('en')}>EN</button>
                    <button className={`task-graph-help-lang-btn ${lang === 'zh' ? 'active' : ''}`} onClick={() => setLang('zh')}>中</button>
                </span>
            </h3>
            {c.sections.map((sec, i) => (
                <div key={i} style={{ marginBottom: '12px' }}>
                    <h4 style={{ margin: '0 0 6px 0', color: 'var(--text-normal)', fontSize: '13px' }}>{sec.heading}</h4>
                    <ul style={{ margin: 0, paddingLeft: '20px', color: 'var(--text-muted)', fontSize: '12px' }}>
                        {sec.items.map((item, j) => {
                            const splitIndex = item.indexOf('：') !== -1 ? item.indexOf('：') : item.indexOf(':');
                            if (splitIndex !== -1) {
                                const action = item.substring(0, splitIndex + 1);
                                const desc = item.substring(splitIndex + 1);
                                return <li key={j} style={{ marginBottom: '4px' }}><strong>{action}</strong>{desc}</li>;
                            }
                            return <li key={j} style={{ marginBottom: '4px' }}>{item}</li>;
                        })}
                    </ul>
                </div>
            ))}
        </div>
    );
};

const TaskGraphComponent = ({ plugin, view }: { plugin: TaskGraphPlugin, view: TaskGraphView }) => {
  // 【类型修复】：通过指定 Data 层的泛型，彻底打通 React Flow 与 TypeScript 的类型壁垒
  const [nodes, setNodes, onNodesChange] = useNodesState<AppNodeData>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [activeBoardId, setActiveBoardId] = React.useState(plugin.settings.lastActiveBoardId);
  const [refreshKey, setRefreshKey] = React.useState(0);
  const [isBoardSwitching, setIsBoardSwitching] = React.useState(false);
  const boardSwitchTarget = React.useRef<string | null>(null);
  const boardSwitchTimers = React.useRef<number[]>([]);
  React.useEffect(() => () => boardSwitchTimers.current.forEach(timer => window.clearTimeout(timer)), []);

  const [editTarget, setEditTarget] = React.useState<{id: string, text: string, path: string, line: number, endLine: number, source: 'checklist' | 'tasknotes'} | null>(null);
  const canvasRef = React.useRef<HTMLDivElement>(null);
  const [connectionChoices, setConnectionChoices] = React.useState<{ sourceId: string; x: number; y: number } | null>(null);
  const connectionChoicesRef = React.useRef<typeof connectionChoices>(null);
  const [connectionActionsHidden, setConnectionActionsHidden] = React.useState(false);
  const [connectionActiveAction, setConnectionActiveAction] = React.useState<'search' | 'cancel' | 'create' | null>(null);
  const [searchConnectionSource, setSearchConnectionSource] = React.useState<string | null>(null);
  const [createTarget, setCreateTarget] = React.useState<{ sourceNodeId: string, sourcePath: string } | null>(null);

  const [allTags, setAllTags] = React.useState<string[]>([]);
  const [allFolders, setAllFolders] = React.useState<string[]>([]);

  const [showHelp, setShowHelp] = React.useState(false);
  const [showTaskSearch, setShowTaskSearch] = React.useState(false);
  const [pendingFocusId, setPendingFocusId] = React.useState<string | null>(null);
  React.useEffect(() => {
      const doc = view.containerEl.ownerDocument;
      const ownerWindow = doc.defaultView || window;
      const onSearchShortcut = (event: KeyboardEvent) => {
          const focusedHere = view.containerEl.contains(doc.activeElement)
              || event.composedPath().includes(view.containerEl)
              || !!view.containerEl.closest('.workspace-leaf.mod-active');
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f'
              && (focusedHere || plugin.app.workspace.getActiveViewOfType(TaskGraphView) === view)) {
              event.preventDefault();
              event.stopImmediatePropagation();
              setSearchConnectionSource(null);
              setShowTaskSearch(true);
          }
      };
      ownerWindow.addEventListener('keydown', onSearchShortcut, true);
      return () => ownerWindow.removeEventListener('keydown', onSearchShortcut, true);
  }, [plugin, view]);
  const [confirmReq, setConfirmReq] = React.useState<{ message: string, action: () => void } | null>(null);

  const [isConnecting, setIsConnecting] = React.useState(false);

  const prevBoardIdRef = React.useRef<string | null>(null);

  const reactFlowInstance = useReactFlow();
  const debouncedSaveBoardData = React.useMemo(
      () => Promise.resolve(debounce((boardId: string, data: Partial<GraphBoard['data']>) => {
          void plugin.saveBoardData(boardId, data);
      }, 800, true)),
      [plugin]
  );
  const connectionStartRef = React.useRef<Partial<OnConnectStartParams>>({});
  const connectionMadeRef = React.useRef(false);

  const activeBoard = plugin.settings.boards.find(b => b.id === activeBoardId && !b.archived) || plugin.settings.boards.find(b => !b.archived);
  const groupWorkspace = useGroupWorkspace(plugin, activeBoardId, view, nodes, setNodes, () => setRefreshKey(key => key + 1));

  const handleToggleCollapse = async (id: string) => { await groupWorkspace.collapse(id); };

  React.useEffect(() => {
      const refresh = () => setRefreshKey(prev => prev + 1);
      plugin.viewRefresh = refresh;
      return () => { if (plugin.viewRefresh === refresh) plugin.viewRefresh = undefined; };
  }, [plugin]);

  React.useEffect(() => {
    const loadData = () => {
      // 【类型修复】：利用 unknown 断言强行调用缺失类型声明的方法
      const rawTags = (plugin.app.metadataCache as unknown as { getTags(): Record<string, number> }).getTags();
      setAllTags(Object.keys(rawTags).sort());

      const folderSet = new Set<string>();
      for (const path of plugin.taskCache.keys()) {
          folderSet.add(path);
          const parts = path.split('/');
          parts.pop();
          let currentPath = '';
          for (const part of parts) {
              currentPath = currentPath ? `${currentPath}/${part}` : part;
              folderSet.add(currentPath);
          }
      }
      setAllFolders(Array.from(folderSet).sort());

      const tasks = plugin.getTasks(activeBoardId);
      const boardConfig = plugin.settings.boards.find(b => b.id === activeBoardId);
      const savedLayout = boardConfig?.data.layout || {};
      const savedEdges = boardConfig?.data.edges || [];
      const savedNodeStatus = boardConfig?.data.nodeStatus || {};
      const savedTextNodes = boardConfig?.data.textNodes || [];
      const taskById = new Map(tasks.map(task => [task.id, task]));
      const childrenById: Record<string, string[]> = {};
      for (const edge of savedEdges) {
          if (taskById.has(edge.source) && taskById.has(edge.target)) {
              (childrenById[edge.source] ||= []).push(edge.target);
          }
      }

      const taskNodes: Node<TaskNodeData, 'task'>[] = tasks.map((t, index) => {
        const posX = savedLayout[t.id]?.x ?? ((index % 3) * 320);
        const posY = savedLayout[t.id]?.y ?? (Math.floor(index / 3) * 200);
        let finalCustomStatus = savedNodeStatus[t.id] || 'default';
        if (t.status === 'x') finalCustomStatus = 'finished';

        return {
            id: t.id, type: 'task', position: { x: posX, y: posY },
            data: {
                id: t.id, label: t.text, notes: t.notes, status: t.status, file: t.file, path: t.path, line: t.line, endLine: t.endLine,
                customStatus: t.source === 'tasknotes' ? t.statusCategory : finalCustomStatus,
                source: t.source, rawStatus: t.rawStatus,
                hasChildren: (childrenById[t.id] || []).length > 0,
                isCollapsed: false,
                onToggleCollapse: handleToggleCollapse,
                onSaveNotes: handleSaveTaskNotes,
                onEdit: handleEditTask, onToggleStatus: handleToggleTask,
                onOpenFile: () => { void openTaskLocation(plugin.app, t); }
            }
        };
      });

      const textNodes: Node<TextNodeData, 'text'>[] = savedTextNodes.map(tn => ({
          id: tn.id, type: 'text', position: { x: tn.x, y: tn.y },
          data: { id: tn.id, label: tn.text, onSave: handleSaveTextNode }
      }));

      // 泛型合并后自动转推为 Node<AppNodeData>[]，消灭强制断言
      const scene = groupWorkspace.scene([...taskNodes, ...textNodes], savedEdges, id => {
          const task = [...plugin.taskCache.values()].flat().find(item => item.id === id);
          if (task) void handleToggleTask(task.id, task.status, task.path, task.line, task.source);
      });
      setNodes(scene.nodes);
      setEdges(scene.edges);

      if (prevBoardIdRef.current !== activeBoardId) {
          const savedViewport = boardConfig?.data.viewport;
          if (savedViewport) {
              window.setTimeout(() => reactFlowInstance.setViewport(savedViewport), 100);
          } else {
              window.setTimeout(() => reactFlowInstance.fitView({ duration: 800, padding: 0.1 }), 100);
          }
          prevBoardIdRef.current = activeBoardId;
      }
    };
    loadData();
    if (boardSwitchTarget.current === activeBoardId) {
        const timer = window.setTimeout(() => {
            if (boardSwitchTarget.current !== activeBoardId) return;
            setIsBoardSwitching(false);
            boardSwitchTarget.current = null;
        }, 180);
        boardSwitchTimers.current.push(timer);
    }
  }, [plugin, activeBoardId, refreshKey, reactFlowInstance, groupWorkspace.scope]);

  const placeConnectionChoices = React.useCallback((sourceId: string, clientX: number, clientY: number) => {
      const bounds = canvasRef.current?.getBoundingClientRect();
      if (!bounds) return;
      const choices = { sourceId,
          x: Math.max(8, Math.min(bounds.width - 52, clientX - bounds.left + 56)),
          y: Math.max(8, Math.min(bounds.height - 104, clientY - bounds.top - 50)) };
      connectionChoicesRef.current = choices;
      setConnectionChoices(choices);
  }, []);

  const chooseConnectionAction = React.useCallback((action: 'search' | 'cancel' | 'create') => {
      const sourceId = connectionChoicesRef.current?.sourceId;
      if (action === 'cancel') {
          connectionChoicesRef.current = null;
          setConnectionChoices(null);
          setConnectionActiveAction(null);
          return;
      }
      const source = nodes.find(node => node.id === sourceId);
      if (!source) return;
      connectionChoicesRef.current = null;
      setConnectionChoices(null);
      if (action === 'search') {
          setSearchConnectionSource(source.id);
          setShowTaskSearch(true);
      } else {
          const path = groupWorkspace.sourcePath(source.id);
          if (path) setCreateTarget({ sourceNodeId: source.id, sourcePath: path });
      }
  }, [nodes]);

  React.useEffect(() => {
      if (!isConnecting || connectionStartRef.current.handleType !== 'source') return;
      const sourceId = connectionStartRef.current.nodeId;
      if (!sourceId || !nodes.some(node => node.id === sourceId && (isTaskNode(node) || node.type === 'groupFrame'))) return;
      const doc = view.containerEl.ownerDocument;
      const trackPointer = (event: MouseEvent | TouchEvent) => {
          const point = 'touches' in event ? event.touches[0] : event;
          if (!point) return;
          const target = doc.elementFromPoint(point.clientX, point.clientY);
          if (target?.closest('.react-flow__node')) {
              setConnectionActionsHidden(true);
              setConnectionActiveAction(null);
              return;
          }
          const bounds = canvasRef.current?.getBoundingClientRect();
          if (!bounds || !canvasRef.current?.contains(target)) { setConnectionActiveAction(null); return; }
          setConnectionActionsHidden(false);
          if (!connectionChoicesRef.current) placeConnectionChoices(sourceId, point.clientX, point.clientY);
          const choices = connectionChoicesRef.current;
          if (choices) {
              const relativeY = point.clientY - bounds.top - choices.y;
              setConnectionActiveAction(relativeY < 52 ? 'search' : relativeY < 104 ? 'cancel' : 'create');
          }
      };
      doc.addEventListener('mousemove', trackPointer);
      doc.addEventListener('touchmove', trackPointer);
      return () => {
          doc.removeEventListener('mousemove', trackPointer);
          doc.removeEventListener('touchmove', trackPointer);
      };
  }, [isConnecting, nodes, view, placeConnectionChoices]);

  React.useEffect(() => {
      if (!connectionChoices) return;
      const doc = view.containerEl.ownerDocument;
      const dismiss = (event: KeyboardEvent) => {
          if (event.key === 'Escape') { connectionChoicesRef.current = null; setConnectionChoices(null); }
      };
      const outside = (event: PointerEvent) => {
          if (!isConnecting && !(event.target as Element).closest('.connection-actions')) {
              connectionChoicesRef.current = null; setConnectionChoices(null);
          }
      };
      doc.addEventListener('keydown', dismiss);
      doc.addEventListener('pointerdown', outside);
      return () => { doc.removeEventListener('keydown', dismiss); doc.removeEventListener('pointerdown', outside); };
  }, [connectionChoices, isConnecting, view]);

  const onConnectStart = React.useCallback((event: React.MouseEvent | React.TouchEvent, params: OnConnectStartParams) => {
      connectionChoicesRef.current = null;
      setConnectionChoices(null);
      setConnectionActiveAction(null);
      connectionStartRef.current = params;
      setConnectionActionsHidden(false);
      connectionMadeRef.current = false;
      setIsConnecting(true);
  }, []);

  const onConnectEnd = React.useCallback((event: MouseEvent | TouchEvent) => {
      setIsConnecting(false);
      if (connectionMadeRef.current) { connectionChoicesRef.current = null; setConnectionChoices(null); return; }
      const point = 'changedTouches' in event ? event.changedTouches[0] : event;
      if (!point || connectionStartRef.current.handleType !== 'source') return;
      const target = view.containerEl.ownerDocument.elementFromPoint(point.clientX, point.clientY);
      const action = target?.closest('[data-connection-action]')?.getAttribute('data-connection-action');
      if (action === 'cancel') {
          connectionChoicesRef.current = null;
          setConnectionChoices(null);
          setConnectionActiveAction(null);
          return;
      }
      if (action === 'search' || action === 'create') { chooseConnectionAction(action); return; }
      const choices = connectionChoicesRef.current;
      const bounds = canvasRef.current?.getBoundingClientRect();
      if (choices && bounds && canvasRef.current?.contains(target) && !target?.closest('.react-flow__node')) {
          const relativeY = point.clientY - bounds.top - choices.y;
          if (relativeY >= 52 && relativeY < 104) {
              connectionChoicesRef.current = null;
              setConnectionChoices(null);
              setConnectionActiveAction(null);
          } else {
              chooseConnectionAction(relativeY < 52 ? 'search' : 'create');
          }
          return;
      }
      const sourceId = connectionStartRef.current.nodeId;
      if (target?.classList.contains('react-flow__pane') && sourceId && nodes.some(node => node.id === sourceId && (isTaskNode(node) || node.type === 'groupFrame'))) {
          if (!connectionChoicesRef.current) placeConnectionChoices(sourceId, point.clientX, point.clientY);
      } else { connectionChoicesRef.current = null; setConnectionChoices(null); }
  }, [nodes, view, chooseConnectionAction, placeConnectionChoices]);

  const handleToggleTask = async (id: string, currentStatus: string, path: string, line: number, source: 'checklist' | 'tasknotes') => {
      const newStatus = (currentStatus === ' ' || currentStatus === '/') ? 'x' : ' ';
      const newCustomStatus = newStatus === 'x' ? 'finished' : 'backlog';

      setNodes(nds => nds.map(n => {
          if (n.id === id && isTaskNode(n)) {
              const updatedData: TaskNodeData = { ...n.data, status: newStatus, customStatus: newCustomStatus };
              return { ...n, data: updatedData };
          }
          return n;
      }));

      const board = plugin.settings.boards.find(b => b.id === activeBoardId);
      if (board) {
          const nodeStatus = board.data.nodeStatus || {};
          nodeStatus[id] = newCustomStatus;
          await plugin.saveBoardData(activeBoardId, { nodeStatus });
      }

      if (source === 'tasknotes') {
          await plugin.updateTaskNotesStatus(path, newStatus === 'x' ? 'finished' : 'backlog');
          return;
      }

      const file = plugin.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) {
           const content = await plugin.app.vault.read(file);
           const lines = content.split('\n');
           let currentLineText = lines[line];
           if (currentLineText === undefined) return;

           const lineRegex = /^(\s*- \[[x\s/bc!-]\]\s)(.*?)(?:\s+(\^[a-zA-Z0-9-]+))?$/;
           const match = currentLineText.match(lineRegex);

           if (match) {
               let prefix = match[1] || '- [ ] ';
               let textContent = match[2] || '';
               const blockId = match[3] ? ` ${match[3]}` : '';

               prefix = prefix.replace(/\[.\]/, `[${newStatus}]`);

               const completionRegex = /\s*✅\s*\d{4}-\d{2}-\d{2}/g;
               if (newStatus === 'x') {
                   if (!completionRegex.test(textContent)) {
                       const today = new Date();
                       const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
                       textContent += ` ✅ ${dateStr}`;
                   }
               } else {
                   textContent = textContent.replace(completionRegex, '');
               }

               lines[line] = `${prefix}${textContent}${blockId}`;
           } else {
               console.warn("TaskGraph: Failed to parse line format:", currentLineText);
           }

           await plugin.app.vault.modify(file, lines.join('\n'));
      }
  };

  const updateNodeStatus = async (nodeId: string, status: string) => {
      const board = plugin.settings.boards.find(b => b.id === activeBoardId);
      const group = board?.data.groups?.find(item => item.id === nodeId);
      if (group) {
          const colors: Record<string, string> = { backlog: '#8e8e93', pending: '#ff9500', in_progress: '#34c759', blocked: '#ff3b30', finished: '#af52de' };
          await plugin.saveBoardData(activeBoardId, { groups: (board?.data.groups || []).map(item => item.id === nodeId
              ? { ...item, status: status as 'backlog' | 'pending' | 'in_progress' | 'blocked' | 'finished', color: colors[status] || colors.backlog } : item) });
          setRefreshKey(key => key + 1);
          return;
      }
      setNodes((nds) => nds.map((n) => {
          if (n.id === nodeId && isTaskNode(n)) {
              const updatedData: TaskNodeData = { ...n.data, customStatus: status };
              return { ...n, data: updatedData };
          }
          return n;
      }));
      const taskBoard = plugin.settings.boards.find(b => b.id === activeBoardId);
      if (taskBoard) {
          const nodeStatus = taskBoard.data.nodeStatus || {};
          nodeStatus[nodeId] = status;
          await plugin.saveBoardData(activeBoardId, { nodeStatus });
      }
      const node = nodes.find(item => item.id === nodeId);
      if (node && isTaskNode(node) && node.data.source === 'tasknotes') {
          const category = status === 'finished' ? 'finished' : status === 'in_progress' ? 'in_progress' : 'backlog';
          await plugin.updateTaskNotesStatus(node.data.path, category);
      }
  };

  const onMoveEnd = React.useCallback((event: MouseEvent | TouchEvent | null, viewport: Viewport) => {
      if (groupWorkspace.scope) return;
      const board = plugin.settings.boards.find(b => b.id === activeBoardId);
      if (board) {
          board.data.viewport = viewport;
          void debouncedSaveBoardData.then(save => save(activeBoardId, { viewport }));
      }
  }, [plugin, activeBoardId, debouncedSaveBoardData, groupWorkspace.scope]);

  const handleCreateTask = async (text: string) => {
      if (!createTarget) return;
      const newId = await plugin.appendTaskToFile(createTarget.sourcePath, text);
      if (newId) {
          const parentNode = nodes.find(n => n.id === createTarget.sourceNodeId);
          let newX = 0, newY = 0; if (parentNode) { newX = parentNode.position.x + (parentNode.type === 'groupFrame' ? (parentNode.width || 300) + 80 : 400); newY = parentNode.position.y; }
          const board = plugin.settings.boards.find(b => b.id === activeBoardId);
          if (board) {
              board.data.layout = { ...board.data.layout, [newId]: { x: newX, y: newY } };
              if (groupWorkspace.scope) board.data.groups = (board.data.groups || []).map(group => group.id === groupWorkspace.scope ? { ...group, members: [...group.members, newId] } : group);
              await plugin.saveSettings();
          }
          await connectGraphObjects(plugin, activeBoardId, createTarget.sourceNodeId, newId, nodes);
          setCreateTarget(null); setRefreshKey(prev => prev + 1);
      }
  };

  const onConnect = React.useCallback((params: Connection) => {
      connectionMadeRef.current = true;
      if (!params.source || !params.target) return;
      void connectGraphObjects(plugin, activeBoardId, params.source, params.target, nodes)
          .then(() => setRefreshKey(key => key + 1))
          .catch(() => new Notice('Could not create connection. Try again.'));
  }, [plugin, activeBoardId, nodes]);

  const onNodeDragStop = React.useCallback((event: React.MouseEvent, node: Node) => {
      groupWorkspace.selectionEnd(event);
      if (node.type === 'groupFrame') { void groupWorkspace.dragStop(node); return; }
      const board = plugin.settings.boards.find(b => b.id === activeBoardId);
      if(!board) return;

      void debouncedSaveBoardData.then(save => {
          if (node.type === 'task') {
              const layout = { ...board.data.layout, [node.id]: node.position };
              save(activeBoardId, { layout });
              setRefreshKey(key => key + 1);
          } else if (node.type === 'text') {
              const textNodes = board.data.textNodes.map(tn => tn.id === node.id ? { ...tn, x: node.position.x, y: node.position.y } : tn);
              save(activeBoardId, { textNodes });
          }
      });
  }, [plugin, activeBoardId, debouncedSaveBoardData]);

  const handleSaveTextNode = async (id: string, text: string) => { const board = plugin.settings.boards.find(b => b.id === activeBoardId); if(board) { const textNodes = board.data.textNodes.map(tn => tn.id === id ? { ...tn, text } : tn); await plugin.saveBoardData(activeBoardId, { textNodes }); } };

  const handleSaveTaskNotes = async (taskData: TaskNodeData, notes: string) => {
      const content = `${taskData.label}${notes.trim() ? `\n${notes}` : ''}`;
      if (taskData.source === 'tasknotes') {
          await plugin.updateTaskNotesContent(taskData.path, content);
      } else {
          await plugin.updateTaskContent(taskData.path, taskData.line, taskData.endLine, content);
      }
      setRefreshKey(prev => prev + 1);
  };

  const handleEditTask = (taskData: TaskNodeData) => {
      const initialText = taskData.label + (taskData.notes ? '\n' + taskData.notes : '');
      setEditTarget({ id: taskData.id, text: initialText, path: taskData.path, line: taskData.line, endLine: taskData.endLine, source: taskData.source });
  };
  const saveTaskEdit = async (text: string) => {
      if (!editTarget) return;
      if (editTarget.source === 'tasknotes') await plugin.updateTaskNotesContent(editTarget.path, text);
      else await plugin.updateTaskContent(editTarget.path, editTarget.line, editTarget.endLine, text);
      setEditTarget(null);
  };

  const onPaneContextMenu = React.useCallback((event: React.MouseEvent) => {
      event.preventDefault(); const menu = new Menu();
      menu.addItem((item) => item.setTitle('Add note').setIcon('sticky-note').onClick(() => {
          void (async () => {
              const bounds = (event.target as HTMLElement).getBoundingClientRect(); const position = reactFlowInstance.project({ x: event.clientX - bounds.left, y: event.clientY - bounds.top });
              const newNode = { id: `text-${Date.now()}`, text: 'New note', x: position.x, y: position.y };
              const board = plugin.settings.boards.find(b => b.id === activeBoardId); if (board) { const textNodes = [...(board.data.textNodes || []), newNode]; await plugin.saveBoardData(activeBoardId, { textNodes }); setRefreshKey(prev => prev + 1); }
          })();
      }));
      menu.showAtPosition({ x: event.nativeEvent.clientX, y: event.nativeEvent.clientY });
  }, [plugin, activeBoardId, reactFlowInstance]);

  const onEdgeContextMenu = React.useCallback((event: React.MouseEvent, edge: Edge) => {
      event.preventDefault(); event.stopPropagation();
      const saved = plugin.settings.boards.find(board => board.id === activeBoardId)?.data.edges || [];
      void plugin.saveBoardData(activeBoardId, { edges: saved.filter(item => item.id !== edge.id) }).then(() => setRefreshKey(key => key + 1));
      new Notice("Connection removed.");
  }, [plugin, activeBoardId, setEdges]);

  const onNodeContextMenu = React.useCallback((event: React.MouseEvent, node: Node) => {
      event.preventDefault(); event.stopPropagation(); const menu = new Menu();
      if (node.type === 'groupFrame') {
          const group = plugin.settings.boards.find(board => board.id === activeBoardId)?.data.groups?.find(item => item.id === node.id);
          if (group) {
              const groupStatuses = [
                  ['backlog', 'Backlog', '#8e8e93'], ['pending', 'Pending', '#ff9500'],
                  ['in_progress', 'In progress', '#34c759'], ['blocked', 'Blocked', '#ff3b30'], ['finished', 'Finished', '#af52de']
              ] as const;
              for (const [status, label, color] of groupStatuses) {
                  menu.addItem(item => {
                      const title = new DocumentFragment();
                      const row = title.createEl('span', { cls: 'task-status-menu-label' });
                      const marker = row.createEl('span', { cls: 'task-status-menu-marker' });
                      marker.setCssProps({ '--task-status-color': color });
                      marker.setAttribute('aria-hidden', 'true');
                      row.appendText(`Group · ${label}`);
                      title.append(row);
                      item.setTitle(title).onClick(() => {
                      void plugin.saveBoardData(activeBoardId, { groups: (plugin.settings.boards.find(board => board.id === activeBoardId)?.data.groups || [])
                          .map(item => item.id === group.id ? { ...item, status, color } : item) }).then(() => setRefreshKey(key => key + 1));
                      });
                  });
              }
              menu.addItem(item => item.setTitle('Group: reset color').onClick(() => {
                  void plugin.saveBoardData(activeBoardId, { groups: (plugin.settings.boards.find(board => board.id === activeBoardId)?.data.groups || [])
                      .map(item => item.id === group.id ? { ...item, color: undefined } : item) }).then(() => setRefreshKey(key => key + 1));
              }));
          }
          menu.showAtPosition({ x: event.nativeEvent.clientX, y: event.nativeEvent.clientY });
          return;
      }
      const parentTask = node.type === 'groupFrame' ? (node.data as GroupNodeData).task : undefined;
      if (node.type === 'task' || parentTask) {
          const taskId = parentTask?.id || node.id;
          const statuses = [
              ['backlog', 'Backlog'], ['pending', 'Pending'], ['in_progress', 'In progress'],
              ['blocked', 'Blocked'], ['finished', 'Finished']
          ] as const;
          for (const [status, label] of statuses) {
              const title = new DocumentFragment();
              const row = title.createEl('span', { cls: 'task-status-menu-label' });
              const marker = row.createEl('span', { cls: 'task-status-menu-marker' });
              marker.setCssProps({ '--task-status-color': STATUS_COLORS[status] });
              marker.setAttribute('aria-hidden', 'true');
              row.append(marker);
              row.appendText(label);
              title.append(row);
              menu.addItem(item => item.setTitle(title).onClick(() => { void updateNodeStatus(taskId, status); }));
          }
      } else if (node.type === 'text') {
          menu.addItem((item) => item.setTitle('Delete note').onClick(() => {
              void (async () => {
                  const board = plugin.settings.boards.find(b => b.id === activeBoardId);
                  if (board) {
                      const textNodes = board.data.textNodes.filter(tn => tn.id !== node.id);
                      await plugin.saveBoardData(activeBoardId, { textNodes });
                      setRefreshKey(prev => prev + 1);
                  }
              })();
          }));
      }
      menu.showAtPosition({ x: event.nativeEvent.clientX, y: event.nativeEvent.clientY });
  }, [plugin, activeBoardId, nodes]);

  const handleSwitchBoard = (id: string) => {
      if (id === activeBoardId && !isBoardSwitching) return;
      boardSwitchTimers.current.forEach(timer => window.clearTimeout(timer));
      boardSwitchTimers.current = [];
      boardSwitchTarget.current = id;
      setIsBoardSwitching(true);
      setShowTaskSearch(false);
      setSearchConnectionSource(null);
      setConnectionChoices(null);
      connectionChoicesRef.current = null;
      setPendingFocusId(null);
      const timer = window.setTimeout(() => {
          setActiveBoardId(id);
          plugin.settings.lastActiveBoardId = id;
          void plugin.saveSettings();
      }, 140);
      boardSwitchTimers.current.push(timer);
  };

  const handleAddBoard = () => { const newBoard: GraphBoard = { id: Date.now().toString(), name: `Board ${plugin.settings.boards.length + 1}`, filters: { tags: [], excludeTags: [], folders: [], status: [' ', '/'], tagMode: 'OR' }, data: { layout: {}, edges: [], nodeStatus: {}, textNodes: [], taskPaths: [...plugin.taskCache.keys()] } }; plugin.settings.boards.push(newBoard); handleSwitchBoard(newBoard.id); };

  const handleArchiveBoard = async (id: string) => {
      const nextId = await plugin.archiveBoard(id);
      handleSwitchBoard(nextId);
  };

  const handleRenameBoard = async (newName: string) => { await plugin.updateBoardConfig(activeBoardId, { name: newName }); setRefreshKey(prev => prev + 1); };
  const handleUpdateFilter = async (type: string, value: string) => { const board = plugin.settings.boards.find(b => b.id === activeBoardId); if (!board) return; if (type === 'tags' || type === 'excludeTags' || type === 'folders') board.filters[type] = value.split(',').map(s => s.trim()).filter(s => s); else if (type === 'status') { const statusChar = value; const index = board.filters.status.indexOf(statusChar); if (index > -1) board.filters.status.splice(index, 1); else board.filters.status.push(statusChar); } await plugin.saveSettings(); setRefreshKey(prev => prev + 1); };

  const handleApplyFilters = async (conditions: FilterCondition[]) => {
      const board = plugin.settings.boards.find(b => b.id === activeBoardId);
      if (!board) return;
      board.filters.conditions = conditions.map(condition => ({ ...condition }));
      await plugin.saveSettings();
      setRefreshKey(prev => prev + 1);
  };

  const handleSyncRelations = async (notify = false) => {
      const board = plugin.settings.boards.find(b => b.id === activeBoardId);
      if (!board) return;
      const { edges: nextEdges, added, removed } = synchronizeHierarchy(plugin.getTasks(activeBoardId), board.data.edges || edges);
      if (added === 0 && removed === 0) {
          if (notify) new Notice('Document relations are already synchronized.');
          return;
      }
      setEdges(nextEdges);
      await plugin.saveBoardData(activeBoardId, { edges: nextEdges });
      setRefreshKey(prev => prev + 1);
      if (notify) new Notice(`Synced document relations: ${added} added, ${removed} removed.`);
  };

  const handleAutoLayout = async () => {
      if (plugin.settings.autoSyncHierarchy) await handleSyncRelations(false);
      const parents = groupParents(activeBoard?.data.groups || []);
      const layoutNodes = nodes.filter(node => !node.hidden && parents.get(node.id) === (groupWorkspace.scope || undefined));
      const allowed = new Set(layoutNodes.map(node => node.id));
      const effectiveEdges = projectLayoutEdges(activeBoard?.data.groups || [], activeBoard?.data.edges || edges, groupWorkspace.scope)
          .filter(edge => allowed.has(edge.source) && allowed.has(edge.target));
      const undirectedAdj: Record<string, string[]> = {};
      const directedAdj: Record<string, string[]> = {};
      const inDegree: Record<string, number> = {};

      layoutNodes.forEach(n => { undirectedAdj[n.id] = []; directedAdj[n.id] = []; inDegree[n.id] = 0; });
      effectiveEdges.forEach((e: Edge) => {
          const sourceDir = directedAdj[e.source]; const sourceUndir = undirectedAdj[e.source]; const targetUndir = undirectedAdj[e.target];
          if (sourceDir) sourceDir.push(e.target);
          inDegree[e.target] = (inDegree[e.target] ?? 0) + 1;
          if (sourceUndir) sourceUndir.push(e.target);
          if (targetUndir) targetUndir.push(e.source);
      });

      const connectedNodeIds = new Set<string>();
      const isolatedActiveIds: string[] = [];
      const isolatedFinishedIds: string[] = [];

      layoutNodes.forEach(n => {
          const isFinishedTask = isTaskNode(n) && (n.data.status === 'x' || n.data.customStatus === 'finished');
          const isConnected = (undirectedAdj[n.id]?.length ?? 0) > 0;
          if (isConnected) connectedNodeIds.add(n.id);
          else if (isFinishedTask) isolatedFinishedIds.push(n.id);
          else isolatedActiveIds.push(n.id);
      });

      const components: string[][] = [];
      const visited = new Set<string>();

      connectedNodeIds.forEach(id => {
          if (!visited.has(id)) {
              const comp: string[] = []; const queue = [id]; visited.add(id);
              for (let cursor = 0; cursor < queue.length; cursor++) {
                  const curr = queue[cursor]!; comp.push(curr);
                  undirectedAdj[curr]?.forEach(neighbor => { if (!visited.has(neighbor)) { visited.add(neighbor); queue.push(neighbor); } });
              }
              components.push(comp);
          }
      });

      const layout: Record<string, { x: number; y: number }> = {};
      const COL_WIDTH = 320; const COMPONENT_GAP = 60; const MIN_GAP = 30; const DEFAULT_NODE_HEIGHT = 100;
      const nodeHeightMap: Record<string, number> = {};
      // React Flow already measures nodes; avoid querying and measuring every DOM card.
      layoutNodes.forEach(n => { nodeHeightMap[n.id] = n.height || DEFAULT_NODE_HEIGHT; });

      const nodeMap = new Map(layoutNodes.map(n => [n.id, n]));
      const getUserOrderRank = (ids: string[]): string[] => { return [...ids].sort((a, b) => { const yA = nodeMap.get(a)?.position?.y ?? 0; const yB = nodeMap.get(b)?.position?.y ?? 0; return yA - yB; }); };
      const componentResults: { comp: string[]; height: number; originalY: number }[] = [];

      const componentByNode = new Map<string, number>();
      components.forEach((comp, index) => comp.forEach(id => componentByNode.set(id, index)));
      const edgesByComponent: Edge[][] = components.map(() => []);
      effectiveEdges.forEach(edge => {
          const index = componentByNode.get(edge.source);
          if (index !== undefined && componentByNode.get(edge.target) === index) edgesByComponent[index]!.push(edge);
      });
      components.forEach((comp, componentIndex) => {
          const compIds = new Set(comp);
          const compEdges = edgesByComponent[componentIndex] || [];
          const level: Record<string, number> = {};
          comp.forEach(id => { level[id] = 0; });
          let changed = true; let iter = 0;
          while (changed && iter < 200) {
              changed = false; iter++;
              compEdges.forEach((e: Edge) => { if (level[e.source] !== undefined && level[e.target] !== undefined) { if (level[e.target]! <= level[e.source]!) { level[e.target] = level[e.source]! + 1; changed = true; } } });
          }

          const levelGroups: Record<number, string[]> = {};
          let maxLevel = 0;
          comp.forEach(id => { const lvl = level[id] ?? 0; maxLevel = Math.max(maxLevel, lvl); if (!levelGroups[lvl]) levelGroups[lvl] = []; levelGroups[lvl].push(id); });
          for (const lvl of Object.keys(levelGroups)) levelGroups[Number(lvl)] = getUserOrderRank(levelGroups[Number(lvl)]!);

          const posY: Record<string, number> = {};
          const assignedNodes = new Set<string>();
          const compChildren = (id: string): string[] => { return (directedAdj[id] || []).filter(cid => compIds.has(cid)); };
          const subtreeHeight: Record<string, number> = {};

          const computeSubtreeHeight = (id: string, visitedCalc: Set<string>): number => {
              if (subtreeHeight[id] !== undefined) return subtreeHeight[id];
              if (visitedCalc.has(id)) { subtreeHeight[id] = (nodeHeightMap[id] ?? DEFAULT_NODE_HEIGHT) + MIN_GAP; return subtreeHeight[id]; }
              visitedCalc.add(id);
              const children = compChildren(id); const nodeH = nodeHeightMap[id] ?? DEFAULT_NODE_HEIGHT;
              if (children.length === 0) { subtreeHeight[id] = nodeH + MIN_GAP; return subtreeHeight[id]; }
              let childrenTotalH = 0;
              const sortedChildren = getUserOrderRank(children);
              sortedChildren.forEach(cid => { childrenTotalH += computeSubtreeHeight(cid, visitedCalc); });
              subtreeHeight[id] = Math.max(nodeH + MIN_GAP, childrenTotalH);
              return subtreeHeight[id];
          };

          const visitedCalc = new Set<string>();
          comp.forEach(id => computeSubtreeHeight(id, visitedCalc));

          const assignPositions = (id: string, startY: number): number => {
              if (assignedNodes.has(id)) return 0;
              assignedNodes.add(id);
              const children = compChildren(id); const unassigned = children.filter(cid => !assignedNodes.has(cid)); const nodeH = nodeHeightMap[id] ?? DEFAULT_NODE_HEIGHT;
              if (children.length === 0 || unassigned.length === 0) { posY[id] = startY; return nodeH + MIN_GAP; }
              const sortedChildren = getUserOrderRank(unassigned);
              let currentY = startY; let totalUsed = 0;
              sortedChildren.forEach(childId => { const used = assignPositions(childId, currentY); currentY += used; totalUsed += used; });
              const allChildYs = children.map(cid => posY[cid]).filter((y): y is number => y !== undefined);
              if (allChildYs.length > 0) {
                  const firstY = Math.min(...allChildYs);
                  const lastChildId = children.reduce((acc, cid) => { const y = posY[cid]; const accY = posY[acc]; if (y === undefined) return acc; if (accY === undefined) return cid; return y > accY ? cid : acc; }, children[0]!);
                  const lastY = posY[lastChildId] ?? startY; const lastH = nodeHeightMap[lastChildId] ?? DEFAULT_NODE_HEIGHT;
                  const childRangeCenter = (firstY + lastY + lastH) / 2; posY[id] = childRangeCenter - nodeH / 2;
              } else posY[id] = startY;
              return Math.max(totalUsed, nodeH + MIN_GAP);
          };

          const compInDegree: Record<string, number> = {};
          comp.forEach(id => { compInDegree[id] = 0; });
          compEdges.forEach((e: Edge) => { if (compInDegree[e.target] !== undefined && compIds.has(e.source)) compInDegree[e.target] = (compInDegree[e.target] ?? 0) + 1; });
          const roots = comp.filter(id => (compInDegree[id] ?? 0) === 0);
          const sortedRoots = getUserOrderRank(roots);

          let globalStartY = 0;
          sortedRoots.forEach(rootId => { const used = assignPositions(rootId, globalStartY); globalStartY += used; });
          comp.forEach(id => { if (posY[id] === undefined) { posY[id] = globalStartY; globalStartY += (nodeHeightMap[id] ?? DEFAULT_NODE_HEIGHT) + MIN_GAP; } });

          for (let lvl = 0; lvl <= maxLevel; lvl++) {
              const group = levelGroups[lvl] || []; const sorted = [...group].sort((a, b) => (posY[a] ?? 0) - (posY[b] ?? 0));
              for (let i = 1; i < sorted.length; i++) {
                  const prevId = sorted[i - 1]!; const currId = sorted[i]!; const prevBottom = (posY[prevId] ?? 0) + (nodeHeightMap[prevId] ?? DEFAULT_NODE_HEIGHT) + MIN_GAP; const currTop = posY[currId] ?? 0;
                  if (currTop < prevBottom) posY[currId] = prevBottom;
              }
          }

          const columnX: number[] = [0];
          for (let lvl = 1; lvl <= maxLevel; lvl++) {
              const widths = (levelGroups[lvl - 1] || []).map(id => nodeMap.get(id)?.width || 240);
              columnX[lvl] = columnX[lvl - 1]! + Math.max(COL_WIDTH, ...widths.map(width => width + 80));
          }
          const compLayout: Record<string, { x: number; y: number }> = {};
          comp.forEach(id => { compLayout[id] = { x: columnX[level[id] ?? 0] || 0, y: posY[id] ?? 0 }; });
          const allYs = Object.values(compLayout).map(p => p.y);
          const minY = Math.min(...allYs);
          Object.values(compLayout).forEach(p => { p.y -= minY; });

          let compMaxBottom = 0;
          comp.forEach(id => { const y = compLayout[id]?.y ?? 0; const h = nodeHeightMap[id] ?? DEFAULT_NODE_HEIGHT; compMaxBottom = Math.max(compMaxBottom, y + h); });
          comp.forEach(id => { layout[id] = { ...compLayout[id]! }; });
          const originalY = Math.min(...comp.map(id => nodeMap.get(id)?.position.y ?? 0));
          componentResults.push({ comp, height: compMaxBottom, originalY });
      });

      // Keep the existing vertical order of independent trees. The previous size-based
      // sort restarted every component at y=0, which made adding a group move trees
      // above or below one another even when their relationships had not changed.
      componentResults.sort((a, b) => a.originalY - b.originalY);
      let globalY = 0;
      componentResults.forEach(cr => {
          const top = Math.max(cr.originalY, globalY);
          const offset = top;
          cr.comp.forEach(id => { if (layout[id]) layout[id].y += offset; });
          globalY = top + cr.height + COMPONENT_GAP;
      });

      if (isolatedActiveIds.length > 0) {
          // A complete task tree represented by a group is an isolated layout
          // object. Keep its existing position so creating a group does not
          // move the whole tree below the other components.
          const sorted = getUserOrderRank(isolatedActiveIds);
          sorted.forEach((id, idx) => {
              const node = nodeMap.get(id);
              layout[id] = node?.position ? { ...node.position } : { x: (idx % 3) * COL_WIDTH, y: globalY + Math.floor(idx / 3) * 140 };
          });
          globalY = Math.max(globalY, ...sorted.map(id => (layout[id]?.y || 0) + (nodeHeightMap[id] || DEFAULT_NODE_HEIGHT) + COMPONENT_GAP));
      }

      if (isolatedFinishedIds.length > 0) {
          const sorted = getUserOrderRank(isolatedFinishedIds);
          sorted.forEach((id, idx) => {
              const node = nodeMap.get(id);
              layout[id] = node?.position ? { ...node.position } : { x: (idx % 4) * COL_WIDTH, y: globalY + Math.floor(idx / 4) * 100 };
          });
      }

      const translated = groupWorkspace.moveGroups(groupWorkspace.scope ? anchorGroupLayout(layout, layoutNodes) : layout);
      setNodes(nds => nds.map(n => ({ ...n, position: translated[n.id] ?? n.position })));

      const board = plugin.settings.boards.find(b => b.id === activeBoardId);
      if (board) {
          const mergedLayout = { ...board.data.layout }; const updatedTextNodes = board.data.textNodes.map(tn => ({ ...tn }));
          const taskPaths = [...new Set([...(board.data.taskPaths || []), ...layoutNodes.filter(isTaskNode).map(node => node.data.path).filter(Boolean)])];
          const textNodeIndex = new Map(updatedTextNodes.map((node, index) => [node.id, index]));
          Object.keys(translated).forEach(nodeId => {
              const node = nodes.find(item => item.id === nodeId); const newPos = translated[nodeId];
              if (newPos !== undefined) {
                  if (node?.type === 'task') mergedLayout[nodeId] = newPos;
                  else if (node?.type === 'text') { const tnIndex = textNodeIndex.get(nodeId) ?? -1; if (tnIndex > -1) { const textNodeToUpdate = updatedTextNodes[tnIndex]; if (textNodeToUpdate !== undefined) { textNodeToUpdate.x = newPos.x; textNodeToUpdate.y = newPos.y; } } }
              }
          });
          await plugin.saveBoardData(activeBoardId, { layout: mergedLayout, textNodes: updatedTextNodes, taskPaths,
              groups: (board.data.groups || []).map(group => ({ ...group, position: translated[group.id] || group.position })) });
          setRefreshKey(key => key + 1);
      }



      if (plugin.settings.autoFitAfterLayout) {
          const activeNodesToFocus = layoutNodes.filter(n => {
              if (n.type === 'groupFrame') return true;
              if (isTaskNode(n)) return !(n.data.status === 'x' || n.data.customStatus === 'finished');
              return false;
          });
          const nodesToFit = activeNodesToFocus.length > 0 ? activeNodesToFocus : layoutNodes;
          const fitViewNodes = nodesToFit.map(n => ({ id: n.id }));

          window.setTimeout(() => {
              reactFlowInstance.fitView({ nodes: fitViewNodes, duration: 800, padding: 0.1 });
          }, 50);
      } else {
          // 如果关闭了自动缩放，则不执行 fitView，保持当前视图位置
          console.debug("Auto-fit skipped per user settings.");
      }

  };

  const layoutRef = React.useRef(handleAutoLayout);
  layoutRef.current = handleAutoLayout;
  React.useEffect(() => {
      view.triggerLayout = () => { void layoutRef.current(); };
      return () => { view.triggerLayout = undefined; };
  }, [view]);

  const handleResetView = () => {
      setConfirmReq({
          message: "Clear all positions?",
          action: () => {
              void (async () => {
                  const board = plugin.settings.boards.find(b => b.id === activeBoardId);
                  if (board) {
                      const newLayout = {};
                      const newTextNodes = board.data.textNodes.map((tn, index) => ({ ...tn, x: (index % 3) * 320, y: Math.floor(index / 3) * 200 }));
                      await plugin.saveBoardData(activeBoardId, { layout: newLayout, textNodes: newTextNodes });
                      setRefreshKey(prev => prev + 1);
                      new Notice("View reset.");
                      window.setTimeout(() => reactFlowInstance.fitView({ duration: 800, padding: 0.1 }), 100);
                  }
              })();
          }
      });
  };

  const handleSidebarClick = (nodeId: string) => {
      setPendingFocusId(nodeId);
      const board = plugin.settings.boards.find(board => board.id === activeBoardId);
      if (!board || !nodes.find(node => node.id === nodeId)?.hidden) return;
      groupWorkspace.navigate(null);
      const groups = board.data.groups || [];
      void plugin.saveBoardData(activeBoardId, { groups: groups.map(group => groupDescendants(groups, group.id).has(nodeId) ? { ...group, collapsed: false } : group) }).then(() => setRefreshKey(key => key + 1));
  };

  React.useEffect(() => {
      if (!pendingFocusId) return;
      const node = nodes.find(node => node.id === pendingFocusId && !node.hidden);
      if (!node) return;
      reactFlowInstance.setCenter(node.position.x + (node.width || 240) / 2,
          node.position.y + (node.height || 120) / 2, { zoom: 1.5, duration: 500 });
      setNodes(current => current.map(item => ({ ...item, selected: item.id === pendingFocusId })));
      setPendingFocusId(null);
  }, [nodes, pendingFocusId, reactFlowInstance, setNodes]);

  // Keep sidebar actions current without re-rendering its task lists for every drag frame.
  const sidebarActions = React.useRef({ center: handleSidebarClick, changeStatus: updateNodeStatus });
  sidebarActions.current = { center: handleSidebarClick, changeStatus: updateNodeStatus };
  const centerSidebarTask = React.useCallback((id: string) => sidebarActions.current.center(id), []);
  const changeSidebarStatus = React.useCallback((id: string, status: string) => sidebarActions.current.changeStatus(id, status), []);
  const openTaskSearch = React.useCallback(() => { setSearchConnectionSource(null); setShowTaskSearch(true); }, []);

  return (
    <div ref={canvasRef} className={`task-graph-container ${isConnecting ? 'is-connecting' : ''} ${isBoardSwitching ? 'is-board-switching' : ''} ${!plugin.isCacheInitialized ? 'is-task-loading' : ''}`} aria-busy={isBoardSwitching || !plugin.isCacheInitialized} onContextMenu={onPaneContextMenu}>
      <TaskSidebar nodes={nodes} onNodeCenter={centerSidebarTask} onStatusChange={changeSidebarStatus} onSearch={openTaskSearch} />
      {showTaskSearch && <TaskSearch mode={searchConnectionSource ? 'connect' : 'focus'} tasks={searchConnectionSource ? groupWorkspace.searchTargets(searchConnectionSource) : nodes.filter(isTaskNode).map(node => ({ id: node.id, label: node.data.label, path: node.data.path }))}
          onClose={() => { setShowTaskSearch(false); setSearchConnectionSource(null); }} onSelect={id => {
              setShowTaskSearch(false);
              if (searchConnectionSource) {
                  onConnect({ source: searchConnectionSource, target: id, sourceHandle: null, targetHandle: null });
                  setSearchConnectionSource(null);
              } else handleSidebarClick(id);
          }} />}
      {connectionChoices && !connectionActionsHidden && <ConnectionActions x={connectionChoices.x} y={connectionChoices.y}
          activeAction={isConnecting ? connectionActiveAction : null}
          canCreate={!!groupWorkspace.sourcePath(connectionChoices.sourceId)}
          onChoose={chooseConnectionAction} />}
      <ReactFlow
        nodes={nodes} edges={edges}
        onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
        onConnect={onConnect} onConnectStart={onConnectStart} onConnectEnd={onConnectEnd}
        onNodeClick={groupWorkspace.selectionEnd}
        onSelectionStart={groupWorkspace.selectionStart} onSelectionEnd={groupWorkspace.selectionEnd}
        onSelectionDragStart={groupWorkspace.selectionStart} onSelectionDragStop={groupWorkspace.selectionEnd}
        onNodeDragStop={onNodeDragStop}
        onNodeDragStart={groupWorkspace.dragStart} onNodeDrag={groupWorkspace.drag}
        onMoveEnd={onMoveEnd}
        onEdgeContextMenu={onEdgeContextMenu}
        onNodeContextMenu={onNodeContextMenu}
        onPaneContextMenu={onPaneContextMenu}
        nodeTypes={nodeTypes}
        defaultEdgeOptions={{ type: 'default', style: { strokeWidth: 2, stroke: 'var(--interactive-accent)' } }}
        fitView minZoom={0.1} maxZoom={4}
        nodesDraggable={true} nodesConnectable={true} elementsSelectable={true} nodeDragThreshold={2}
        snapToGrid={true} snapGrid={[24, 24]}
        proOptions={{ hideAttribution: true }}
        panOnScroll={true} zoomOnScroll={true} preventScrolling={false}
        selectionOnDrag={true} selectionMode={SelectionMode.Partial} panOnDrag={[1]} panActivationKeyCode="Space" multiSelectionKeyCode="Shift"
        connectionLineStyle={{ stroke: 'var(--interactive-accent)', strokeWidth: 2, strokeDasharray: '5,5' }}
        connectionLineType={ConnectionLineType.Bezier}
      >
        <Background gap={24} color="rgba(150,150,150,0.1)" size={1.5} />

        <ControlPanel boards={plugin.settings.boards.filter(board => !board.archived)} activeBoardId={activeBoardId} onSwitchBoard={handleSwitchBoard} onAddBoard={handleAddBoard} onRenameBoard={handleRenameBoard} onArchiveBoard={handleArchiveBoard} onAutoLayout={handleAutoLayout} onSyncRelations={handleSyncRelations} onResetView={handleResetView} currentBoard={activeBoard} onUpdateFilter={handleUpdateFilter} onApplyFilters={handleApplyFilters} onRequestConfirm={(msg: string, action: () => void) => setConfirmReq({ message: msg, action })} allTags={allTags} allFolders={allFolders} />
        <GraphToolbar onBack={groupWorkspace.scope ? groupWorkspace.back : undefined} onCanvas={groupWorkspace.scope ? () => groupWorkspace.navigate(null) : undefined} />
        {groupWorkspace.controls}

        <Panel position="bottom-right" style={{ position: 'absolute', bottom: '20px', right: '70px', zIndex: 99, pointerEvents: 'none' }}>
            <div style={{ position: 'relative', pointerEvents: 'all' }}>
                <button
                    className="task-graph-help-btn"
                    onClick={() => setShowHelp(prev => !prev)}
                    title="Help"
                >
                    ?
                </button>
                {showHelp && <HelpPanel onClose={() => setShowHelp(false)} />}
            </div>
        </Panel>
      </ReactFlow>

      {editTarget && (
          <EditTaskModal initialText={editTarget.text} onClose={() => setEditTarget(null)} onSave={(text) => { void saveTaskEdit(text); }} allTags={allTags} />
      )}

      {createTarget && (
          <EditTaskModal initialText="" onClose={() => setCreateTarget(null)} onSave={(text) => { void handleCreateTask(text); }} allTags={allTags} />
      )}

      {confirmReq && (
          <ConfirmModal message={confirmReq.message} onConfirm={confirmReq.action} onClose={() => setConfirmReq(null)} />
      )}
    </div>
  );
};

const TaskGraphWithProvider = ({ plugin, view }: { plugin: TaskGraphPlugin, view: TaskGraphView }) => { return ( <ReactFlowProvider> <TaskGraphComponent plugin={plugin} view={view} /></ReactFlowProvider> ); };

export class TaskGraphView extends ItemView {
  plugin: TaskGraphPlugin; root: Root | null = null;
  triggerLayout?: () => void;

  constructor(leaf: WorkspaceLeaf, plugin: TaskGraphPlugin) { super(leaf); this.plugin = plugin; }
  getViewType() { return VIEW_TYPE_TASK_GRAPH; } getDisplayText() { return "Spatial task graph"; } getIcon() { return "network"; }

  onOpen(): Promise<void> {
      const container = this.containerEl.children[1] as HTMLElement;
      if (container) {
          container.empty();
          container.setAttr('style', 'height: 100%; width: 100%; overflow: hidden;');
          this.root = createRoot(container);
          this.root.render(<React.StrictMode><TaskGraphWithProvider plugin={this.plugin} view={this} /></React.StrictMode>);
      }
      return Promise.resolve();
  }
  refresh() { if (this.plugin.viewRefresh) this.plugin.viewRefresh(); }
  onClose(): Promise<void> {
      this.root?.unmount();
      return Promise.resolve();
  }
}
