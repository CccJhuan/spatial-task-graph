import * as React from 'react';
import { Handle, Position } from 'reactflow';
import type { GroupRow } from './GroupNode';

export interface TaskNodeData {
    id: string; label: string; notes: string; status: string; file: string; path: string; line: number; endLine: number; customStatus: string;
    onEdit: (data: TaskNodeData) => void;
    source: 'checklist' | 'tasknotes'; rawStatus: string;
    onToggleStatus: (id: string, status: string, path: string, line: number, source: 'checklist' | 'tasknotes') => Promise<void>;
    onOpenFile: (path: string) => void;
    onSaveNotes: (data: TaskNodeData, notes: string) => Promise<void>;
    hasChildren: boolean;
    isCollapsed: boolean;
    compactChildren?: GroupRow[];
    onToggleCollapse: (id: string, collapsed: boolean) => Promise<void>;
}


export const STATUS_COLORS = { 'in_progress': '#34c759', 'pending': '#ff9500', 'finished': '#af52de', 'blocked': '#ff3b30', 'backlog': '#8e8e93', 'default': 'var(--text-muted)' };
const extractTags = (text: string) => { if (!text) return { tags: [], cleanText: '' }; const tagRegex = /#[\w\u4e00-\u9fa5-]+(\/[\w\u4e00-\u9fa5-]+)*/g; const tags = text.match(tagRegex) || []; const cleanText = text.replace(tagRegex, '').trim(); return { tags, cleanText }; };

export const TaskNode = React.memo(({ data, isConnectable, showHandles = true }: { data: TaskNodeData, isConnectable: boolean, showHandles?: boolean }) => {
  const { tags, cleanText } = extractTags(data.label);
  const statusColor = STATUS_COLORS[data.customStatus as keyof typeof STATUS_COLORS] || STATUS_COLORS['default'];

  const [isExpanded, setIsExpanded] = React.useState(false);
  const [isEditingNotes, setIsEditingNotes] = React.useState(false);
  const [noteDraft, setNoteDraft] = React.useState(data.notes || '');

  React.useEffect(() => {
    if (!isEditingNotes) setNoteDraft(data.notes || '');
  }, [data.notes, isEditingNotes]);

  const saveNotes = async () => {
    if (noteDraft !== data.notes) await data.onSaveNotes(data, noteDraft);
    setIsEditingNotes(false);
  };

  return (
    <div className="task-node-wrapper">
      {showHandles && <Handle type="target" position={Position.Left} isConnectable={isConnectable} className="custom-handle" style={{ left: '-20px', width: '40px', height: '40px', top: '50%', transform: 'translateY(-50%)' }} />}
      <div style={{ height: '6px', width: '100%', background: statusColor, opacity: 0.8, flexShrink: 0 }}></div>
      <div style={{ padding: '12px 14px', flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px' }}>
            <span style={{ fontSize: '10px', fontWeight: '600', color: statusColor, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{data.source === 'tasknotes' && data.rawStatus.trim() ? data.rawStatus : (data.customStatus === 'default' ? 'Task' : data.customStatus.replace('_', ' '))}</span>
            <div className="edit-btn" onClick={(e) => { e.stopPropagation(); data.onEdit(data); }} title="Edit task">✎</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
            <div
                className="nodrag"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                    e.stopPropagation();
                    void data.onToggleStatus(data.id, data.status, data.path, data.line, data.source);
                }}
                style={{ display: 'flex', alignItems: 'center', marginTop: '3px', cursor: 'pointer' }}
            >
                <input
                    type="checkbox"
                    className="custom-checkbox"
                    checked={data.status === 'x'}
                    readOnly
                    style={{ pointerEvents: 'none', margin: 0 }}
                />
            </div>
            <div style={{ flex: 1 }}>
                <div style={{ fontSize: '13px', lineHeight: '1.5', color: 'var(--text-normal)', fontWeight: '700', wordBreak: 'break-word', whiteSpace: 'pre-wrap', opacity: (data.status === 'x' ? 0.6 : 1), textDecoration: (data.status === 'x' ? 'line-through' : 'none') }}>
                    {cleanText || data.label}
                </div>

                <div
                        onClick={(e) => { e.stopPropagation(); const nextExpanded = !isExpanded; setIsExpanded(nextExpanded); setIsEditingNotes(nextExpanded); }}
                        onMouseDown={e => e.stopPropagation()}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', marginTop: '6px', fontSize: '11px', color: 'var(--text-muted)', cursor: 'pointer', userSelect: 'none', borderRadius: '4px', padding: '2px 4px', marginLeft: '-4px' }}
                    >
                        <span style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s ease', display: 'inline-block' }}>▶</span>
                        <span>Notes</span>
                    </div>

                {isExpanded && (
                    <textarea
                        className="nodrag"
                        value={noteDraft}
                        placeholder="Write a note..."
                        onChange={e => { setNoteDraft(e.target.value); setIsEditingNotes(true); }}
                        onFocus={() => setIsEditingNotes(true)}
                        onBlur={() => { void saveNotes(); }}
                        onMouseDown={e => e.stopPropagation()}
                        onKeyDown={e => {
                            e.stopPropagation();
                            if (e.key === 'Escape') { e.preventDefault(); void saveNotes(); }
                            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void saveNotes(); }
                        }}
                        autoFocus={isEditingNotes}
                        rows={Math.max(2, noteDraft.split('\n').length)}
                        style={{ marginTop: '6px', width: '100%', minHeight: '42px', resize: 'vertical', fontSize: '11px', lineHeight: '1.4', color: 'var(--text-normal)', background: 'var(--background-primary)', padding: '6px 8px', border: '1px solid var(--background-modifier-border)', borderRadius: '4px', outline: 'none', borderLeft: `2px solid ${statusColor}` }}
                    />
                )}
            </div>
          </div>
          <div style={{ marginTop: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: '8px' }}>
              <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', flex: 1 }}>{tags.map((tag, i) => (<span key={i} className="node-tag">{tag}</span>))}</div>
              <div className="open-file-btn" onClick={(e) => { e.stopPropagation(); data.onOpenFile(data.path); }} title="Open file">↗ <span>{data.file}</span></div>
          </div>
          {data.compactChildren && data.compactChildren.length > 0 && <div className="nodrag task-compact-children">
            {data.compactChildren.map(row => <div className="task-group-row" key={row.id} style={{ paddingLeft: row.depth * 12 }} onMouseDown={e => e.stopPropagation()}>
              <input type="checkbox" checked={row.checked} onChange={row.onToggle} onClick={e => e.stopPropagation()} />
              <span className={row.checked ? 'is-complete' : ''}>{row.label}</span>
              <button onClick={e => { e.stopPropagation(); row.onOpen(); }} aria-label="Open task">↗</button>
            </div>)}
          </div>}
      </div>
      {showHandles && <Handle type="source" position={Position.Right} isConnectable={isConnectable} className="custom-handle custom-handle-right" style={{ right: '-20px', width: '40px', height: '40px', top: '50%', transform: 'translateY(-50%)' }} />}
      {data.hasChildren && <button className="task-collapse-btn nodrag" onClick={(e) => { e.stopPropagation(); void data.onToggleCollapse(data.id, data.isCollapsed); }} onMouseDown={e => e.stopPropagation()} title={data.isCollapsed ? 'Expand child nodes' : 'Collapse child nodes'} aria-label={data.isCollapsed ? 'Expand child nodes' : 'Collapse child nodes'}>{data.isCollapsed ? '+' : '−'}</button>}
    </div>
  );
});

