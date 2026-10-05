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

