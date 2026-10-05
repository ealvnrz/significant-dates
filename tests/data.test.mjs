import test from 'node:test';
import assert from 'node:assert/strict';
import { validateEntries, loadEntries } from '../tools/data.mjs';

const base = { id: 'example-2027', name: 'Example', start: '2027-06-01', end: '2027-06-03',
  region: 'Europe', format: 'in-person', lat: 48, lon: 2, url: 'https://example.org',
  source: 'https://example.org/dates', checked: '2026-10-02', deadlineStatus: 'unknown', deadlines: [] };
const validate = entry => validateEntries([entry], '2026-10-05');
test('the complete catalogue conforms to the same schema as the build', async () => {
  assert.ok((await loadEntries()).length > 0);
});
test('invalid literal dates cannot silently roll into the next month', () => {
  assert.throws(() => validate({ ...base, start: '2027-02-30' }));
});
test('duplicate IDs and unsafe IDs are rejected', () => {
  assert.throws(() => validateEntries([base, base]), /Duplicate conference id/);
  assert.throws(() => validate({ ...base, id: 'bad id' }), /stable lowercase id/);
});
test('published requires dated records; unknown and unannounced cannot hide recorded deadlines', () => {
  assert.throws(() => validate({ ...base, deadlineStatus: 'published' }));
  assert.throws(() => validate({ ...base, deadlines: [{ label: 'Submit', date: '2027-03-01', types: ['submission'] }] }));
  assert.throws(() => validate({ ...base, deadlineStatus: 'not-announced' }));
  assert.doesNotThrow(() => validate({ ...base, deadlineStatus: 'not-announced', note: 'The official page says dates will be announced.' }));
});
test('every deadline needs a supported category', () => {
  for (const types of [undefined, [], ['unknown'], ['submission', 'submission']]) {
    assert.throws(() => validate({ ...base, deadlineStatus: 'published', deadlines: [{ label: 'Submit', date: '2027-03-01', types }] }));
  }
});
test('dates, coordinates and evidence must be coherent', () => {
  for (const override of [{ end: '2027-05-01' }, { lon: null }, { checked: undefined }, { source: undefined }, { checked: '2026-10-06' },
    { deadlineStatus: 'published', deadlines: [{ label: 'Submit', date: '2027-06-04', types: ['submission'] }] }]) {
    assert.throws(() => validate({ ...base, ...override }));
  }
});
