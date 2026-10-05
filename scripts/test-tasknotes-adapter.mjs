import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';

const source = await readFile(new URL('../src/tasknotesAdapter.ts', import.meta.url), 'utf8');
const compiled = await transform(source, { loader: 'ts', format: 'esm', target: 'es2020' });
const adapter = await import(`data:text/javascript,${encodeURIComponent(compiled.code)}`);

const settings = {
  enabled: true, identificationMethod: 'tag', taskTag: 'tasks', propertyName: '', propertyValue: '',
  titleProperty: 'title', statusProperty: 'status', backlogStatuses: 'open,todo',
  inProgressStatuses: 'in-progress,doing', finishedStatuses: 'done,completed'
};

assert.equal(adapter.matchesTaskNotesIdentifier({ tags: ['project/x', '#tasks'] }, settings), true);
assert.equal(adapter.matchesTaskNotesIdentifier({ tags: 'other' }, settings), false);
assert.deepEqual(adapter.frontmatterTags(['#task', 'project/x']), ['task', 'project/x']);
assert.deepEqual(adapter.parseTaskNotesFrontmatter({ tags: ['tasks'], title: 'Ship it', status: 'in-progress' }, settings, 'fallback', 'Details'), {
  title: 'Ship it', status: 'in-progress', category: 'in_progress', notes: 'Details'
});
assert.equal(adapter.parseTaskNotesFrontmatter({ tags: ['tasks'] }, settings, 'fallback', '')?.status, 'open');
assert.equal(adapter.taskNotesStatusCategory('cancelled', settings), 'backlog');
assert.equal(adapter.matchesTaskNotesIdentifier({ type: true }, { ...settings, identificationMethod: 'property', propertyName: 'type', propertyValue: 'true' }), true);
assert.equal(adapter.parseTaskNotesFrontmatter({ tags: ['tasks'], status: 'done' }, { ...settings, titleProperty: 'name' }, 'fallback', '')?.title, 'fallback');

console.log('TaskNotes adapter tests passed');

const hierarchySource = await readFile(new URL('../src/taskHierarchy.ts', import.meta.url), 'utf8');
const hierarchyCompiled = await transform(hierarchySource, { loader: 'ts', format: 'esm', target: 'es2020' });
const { synchronizeHierarchy } = await import(`data:text/javascript,${encodeURIComponent(hierarchyCompiled.code)}`);
const tasks = [
  { id: 'a', path: 'tasks.md', line: 0, source: 'checklist' },
  { id: 'b', path: 'tasks.md', line: 1, parentLine: 0, source: 'checklist' },
  { id: 'c', path: 'tasks.md', line: 2, parentLine: 1, source: 'checklist' },
  { id: 'note', path: 'tasks.md', line: 3, parentLine: 0, source: 'tasknotes' }
];
const manual = { id: 'manual', source: 'c', target: 'a' };
const initial = synchronizeHierarchy(tasks, [manual]);
assert.equal(initial.added, 2);
assert.equal(initial.edges.some(edge => edge.target === 'note'), false);
assert.deepEqual(synchronizeHierarchy(tasks, initial.edges), { edges: initial.edges, added: 0, removed: 0 });
const moved = tasks.map(task => task.id === 'c' ? { ...task, parentLine: 0 } : task);
const updated = synchronizeHierarchy(moved, initial.edges);
assert.equal(updated.added, 1);
assert.equal(updated.removed, 1);
assert.equal(updated.edges.some(edge => edge.source === 'b' && edge.target === 'c'), false);
assert.equal(updated.edges.some(edge => edge.source === 'a' && edge.target === 'c'), true);
assert.equal(updated.edges.includes(manual), true);
assert.equal(synchronizeHierarchy(tasks.map(task => ({ ...task, parentLine: undefined })), updated.edges).removed, 2);
const untracked = { id: 'legacy', source: 'b', target: 'c' };
assert.equal(synchronizeHierarchy(moved, [untracked]).edges.includes(untracked), true);
const overlap = synchronizeHierarchy(tasks, [{ id: 'manual-parent', source: 'a', target: 'b' }]);
assert.equal(overlap.edges.filter(edge => edge.source === 'a' && edge.target === 'b').length, 1);
console.log('Hierarchy synchronization tests passed');

const filtersSource = await readFile(new URL('../src/taskFilters.ts', import.meta.url), 'utf8');
const filtersCompiled = await transform(filtersSource, { loader: 'ts', format: 'esm', target: 'es2020' });
const { getFilterConditions, matchesFilterConditions, filterSuggestions } = await import(`data:text/javascript,${encodeURIComponent(filtersCompiled.code)}`);
const condition = (field, value, operator = 'AND', enabled = true) => ({ field, value, operator, enabled });
assert.deepEqual(filterSuggestions(['#task-example', '#project/test'], 'example'), ['#task-example']);
assert.deepEqual(filterSuggestions(['#task-example', '#project/test'], '#test'), ['#project/test']);
assert.equal(matchesFilterConditions('#task-example', 'Work/a.md', [condition('tag', 'task-example')]), true);
assert.equal(matchesFilterConditions('#task-example', 'Work/a.md', [condition('tag', 'task')]), false);
assert.equal(matchesFilterConditions('#task-example', 'Work/a.md', [condition('tag', 'task-example'), condition('path', 'Work')]), true);
assert.equal(matchesFilterConditions('#task-example', 'Home/a.md', [condition('tag', 'task-example'), condition('path', 'Work')]), false);
assert.equal(matchesFilterConditions('#other', 'Work/a.md', [condition('tag', 'task-example'), condition('path', 'Work', 'OR')]), true);
assert.equal(matchesFilterConditions('#other', 'Home/a.md', [condition('tag', 'task-example', 'AND', false)]), true);
assert.equal(matchesFilterConditions('', 'Work-other/a.md', [condition('path', 'Work')]), false);
assert.equal(matchesFilterConditions('', 'Work/a.md', [condition('path', 'Work/a.md')]), true);
assert.equal(matchesFilterConditions('', 'Work/b.md', [condition('path', 'Work/a.md')]), false);
const legacy = getFilterConditions({ tags: ['#a', '#b'], folders: ['Work', 'Home'], tagMode: 'AND' });
assert.equal(matchesFilterConditions('#a #b', 'Home/a.md', legacy), true);
assert.equal(matchesFilterConditions('#a', 'Home/a.md', legacy), false);
assert.equal(matchesFilterConditions('#b', 'Home/a.md', getFilterConditions({ tags: ['#a', '#b'], folders: ['Home'], tagMode: 'OR' })), true);
assert.equal(matchesFilterConditions('', 'Work/a.md', [condition('tag', 'missing'), condition('path', 'Work', 'OR'), condition('tag', 'required')]), false);
console.log('Filter condition tests passed');

const navigationSource = (await readFile(new URL('../src/taskNavigation.ts', import.meta.url), 'utf8'))
  .replace("import { TFile } from 'obsidian';", 'export class TFile {}');
const navigationCompiled = await transform(navigationSource, { loader: 'ts', format: 'esm', target: 'es2020' });
const navigation = await import(`data:text/javascript,${encodeURIComponent(navigationCompiled.code)}`);
const opened = [];
const mockApp = {
  vault: { getAbstractFileByPath: () => new navigation.TFile() },
  metadataCache: { getFileCache: () => ({ blocks: { stable: { position: { start: { line: 42 } } } } }) },
  workspace: { openLinkText: async (...args) => { opened.push(args); } }
};
await navigation.openTaskLocation(mockApp, { id: 'tasks.md::^stable', path: 'tasks.md', line: 3, source: 'checklist' });
assert.equal(opened[0][0], 'tasks.md#^stable');
assert.equal(opened[0][3].eState.line, 42);
await navigation.openTaskLocation(mockApp, { id: 'tasks.md::#plain', path: 'tasks.md', line: 7, source: 'checklist' });
assert.equal(opened[1][0], 'tasks.md');
assert.equal(opened[1][3].eState.line, 7);
await navigation.openTaskLocation(mockApp, { id: 'note.md', path: 'note.md', line: -1, source: 'tasknotes' });
assert.equal(opened[2][0], 'note.md');
assert.equal(opened[2][3].eState.line, 0);
console.log('Task navigation tests passed');

