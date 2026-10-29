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
