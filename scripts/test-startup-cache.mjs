import assert from 'node:assert/strict';
import { build } from 'esbuild';
import process from 'node:process';

const fileBundle = await build({ stdin: { contents: 'export {default as Plugin} from "./src/main";export {TFile} from "obsidian";',
    resolveDir: process.cwd(), loader: 'ts' }, bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'host',setup(b){
        b.onResolve({filter:/^obsidian$/},()=>({path:'obsidian',namespace:'stub'}));
        b.onResolve({filter:/^\.\/(TaskGraphView|settings)$/},args=>({path:args.path,namespace:'stub'}));
        b.onLoad({filter:/.*/,namespace:'stub'},args=>({contents:args.path==='obsidian'?`
            export class Plugin { async loadData(){return null;} async saveData(){} }
            export class TFile { constructor(path){this.path=path;this.basename=path.slice(0,-3);this.extension='md';this.stat={mtime:1,size:30};} }
            export const debounce=fn=>fn;export class Notice{}
        `:args.path.endsWith('settings')?'export class TaskGraphSettingTab{}':'export class TaskGraphView{} export const VIEW_TYPE_TASK_GRAPH="graph";'}));
    }}] });
const host = await import(`data:text/javascript,${encodeURIComponent(fileBundle.outputFiles[0].text)}`);
globalThis.window = { setTimeout: () => 1, clearTimeout() {} };
let persisted = '';
let reads = 0;
const files = new Map();
const contents = new Map();
const metadata = new Map();
function add(path, text = '- [ ] Task') {
    const file = new host.TFile(path); files.set(path,file);contents.set(path,text);
    metadata.set(path,{listItems:[{task:' ',position:{start:{line:0},end:{line:0}}}]});
    return file;
}
function instance() {
    const p = new host.Plugin(); p.manifest={id:'graph',dir:'.obsidian/plugins/graph'};
    p.app={vault:{configDir:'.obsidian',getMarkdownFiles:()=>[...files.values()],getAbstractFileByPath:path=>files.get(path),
        cachedRead:async file=>{reads++;return contents.get(file.path);},adapter:{read:async()=>persisted,write:async(_path,raw)=>{persisted=raw;}}},
        metadataCache:{getFileCache:file=>metadata.get(file.path)}};
    return p;
}
async function start(force=false) { const p=instance();await p.loadSettings();await p.initializeCache(force);return p; }
async function save(p) { await p.snapshotWriter.request();p.onunload(); }
for(let i=0;i<1000;i++) add(`task-${i}.md`);
let p=await start();assert.equal(reads,1000);assert.equal(p.taskCache.size,1000);await save(p);
reads=0;p=await start();assert.equal(reads,0);assert.equal(p.taskCache.size,1000);
for (const file of files.values()) await p.updateFileCache(file);
assert.equal(reads,0);await save(p);
// Cached metadata events before layout initialization also avoid body reads.
reads=0;p=instance();await p.loadSettings();await p.loadSnapshot();
for (const file of files.values()) await p.updateFileCache(file);
assert.equal(reads,0);await p.initializeCache();assert.equal(p.taskCache.size,1000);await save(p);
files.get('task-0.md').stat.mtime++;
contents.set('task-0.md','- [ ] Updated');
files.get('task-1.md').stat.size++;
add('new.md');files.delete('task-2.md');
reads=0;p=await start();assert.equal(reads,3);assert.equal(p.taskCache.has('task-2.md'),false);
assert.equal(p.taskCache.get('task-0.md')[0].text,'Updated');assert.equal(p.taskCache.has('new.md'),true);await save(p);
reads=0;p=await start(true);assert.equal(reads,1000);await save(p);
reads=0;p=instance();await p.loadSettings();p.settings.taskNotes.enabled=true;await p.initializeCache();assert.equal(reads,1000);await save(p);
persisted='{broken';reads=0;p=await start();assert.equal(reads,1000);await save(p);
// Metadata that is not ready must not become a persisted empty result.
const delayed=add('delayed.md');metadata.delete(delayed.path);p=await start();
assert.equal(p.taskSnapshots.has(delayed.path),false);
metadata.set(delayed.path,{listItems:[{task:' ',position:{start:{line:0},end:{line:0}}}]});
await p.updateFileCache(delayed);assert.equal(p.taskCache.has(delayed.path),true);await save(p);
// A read overtaken by an edit cannot replace a newer parse or mark old text as current.
let release;const original=p.app.vault.cachedRead;
p.app.vault.cachedRead=()=>new Promise(resolve=>{release=resolve;});
delayed.stat.mtime++;
const old=p.updateFileCache(delayed);
delayed.stat.mtime++;contents.set(delayed.path,'- [ ] Newest');
p.app.vault.cachedRead=original;await p.updateFileCache(delayed);release('- [ ] Old');await old;
assert.equal(p.taskCache.get(delayed.path)[0].text,'Newest');await save(p);
delete globalThis.window;
console.log('Startup cache passed: 1000 unchanged task files require 0 content reads; changes, additions, deletions, rebuilds, config, corruption, metadata readiness, and overlapping reads verified.');
