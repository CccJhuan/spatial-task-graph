import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { transform } from 'esbuild';

async function loadModule(name) {
    const source = await readFile(new URL(`../src/${name}.ts`, import.meta.url), 'utf8');
    const compiled = await transform(source, { loader: 'ts', format: 'esm', target: 'es2020' });
    return import(`data:text/javascript,${encodeURIComponent(compiled.code)}`);
}
const { hiddenDescendants, compactDescendants } = await loadModule('graphTraversal');
const { checklistRanges } = await loadModule('checklistRanges');
const { createFilterMatcher } = await loadModule('taskFilters');
const { SaveQueue } = await loadModule('saveQueue');
const { taskListsEqual } = await loadModule('taskCacheEquality');
const cached = [{ id: 'a', text: 'Task', notes: 'Note', line: 1, status: ' ', parentLine: 0 }];
assert.equal(taskListsEqual(cached, [{ ...cached[0] }]), true);
assert.equal(taskListsEqual(undefined, []), true);
assert.equal(taskListsEqual(cached, []), false);
for (const change of [{ text: 'Changed' }, { notes: 'Changed' }, { line: 2 }, { status: 'x' }, { parentLine: 3 }, { rawText: '#new' }]) {
    assert.equal(taskListsEqual(cached, [{ ...cached[0], ...change }]), false);
}

const tree = { a: ['b', 'c'], b: ['d'], c: ['d'], d: ['a'] };
assert.deepEqual([...hiddenDescendants(tree, new Set(['a']))].sort(), ['a', 'b', 'c', 'd']);
assert.deepEqual(compactDescendants(tree, 'a'), [{ id: 'b', depth: 1 }, { id: 'd', depth: 2 }, { id: 'c', depth: 1 }]);
assert.equal(hiddenDescendants(tree, new Set()).size, 0);
const deep = {};
for (let i = 0; i < 10000; i++) deep[String(i)] = [String(i + 1)];
assert.equal(compactDescendants(deep, '0').length, 10000);
assert.equal(hiddenDescendants(deep, new Set(['0'])).size, 10000);

function oldRanges(items, lines) {
    return items.map((item, i) => {
        const startLine = item.position.start.line;
        const nextLine = items[i + 1]?.position.start.line;
        const endLine = nextLine !== undefined && nextLine <= item.position.end.line ? nextLine - 1 : item.position.end.line;
        const indent = (lines[startLine].match(/^\s*/) || [''])[0].length;
        const child = items.slice(i + 1).find(next => next.task && next.position.start.line <= endLine
            && (lines[next.position.start.line].match(/^\s*/) || [''])[0].length > indent)?.position.start.line;
        return { startLine, endLine, notesStartLine: startLine + 1, notesEndLine: child === undefined ? endLine : child - 1 };
    });
}
for (let seed = 0; seed < 100; seed++) {
    const lines = Array.from({ length: 120 }, (_, i) => ' '.repeat((i * 7 + seed) % 8) + 'content');
    const items = Array.from({ length: 40 }, (_, i) => ({ task: (i + seed) % 3 ? ' ' : undefined,
        position: { start: { line: i * 3 }, end: { line: Math.min(119, i * 3 + (i + seed) % 20) } } }));
    const optimized = checklistRanges(items, lines);
    const old = oldRanges(items, lines);
    for (let i = 0; i < items.length; i++) if (items[i].task) assert.deepEqual(optimized[i], old[i]);
}
const matcher = createFilterMatcher([{ field: 'tag', value: 'task', enabled: true, operator: 'AND' },
    { field: 'path', value: 'Work/', enabled: true, operator: 'AND' }]);
assert.equal(matcher('#task', 'Work/a.md'), true);
assert.equal(matcher('#task-example', 'Work/a.md'), false);
assert.equal(matcher('#task', 'Home/a.md'), false);

let writes = 0;
let running = 0;
let maxRunning = 0;
let release;
const queue = new SaveQueue(async () => {
    writes++; running++; maxRunning = Math.max(maxRunning, running);
    await new Promise(resolve => { release = resolve; });
    running--;
});
const first = Array.from({ length: 100 }, () => queue.request());
await Promise.resolve();
assert.equal(writes, 1);
const second = Array.from({ length: 100 }, () => queue.request());
release();
await Promise.all(first);
assert.equal(writes, 2);
release();
await Promise.all(second);
assert.equal(maxRunning, 1);
let fail = true;
const recovery = new SaveQueue(async () => { if (fail) throw new Error('disk failure'); });
const failed = await Promise.allSettled([recovery.request(), recovery.request()]);
assert.equal(failed.every(result => result.status === 'rejected'), true);
fail = false;
await recovery.request();
console.log('Performance regression tests passed (10,000-level graph, parser parity, batched/ordered saves)');

if (process.argv.includes('--benchmark')) {
    const count = 3000;
    const parents = {};
    const children = {};
    for (let i = 1; i < count; i++) { parents[String(i)] = [String(i - 1)]; children[String(i - 1)] = [String(i)]; }
    const collapsed = new Set(['0']);
    const oldHidden = () => {
        const result = new Set();
        for (let i = 0; i < count; i++) {
            const seen = new Set();
            const walk = ids => {
                for (const id of ids) {
                    if (collapsed.has(id)) return true;
                    if (seen.has(id)) continue;
                    seen.add(id);
                    if (walk(parents[id] || [])) return true;
                }
                return false;
            };
            if (walk(parents[String(i)] || [])) result.add(String(i));
        }
        return result;
    };
    const start = performance.now();
    const old = oldHidden();
    const oldMs = performance.now() - start;
    const nextStart = performance.now();
    const next = hiddenDescendants(children, collapsed);
    const nextMs = performance.now() - nextStart;
    assert.deepEqual([...next].sort(), [...old].sort());
    console.log(`Hidden descendants (${count} chained tasks): before ${oldMs.toFixed(2)} ms, after ${nextMs.toFixed(2)} ms`);
    const items = Array.from({ length: 10000 }, (_, i) => ({ task: ' ', position: { start: { line: i }, end: { line: i } } }));
    const lines = items.map(() => '- [ ] task');
    const rangeStart = performance.now(); oldRanges(items, lines); const rangeOld = performance.now() - rangeStart;
    const rangeNext = performance.now(); checklistRanges(items, lines); const rangeNew = performance.now() - rangeNext;
    console.log(`Checklist ranges (10,000 tasks): before ${rangeOld.toFixed(2)} ms, after ${rangeNew.toFixed(2)} ms`);
    console.log('Synthetic algorithm measurements only; actual Obsidian UI latency is not measured.');
}
