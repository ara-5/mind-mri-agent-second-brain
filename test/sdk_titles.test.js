import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SecondBrain } from '../sdk/index.js';

function captureRemember(t) {
  const sent = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    sent.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({ success: true, id: 'x' }) };
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  return sent;
}

test('remember() normalizes titles the server would reject (colons, slashes, newlines)', async (t) => {
  const sent = captureRemember(t);
  const brain = new SecondBrain({ agent: 'a', silent: true });
  await brain.remember('x', { title: 'Research: AI Tools / Reddit?\nDemand' });
  assert.equal(sent[0].title, 'Research- AI Tools - Reddit- Demand');
  assert.ok(!/[<>:"/\|?*\u0000-\u001f]/.test(sent[0].title));
});

test('remember() without a title uses a filename-safe default (no locale-date slashes)', async (t) => {
  const sent = captureRemember(t);
  const brain = new SecondBrain({ agent: 'a', silent: true });
  await brain.remember('x');
  assert.match(sent[0].title, /^Memory . \d{4}-\d{2}-\d{2}$/);
});

test('remember() strips trailing periods/spaces and caps the title at 200 characters', async (t) => {
  const sent = captureRemember(t);
  const brain = new SecondBrain({ agent: 'a', silent: true });
  await brain.remember('x', { title: 'Task - fix the build.' });
  await brain.remember('x', { title: `${'a'.repeat(250)}.` });
  await brain.remember('x', { title: 'ends with dots...   ' });
  assert.equal(sent[0].title, 'Task - fix the build');
  assert.equal(sent[1].title.length, 200);
  assert.equal(sent[2].title, 'ends with dots');
  for (const s of sent) assert.ok(!/[. ]$/.test(s.title));
});
