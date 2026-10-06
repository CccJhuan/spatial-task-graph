import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { transform, build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const compiled = await transform(await readFile(new URL('../src/groups.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'esm' });
const g = await import(`data:text/javascript,${encodeURIComponent(compiled.code)}`);
const edge = (source, target) => ({ id: `${source}-${target}`, source, target });
const edges = [edge('a', 'b'), edge('b', 'c'), edge('c', 'a'), edge('c', 'd')];
assert.equal(g.treeSelection(['b'], edges, new Set(['a','b','c','d'])).size, 4);
assert.equal(g.groupingError(['a','d'], [], edges) !== null, true);
assert.equal(g.groupingError(['a','b'], [], edges), null);
assert.equal(g.groupingError(['a','b','c'], [], edges), null);
assert.equal(g.groupingError(['a','c','d'], [], edges), null);
let groups = g.addGroup([], ['a','b'], 'First', edges);
const first = groups[0].id;
assert.equal(g.groupingError(['a','c'], groups, edges) !== null, true);
groups = g.addGroup(groups, [first, 'c'], 'Outer', edges);
const outer = groups[1].id;
assert.deepEqual([...g.groupDescendants(groups, outer)].sort(), [first,'a','b','c'].sort());
assert.equal(g.groupParents(groups).get(first), outer);
assert.equal(g.groupParents(groups).get('a'), first);
assert.equal(g.groupingError(['a',first], groups, edges) !== null, true);
groups[0].collapsed = true;
assert.equal(g.visibleEndpoint('a', groups, null), first);
groups[1].collapsed = true;
assert.equal(g.visibleEndpoint('a', groups, null), outer);
assert.equal(g.visibleEndpoint('a', groups, outer), first);
assert.equal(g.visibleEndpoint('d', groups, outer), null);
assert.equal(g.visibleEndpoint('a', groups, first), 'a');
assert.equal(g.visibleEndpoint(first, groups, first), null);
const ungrouped = g.removeGroup(groups, outer);
assert.equal(ungrouped.length, 1);
assert.equal(g.groupParents(ungrouped).get(first), undefined);
assert.deepEqual(g.cleanGroups(groups, new Set(['d'])), []);
const migrated = g.migrateCollapsedGroups([], { a: true, b: true }, ['a','b','c','d'].map(id => ({ id, text: id })), edges);
assert.equal(migrated.length, 1);
assert.equal(migrated[0].collapsed, true);
assert.equal(migrated[0].rootTaskId, 'a');
assert.equal(migrated[0].title, 'Group 1');
assert.equal(g.nextGroupTitle([{title:'Group 1'},{title:'Group 2'}]),'Group 3');
const legacy = [{id:'legacy',title:'Parent',members:['a','b'],collapsed:true}];
const upgraded = g.migrateCollapsedGroups(legacy, {}, [{id:'a',text:'Parent'},{id:'b',text:'Child'}], [edge('a','b')]);
assert.equal(upgraded[0].rootTaskId,'a');
assert.equal(upgraded[0].title,'Group 1');
assert.deepEqual(g.migrateCollapsedGroups(upgraded,{},[{id:'a',text:'Parent'},{id:'b',text:'Child'}],[edge('a','b')]),upgraded);
assert.equal(g.migrateCollapsedGroups(migrated, { a: true }, ['a','b','c','d'].map(id => ({ id, text: id })), edges).length, 1);
assert.equal(g.migrateCollapsedGroups([ { id: 'partial', title: 'Partial', members: ['b','external'], collapsed: false } ], { a: true },
    ['a','b','c','d','external'].map(id => ({ id, text: id })), edges).length, 1);
const cyclicGroups = [{ id:'x', members:['y'], title:'x', collapsed:false }, { id:'y', members:['x','a'], title:'y', collapsed:false }];
assert.deepEqual([...g.groupDescendants(cyclicGroups, 'x')].sort(), ['a','y']);

// Bundle rendering helpers with a host API stub; no vault or DOM required.
const bundled = await build({ entryPoints: [fileURLToPath(new URL('../src/GroupNode.tsx', import.meta.url))], bundle: true, write: false,
    format: 'esm', platform: 'node', plugins: [{ name: 'host-stub', setup(b) {
        b.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'stub' }));
        b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export const getLanguage = () => "en"; export const requireApiVersion = () => true;' }));
    } }] });
const { groupScene } = await import(`data:text/javascript,${encodeURIComponent(bundled.outputFiles[0].text)}`);
const base = ['a','b','c','d'].map((id,i) => ({ id, type:'task', position:{ x:i*320, y:0 }, data:{label:id} }));
const data = group => ({ label:group.title, collapsed:group.collapsed, rows:[], onToggle(){}, onEnter(){}, onRename(){}, onUngroup(){} });
const scene = groupScene(base, groups, edges, null, data);
assert.equal(scene.nodes.find(n => n.id === 'a').hidden, true);
assert.equal(scene.nodes.find(n => n.id === outer).hidden, false);
assert.equal(scene.edges.length, 1);
assert.equal(scene.edges[0].source, outer);
assert.equal(scene.edges[0].target, 'd');
assert.equal(edges[3].source, 'c'); // Projection does not rewrite persistent edges.
const inside = groupScene(base, groups, edges, first, data);
assert.equal(inside.nodes.find(n => n.id === 'a').hidden, false);
assert.equal(inside.nodes.find(n => n.id === 'a').selectable, true);
assert.equal(inside.nodes.find(n => n.id === 'c').hidden, true);
assert.equal(inside.edges.length, 1);
const expandedScene = groupScene(base, groups.map(group=>({...group,collapsed:false})), edges, null, data);
for(const id of ['a','b','c','d']) {
    const node=expandedScene.nodes.find(node=>node.id===id);
    assert.equal(node.hidden,false);
    assert.equal(node.selectable,true);
    assert.equal(node.draggable,true);
}
// A folded tree retains the group endpoint and exposes the parent card data.
const cardScene=groupScene(base,[{id:'tree',title:'Group 1',members:['a','b'],rootTaskId:'a',collapsed:true}],edges,null,
    group=>({...data(group),rows:[{id:'b'}],task:{label:'Parent'}}));
assert.equal(cardScene.nodes.find(node=>node.id==='tree').data.task.label,'Parent');
assert.equal(cardScene.nodes.find(node=>node.id==='tree').dragHandle,undefined);
assert.equal(cardScene.edges.find(edge=>edge.target==='c').source,'tree');
const deep = Array.from({length:10000},(_,i) => ({id:`g${i}`,title:'g',collapsed:false,members:[i===9999?'leaf':`g${i+1}`]}));
assert.equal(g.groupDescendants(deep, 'g0').size,10000);
// Layout treats expanded and collapsed frames as the same logical endpoints.
const expandedGroups=groups.map(group=>({...group,collapsed:false}));
assert.deepEqual(g.projectLayoutEdges(expandedGroups,edges,null).map(e=>[e.source,e.target]),[[outer,'d']]);
assert.deepEqual(g.projectLayoutEdges(groups,edges,null).map(e=>[e.source,e.target]),[[outer,'d']]);
assert.deepEqual(g.projectLayoutEdges(expandedGroups,edges,outer).map(e=>[e.source,e.target]),[[first,'c'],['c',first]]);
assert.deepEqual(g.projectLayoutEdges(expandedGroups,edges,first).map(e=>[e.source,e.target]),[['a','b']]);
const originalPositions=new Map([[outer,{x:80,y:90}],[first,{x:104,y:138}],['a',{x:128,y:186}],['b',{x:448,y:240}],['c',{x:760,y:220}],['d',{x:1200,y:300}]]);
for (const state of [groups,expandedGroups]) {
    const moved=g.translateGroupLayout(state,originalPositions,{[outer]:{x:500,y:600},d:{x:1400,y:600}});
    for(const id of [first,'a','b','c']) {
        assert.equal(moved[id].x-moved[outer].x,originalPositions.get(id).x-originalPositions.get(outer).x);
        assert.equal(moved[id].y-moved[outer].y,originalPositions.get(id).y-originalPositions.get(outer).y);
    }
    assert.deepEqual(moved.d,{x:1400,y:600});
}
const anchored=g.anchorGroupLayout({a:{x:0,y:20},b:{x:320,y:0}},[{position:{x:100,y:150}},{position:{x:500,y:180}}]);
assert.equal(Math.min(...Object.values(anchored).map(p=>p.x)),100);
assert.equal(Math.min(...Object.values(anchored).map(p=>p.y)),150);
assert.equal(anchored.b.x-anchored.a.x,320);
assert.deepEqual(g.anchorGroupLayout({},[]),{});
assert.deepEqual(g.projectLayoutEdges(cyclicGroups,[edge('a','d')],null),[]);
console.log('Group selection, nesting, migration, edge projection, and deep traversal tests passed');

const connectionCompiled = await build({ entryPoints: [fileURLToPath(new URL('../src/groupConnections.ts', import.meta.url))], bundle:true,write:false,format:'esm',platform:'node' });
const connections = await import(`data:text/javascript,${encodeURIComponent(connectionCompiled.outputFiles[0].text)}`);
const board = { id:'board',data:{ groups:[{id:'group-frame',title:'Group',members:['old-a','b'],rootTaskId:'old-a',collapsed:true}],
    edges:[edge('old-a','b')], layout:{'old-a':{x:10,y:20}}, collapsedNodes:{'old-a':true}, nodeStatus:{'old-a':'pending'} } };
const calls=[];
const plugin={settings:{boards:[board]},taskCache:new Map([['tasks.md',[{id:'old-a'},{id:'b'}]]]),
    ensureBlockId:async(_board,id)=>{calls.push(id);return id==='old-a'?'stable-a':id},
    saveSettings:async()=>{},saveBoardData:async(_board,data)=>Object.assign(board.data,data)};
await connections.ensureGraphObjectIds(plugin,'board',['old-a','group-frame']);
assert.deepEqual(calls,['old-a']);
assert.equal(board.data.groups[0].members[0],'stable-a');
assert.equal(board.data.groups[0].rootTaskId,'stable-a');
assert.equal(plugin.taskCache.get('tasks.md')[0].id,'stable-a');
assert.equal(board.data.edges[0].source,'stable-a');
assert.equal(board.data.nodeStatus['stable-a'],'pending');
assert.deepEqual(board.data.layout['stable-a'],{x:10,y:20});
await connections.connectGraphObjects(plugin,'board','group-frame','external',[]);
assert.equal(board.data.groups[0].collapsed,true);
assert.equal(board.data.edges[1].source,'group-frame');
await connections.connectGraphObjects(plugin,'board','group-frame','external',[]);
assert.equal(board.data.edges.length,2);
console.log('Stable member IDs and shared group connection tests passed');
