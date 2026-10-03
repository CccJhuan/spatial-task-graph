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
