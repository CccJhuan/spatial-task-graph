import { ItemView, WorkspaceLeaf, Menu, Notice, TFile } from 'obsidian';
import * as React from 'react';
import { createRoot, Root } from 'react-dom/client';
import ReactFlow, { 
  Background, 
  MiniMap, 
  useNodesState, 
  useEdgesState, 
  addEdge,
  Node,
  Connection,
  Edge,
  Panel,
  Handle,
  Position,
  ReactFlowProvider,
  useReactFlow
} from 'reactflow';

import TaskGraphPlugin, { GraphBoard } from './main';

export const VIEW_TYPE_TASK_GRAPH = 'task-graph-view';

// 🌟 核心样式
const REACT_FLOW_CORE_STYLES = `
    .react-flow{direction:ltr;width:100%;height:100%;position:relative;z-index:0;overflow:hidden}
    .react-flow__background{background-color:transparent;z-index:-1;width:100%;height:100%;top:0;left:0;position:absolute}
    .react-flow__container{position:absolute;width:100%;height:100%;top:0;left:0}
    .react-flow__pane{z-index:1;cursor:grab;width:100%;height:100%;top:0;left:0;position:absolute}
    .react-flow__pane.dragging{cursor:grabbing}
    .react-flow__viewport{transform-origin:0 0;z-index:2;pointer-events:none;width:100%;height:100%;top:0;left:0;position:absolute}
    .react-flow__renderer{z-index:4}
    .react-flow__selection{z-index:1001;position:absolute;top:0;left:0;pointer-events:none}
    .react-flow__nodes{pointer-events:none;transform-origin:0 0}
    .react-flow__node{position:absolute;user-select:none;pointer-events:all;transform-origin:0 0;box-sizing:border-box;cursor:default}
    .react-flow__edges{pointer-events:none;overflow:visible}
    .react-flow__edge{pointer-events:all}
    .react-flow__edge-text{pointer-events:none;user-select:none}
    .react-flow__handle{position:absolute;pointer-events:all;min-width:5px;min-height:5px;width:8px;height:8px;background:#b1b1b7;border:1px solid #fff;border-radius:100%;z-index:1}
    .react-flow__minimap{z-index:5}
    .react-flow__panel{z-index:10; position:absolute; pointer-events:none;}
`;

const CUSTOM_STYLES = `
    .task-graph-container { width: 100%; height: 100%; position: relative; background: var(--background-primary); }
    
    .task-node-wrapper {
        position: relative;
        width: 240px;
        background: var(--background-secondary);
        border-radius: 8px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.15);
        font-family: var(--font-interface);
        transition: box-shadow 0.2s, border-color 0.2s, transform 0.1s;
        border: 1px solid var(--background-modifier-border);
    }
    .task-node-wrapper:hover {
        box-shadow: 0 8px 16px rgba(0,0,0,0.3);
        border-color: var(--interactive-accent);
        transform: translateY(-1px);
        z-index: 10;
    }

    .node-tag {
        font-size: 10px;
        padding: 2px 6px;
        border-radius: 4px;
        font-weight: 500;
        background-color: rgba(125, 125, 125, 0.15); 
        color: var(--text-normal);
        border: 1px solid rgba(125, 125, 125, 0.2);
    }

    .react-flow__panel > * { pointer-events: all; }
`;

const STATUS_STYLES: Record<string, { bg: string, text: string }> = {
    'in_progress': { bg: '#2e7d32', text: '#ffffff' },
    'pending':     { bg: '#f9a825', text: '#000000' },
    'finished':    { bg: '#7b1fa2', text: '#ffffff' },
    'blocked':     { bg: '#c62828', text: '#ffffff' },
    'backlog':     { bg: '#616161', text: '#ffffff' },
    'default':     { bg: 'var(--background-secondary-alt)', text: 'var(--text-muted)' }
};

const extractTags = (text: string) => {
    if (!text) return { tags: [], cleanText: '' };
    const tagRegex = /#[\w\u4e00-\u9fa5]+(\/[\w\u4e00-\u9fa5]+)*/g;
    const tags = text.match(tagRegex) || [];
    const cleanText = text.replace(tagRegex, '').trim();
    return { tags, cleanText };
};

// --- 组件：任务节点 ---
const TaskNode = ({ data, isConnectable }: { data: any, isConnectable: boolean }) => {
  const { tags, cleanText } = extractTags(data.label);
  const statusStyle = STATUS_STYLES[data.customStatus] || STATUS_STYLES['default'];
  
  return (
    <div className="task-node-wrapper">
      <Handle 
        type="target" position={Position.Left} isConnectable={isConnectable}
        style={{ 
            background: 'var(--text-muted)', width: '10px', height: '10px', 
            left: '-6px', top: '50%', transform: 'translateY(-50%)',
            border: '2px solid var(--background-primary)', zIndex: 10 
        }} 
      />
      
      <div style={{ 
          padding: '8px 10px', 
          background: statusStyle.bg, color: statusStyle.text,
          fontSize: '11px', fontWeight: 'bold', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          borderTopLeftRadius: '8px', borderTopRightRadius: '8px'
      }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '160px' }}>{data.file}</span>
        <span style={{ opacity: 0.9, fontSize: '10px' }}>{data.customStatus === 'default' ? 'TASK' : data.customStatus.toUpperCase().replace('_', ' ')}</span>
      </div>

      <div style={{ padding: '12px', display: 'flex', alignItems: 'flex-start', gap: '8px', color: 'var(--text-normal)' }}>
        <input type="checkbox" checked={data.status !== ' ' && data.status !== '/'} readOnly style={{ marginTop: '3px', cursor: 'pointer' }} />
        <span style={{ textDecoration: (data.status === 'x' || data.status === '-') ? 'line-through' : 'none', color: (data.status === 'x' || data.status === '-') ? 'var(--text-muted)' : 'var(--text-normal)', lineHeight: '1.5', wordBreak: 'break-word', fontSize: '13px' }}>
            {cleanText || data.label}
        </span>
      </div>

      {tags.length > 0 && (
          <div style={{ padding: '0 10px 10px 10px', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {tags.map((tag, i) => (
                  <span key={i} className="node-tag">{tag}</span>
              ))}
          </div>
      )}
      
      <Handle 
        type="source" position={Position.Right} isConnectable={isConnectable}
        style={{ 
            background: 'var(--interactive-accent)', width: '10px', height: '10px', 
            right: '-6px', top: '50%', transform: 'translateY(-50%)',
            border: '2px solid var(--background-primary)', zIndex: 10 
        }} 
      />
    </div>
  );
};

const nodeTypes = { task: TaskNode };

// --- 导航工具栏 ---
const GraphToolbar = () => {
    const { zoomIn, zoomOut, fitView } = useReactFlow();
    const stopPropagation = (e: React.MouseEvent) => e.stopPropagation();

    const btnStyle: React.CSSProperties = {
        width: '28px', height: '28px', 
        background: 'var(--background-primary)', 
        border: '1px solid var(--background-modifier-border)',
        color: 'var(--text-normal)',
        borderRadius: '4px', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '4px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
    };

    return (
        <Panel position="top-left" style={{ margin: '10px', display: 'flex', flexDirection: 'column', gap: '6px', pointerEvents: 'all' }} onMouseDown={stopPropagation}>
            <button style={btnStyle} onClick={() => zoomIn()} title="Zoom In">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            </button>
            <button style={btnStyle} onClick={() => zoomOut()} title="Zoom Out">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            </button>
            <button style={btnStyle} onClick={() => fitView()} title="Fit View">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>
            </button>
        </Panel>
    );
};

// --- 组件：控制面板 ---
const ControlPanel = ({ boards, activeBoardId, onSwitchBoard, onAddBoard, onRenameBoard, onDeleteBoard, onAutoLayout, onResetView, currentBoard, onUpdateFilter }: any) => {
    const [showFilters, setShowFilters] = React.useState(false);
    const [isRenaming, setIsRenaming] = React.useState(false);
    const [tempName, setTempName] = React.useState('');

    React.useEffect(() => { setIsRenaming(false); setTempName(currentBoard?.name || ''); }, [currentBoard]);
    const handleSaveName = () => { if (tempName.trim()) onRenameBoard(tempName); setIsRenaming(false); };
    const handleDelete = () => { if (boards.length <= 1) { new Notice("Cannot delete the only board."); return; } if (window.confirm(`Delete board "${currentBoard.name}"?`)) onDeleteBoard(activeBoardId); };
    const stopPropagation = (e: React.MouseEvent | React.KeyboardEvent) => { e.stopPropagation(); };

    const btnStyle = { background: 'var(--interactive-normal)', border: '1px solid var(--background-modifier-border)', color: 'var(--text-normal)', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background 0.2s' };
    const inputStyle = { background: 'var(--background-primary)', border: '1px solid var(--background-modifier-border)', color: 'var(--text-normal)', padding: '6px', borderRadius: '4px', width: '100%', marginBottom: '8px' };

    return (
        <Panel position="bottom-right" style={{ 
            position: 'absolute', bottom: '20px', right: '20px', margin: 0,
            background: 'var(--background-primary)', padding: '16px', borderRadius: '12px', 
            border: '1px solid var(--background-modifier-border)', display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: '340px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)', cursor: 'default',
            zIndex: 100
        }} onMouseDown={stopPropagation} onClick={stopPropagation}>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                {isRenaming ? (
                    <>
                        <input value={tempName} onChange={(e) => setTempName(e.target.value)} style={{ ...inputStyle, marginBottom: 0, flex: 1 }} autoFocus onKeyDown={(e) => e.key === 'Enter' && handleSaveName()} />
                        <button style={btnStyle} onClick={handleSaveName}>Save</button>
                    </>
                ) : (
                    <>
                        <select value={activeBoardId} onChange={(e) => onSwitchBoard(e.target.value)} style={{ ...btnStyle, flex: 1, textOverflow: 'ellipsis' }}>{boards.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
                        <button style={btnStyle} onClick={() => setIsRenaming(true)} title="Rename">✎</button>
                        <button style={btnStyle} onClick={onAddBoard} title="New">+</button>
                    </>
                )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <button style={btnStyle} onClick={onAutoLayout} title="Arrange tasks">⚡ Layout</button>
                <button style={btnStyle} onClick={() => setShowFilters(!showFilters)}>{showFilters ? 'Hide Filters' : 'Filters'}</button>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
                <button style={{...btnStyle, flex:1, background: '#c62828', color: 'white'}} onClick={onResetView} title="Reset">Reset View</button>
                <button style={{...btnStyle, flex:1, color: '#ff5252'}} onClick={handleDelete} title="Delete">🗑 Delete</button>
            </div>
            {showFilters && currentBoard && (
                <div style={{ marginTop: '8px', borderTop: '1px solid var(--background-modifier-border)', paddingTop: '12px' }}>
                    <div style={{ fontSize: '11px', fontWeight: 'bold', marginBottom: '4px', color: 'var(--text-muted)' }}>TAGS</div>
                    <input style={inputStyle} placeholder="#todo" value={currentBoard.filters.tags.join(', ')} onChange={(e) => onUpdateFilter('tags', e.target.value)} />
                    <div style={{ fontSize: '11px', fontWeight: 'bold', marginBottom: '4px', color: 'var(--text-muted)' }}>PATH</div>
                    <input style={inputStyle} placeholder="Project/A" value={currentBoard.filters.folders.join(', ')} onChange={(e) => onUpdateFilter('folders', e.target.value)} />
                    <div style={{ display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap' }}>
                         {[' ', '/', 'x'].map(status => (
                             <label key={status} style={{fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer'}}>
                                 <input type="checkbox" checked={currentBoard.filters.status.includes(status)} onChange={() => onUpdateFilter('status', status)} /> {status === ' ' ? 'Todo' : status === '/' ? 'Doing' : 'Done'}
                             </label>
                         ))}
                    </div>
                </div>
            )}
        </Panel>
    );
};

// --- 主图表组件 ---
const TaskGraphComponent = ({ plugin }: { plugin: TaskGraphPlugin }) => {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [activeBoardId, setActiveBoardId] = React.useState(plugin.settings.lastActiveBoardId);
  const [refreshKey, setRefreshKey] = React.useState(0);
  const reactFlowInstance = useReactFlow();

  React.useEffect(() => {
    const styleId = 'task-graph-styles';
    let styleEl = document.getElementById(styleId);
    if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = styleId;
        document.head.appendChild(styleEl);
    }
    styleEl.innerHTML = REACT_FLOW_CORE_STYLES + CUSTOM_STYLES;
  }, []);

  const activeBoard = plugin.settings.boards.find(b => b.id === activeBoardId) || plugin.settings.boards[0];

  React.useEffect(() => {
    const loadData = async () => {
      const tasks = await plugin.getTasks(activeBoardId);
      const boardConfig = plugin.settings.boards.find(b => b.id === activeBoardId);
      const savedLayout = boardConfig?.data.layout || {};
      const savedEdges = boardConfig?.data.edges || [];
      const savedNodeStatus = boardConfig?.data.nodeStatus || {};

      const flowNodes: Node[] = tasks.map((t, index) => {
        let posX = savedLayout[t.id]?.x;
        let posY = savedLayout[t.id]?.y;
        if (typeof posX !== 'number' || isNaN(posX)) { posX = (index % 3) * 320; posY = Math.floor(index / 3) * 200; }
        return {
            id: t.id, type: 'task', position: { x: posX, y: posY },
            data: { label: t.text, status: t.status, file: t.file, path: t.path, line: t.line, customStatus: savedNodeStatus[t.id] || 'default' }
        };
      });
      setNodes(flowNodes); setEdges(savedEdges);
      setTimeout(() => { reactFlowInstance.fitView({ padding: 0.2 }); }, 200);
    };
    loadData();
  }, [plugin, activeBoardId, refreshKey]);

  const onConnect = React.useCallback((params: Connection) => {
    setEdges((eds) => {
        const newEdges = addEdge({ ...params, animated: true, style: { stroke: 'var(--text-accent)', strokeWidth: 2 } }, eds);
        plugin.saveBoardData(activeBoardId, { edges: newEdges });
        return newEdges;
    });
  }, [plugin, activeBoardId, setEdges]);

  const onNodeDragStop = React.useCallback((event: any, node: Node) => {
      setNodes((nds) => {
        const layout: Record<string, {x: number, y: number}> = {};
        const board = plugin.settings.boards.find(b => b.id === activeBoardId);
        if(board) { Object.assign(layout, board.data.layout); layout[node.id] = node.position; plugin.saveBoardData(activeBoardId, { layout }); }
        return nds;
      });
  }, [plugin, activeBoardId, setNodes]);

  const onEdgeContextMenu = React.useCallback((event: React.MouseEvent, edge: Edge) => {
      event.preventDefault();
      setEdges((eds) => { const newEdges = eds.filter((e) => e.id !== edge.id); plugin.saveBoardData(activeBoardId, { edges: newEdges }); return newEdges; });
      new Notice("Connection removed");
  }, [plugin, activeBoardId, setEdges]);

  const onNodeClick = React.useCallback((event: React.MouseEvent, node: Node) => {
      if (node.data.path) plugin.app.workspace.openLinkText(node.data.path, '', false);
  }, [plugin]);

  const onNodeContextMenu = React.useCallback((event: React.MouseEvent, node: Node) => {
      event.preventDefault();
      const menu = new Menu();
      const setStatus = (status: string) => updateNodeStatus(node.id, status);
      menu.addItem((item) => item.setTitle('⚪ Backlog').onClick(() => setStatus('backlog')));
      menu.addItem((item) => item.setTitle('🟡 Pending').onClick(() => setStatus('pending')));
      menu.addItem((item) => item.setTitle('🟢 In Progress').onClick(() => setStatus('in_progress')));
      menu.addItem((item) => item.setTitle('🔴 Blocked').onClick(() => setStatus('blocked')));
      menu.addItem((item) => item.setTitle('🟣 Finished').onClick(() => setStatus('finished')));
      menu.showAtPosition({ x: event.nativeEvent.clientX, y: event.nativeEvent.clientY });
  }, [plugin, activeBoardId]);

  const updateNodeStatus = async (nodeId: string, status: string) => {
      setNodes((nds) => nds.map((n) => { if (n.id === nodeId) return { ...n, data: { ...n.data, customStatus: status } }; return n; }));
      const board = plugin.settings.boards.find(b => b.id === activeBoardId);
      if (board) { const nodeStatus = (board.data as any).nodeStatus || {}; nodeStatus[nodeId] = status; await plugin.saveBoardData(activeBoardId, { nodeStatus } as any); }
  };

  const handleSwitchBoard = (id: string) => { setActiveBoardId(id); plugin.settings.lastActiveBoardId = id; plugin.saveSettings(); };
  const handleAddBoard = async () => {
    const newBoard: GraphBoard = { id: Date.now().toString(), name: `Board ${plugin.settings.boards.length + 1}`, filters: { tags: [], excludeTags: [], folders: [], status: [' ', '/'] }, data: { layout: {}, edges: [], groups: [] } };
    plugin.settings.boards.push(newBoard); handleSwitchBoard(newBoard.id);
  };
  const handleDeleteBoard = async (id: string) => {
      const newBoards = plugin.settings.boards.filter(b => b.id !== id); plugin.settings.boards = newBoards;
      const nextBoard = newBoards[0]; setActiveBoardId(nextBoard.id); plugin.settings.lastActiveBoardId = nextBoard.id; await plugin.saveSettings();
  };
  const handleRenameBoard = async (newName: string) => { await plugin.updateBoardConfig(activeBoardId, { name: newName }); setRefreshKey(prev => prev + 1); };
  const handleUpdateFilter = async (type: string, value: string) => {
      const board = plugin.settings.boards.find(b => b.id === activeBoardId); if (!board) return;
      if (type === 'tags' || type === 'excludeTags' || type === 'folders') board.filters[type as 'tags' | 'excludeTags' | 'folders'] = value.split(',').map(s => s.trim()).filter(s => s);
      else if (type === 'status') { const statusChar = value; const index = board.filters.status.indexOf(statusChar); if (index > -1) board.filters.status.splice(index, 1); else board.filters.status.push(statusChar); }
      await plugin.saveSettings(); setRefreshKey(prev => prev + 1);
  };

  // 🌟 核心升级：重心算法 (Barycenter) 布局
  const handleAutoLayout = async () => {
      // 1. 构建邻接表和反向表 (Parents)
      const adjacency: Record<string, string[]> = {};
      const parents: Record<string, string[]> = {}; // 反向图
      const inDegree: Record<string, number> = {};
      
      nodes.forEach(n => { adjacency[n.id] = []; parents[n.id] = []; inDegree[n.id] = 0; });
      edges.forEach(e => { 
          if (adjacency[e.source]) {
              adjacency[e.source].push(e.target);
              if (!parents[e.target]) parents[e.target] = [];
              parents[e.target].push(e.source);
              inDegree[e.target] = (inDegree[e.target] || 0) + 1; 
          }
      });

      // 2. BFS 计算层级 (Layering)
      const levels: Record<string, number> = {};
      const queue: string[] = [];
      nodes.forEach(n => { if (inDegree[n.id] === 0) { levels[n.id] = 0; queue.push(n.id); } });
      
      if (queue.length === 0 && nodes.length > 0) { queue.push(nodes[0].id); levels[nodes[0].id] = 0; } // 破环

      const visited = new Set<string>();
      while(queue.length > 0) {
          const curr = queue.shift()!;
          if (visited.has(curr)) continue;
          visited.add(curr);
          adjacency[curr]?.forEach(next => {
              levels[next] = Math.max(levels[next] || 0, (levels[curr] || 0) + 1);
              if(!visited.has(next)) queue.push(next);
          });
      }

      // 3. 分组
      const levelGroups: Record<number, string[]> = {};
      let maxLevel = 0;
      nodes.forEach(n => { const lvl = levels[n.id] || 0; maxLevel = Math.max(maxLevel, lvl); if(!levelGroups[lvl]) levelGroups[lvl] = []; levelGroups[lvl].push(n.id); });

      const layout: Record<string, {x: number, y: number}> = {};
      const COL_WIDTH = 340; 
      const ROW_HEIGHT = 200;

      // 4. 逐层布局 (重心法)
      for (let lvl = 0; lvl <= maxLevel; lvl++) {
          const currentNodes = levelGroups[lvl] || [];
          
          if (lvl === 0) {
              // 第一层按 ID 排序，保持稳定
              currentNodes.sort((a, b) => a.localeCompare(b));
              currentNodes.forEach((id, idx) => { layout[id] = { x: 0, y: idx * ROW_HEIGHT }; });
          } else {
              // 计算父节点平均 Y 值 (重心)
              const nodeWithY = currentNodes.map(nodeId => {
                  const nodeParents = parents[nodeId] || [];
                  let avgY = Infinity;
                  if (nodeParents.length > 0) {
                      const validParents = nodeParents.filter(p => layout[p] !== undefined);
                      if (validParents.length > 0) {
                          avgY = validParents.reduce((sum, p) => sum + layout[p].y, 0) / validParents.length;
                      }
                  }
                  return { id: nodeId, avgY };
              });

              // 按重心排序
              nodeWithY.sort((a, b) => {
                  if (a.avgY === Infinity && b.avgY === Infinity) return a.id.localeCompare(b.id);
                  return a.avgY - b.avgY;
              });

              // 分配坐标，防止重叠 (Compaction)
              let currentY = 0;
              nodeWithY.forEach((item, idx) => {
                  // 理想位置是父节点中心，但不能小于前一个节点的底部
                  let idealY = item.avgY === Infinity ? currentY : item.avgY;
                  if (idx > 0 && idealY < currentY) {
                      idealY = currentY;
                  }
                  layout[item.id] = { x: lvl * COL_WIDTH, y: idealY };
                  currentY = idealY + ROW_HEIGHT;
              });
          }
      }

      setNodes(nds => nds.map(n => ({ ...n, position: layout[n.id] || n.position })));
      await plugin.saveBoardData(activeBoardId, { layout });
      new Notice("Auto layout with parent alignment!");
      setTimeout(() => reactFlowInstance.fitView({ padding: 0.2, duration: 800 }), 100);
  };

  const handleResetView = async () => { if (!window.confirm("Clear all positions?")) return; await plugin.saveBoardData(activeBoardId, { layout: {} }); setRefreshKey(prev => prev + 1); new Notice("View reset."); };
  const handleContainerMouseDown = (e: React.MouseEvent) => { e.stopPropagation(); };

  return (
    <div className="task-graph-container" onMouseDown={handleContainerMouseDown}>
      <ReactFlow
        nodes={nodes} edges={edges}
        onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
        onConnect={onConnect} onNodeDragStop={onNodeDragStop}
        onEdgeContextMenu={onEdgeContextMenu} onNodeClick={onNodeClick}
        onNodeContextMenu={onNodeContextMenu}
        nodeTypes={nodeTypes} 
        fitView minZoom={0.1} maxZoom={4}
        nodesDraggable={true} nodesConnectable={true} elementsSelectable={true}
        proOptions={{ hideAttribution: true }}
        panOnScroll={true} zoomOnScroll={true} panOnDrag={true} preventScrolling={false}
        connectionLineStyle={{ stroke: 'var(--interactive-accent)', strokeWidth: 2, strokeDasharray: '5,5' }}
      >
        <Background gap={20} color="#555" />
        <GraphToolbar />
        <MiniMap 
            nodeStrokeColor="#666" nodeColor="#333" maskColor="rgba(0,0,0,0.2)" 
            style={{ position: 'absolute', top: 10, right: 10, bottom: 'auto', left: 'auto', zIndex: 5 }}
        />
        <ControlPanel boards={plugin.settings.boards} activeBoardId={activeBoardId} onSwitchBoard={handleSwitchBoard} onAddBoard={handleAddBoard} onRenameBoard={handleRenameBoard} onDeleteBoard={handleDeleteBoard} onAutoLayout={handleAutoLayout} onResetView={handleResetView} currentBoard={activeBoard} onUpdateFilter={handleUpdateFilter} />
      </ReactFlow>
    </div>
  );
};

const TaskGraphWithProvider = ({ plugin }: { plugin: TaskGraphPlugin }) => { return ( <ReactFlowProvider> <TaskGraphComponent plugin={plugin} /> </ReactFlowProvider> ); };
export class TaskGraphView extends ItemView {
  plugin: TaskGraphPlugin; root: Root | null = null;
  constructor(leaf: WorkspaceLeaf, plugin: TaskGraphPlugin) { super(leaf); this.plugin = plugin; }
  getViewType() { return VIEW_TYPE_TASK_GRAPH; } getDisplayText() { return "Spatial Task Graph"; } getIcon() { return "network"; }
  async onOpen() { const container = this.containerEl.children[1]; container.empty(); container.setAttr('style', 'height: 100%; width: 100%; overflow: hidden;'); this.root = createRoot(container); this.root.render(<React.StrictMode><TaskGraphWithProvider plugin={this.plugin} /></React.StrictMode>); }
  async onClose() { this.root?.unmount(); }
}