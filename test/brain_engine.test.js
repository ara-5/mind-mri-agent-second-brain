import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

// brain_engine.js resolves VAULT_DIR from BRAIN_VAULT at import time, same
// pattern as embeddings.test.js/search_hybrid.test.js.
const tmpVault = fs.mkdtempSync(path.join(os.tmpdir(), 'second-brain-brain-engine-test-'));
process.env.BRAIN_VAULT = tmpVault;

const { writeNode, updateNodeFile, validateNode } = await import('../api/brain_engine.js');

test('updateNodeFile does not duplicate the H1 heading on a metadata-only patch', () => {
  const id = writeNode({
    title: 'Rate Limiting Notes',
    type: 'memory',
    content: 'Token bucket beats fixed window for bursty traffic.',
    agent: 'test',
  });
  const filePath = path.join(tmpVault, `${id}.md`);

  // A metadata-only patch (no title, no content) — e.g. /recall's passive
  // lastAccessedAt touch — must not alter the body at all.
  updateNodeFile(filePath, { meta: { lastAccessedAt: '2026-09-29' } });

  const raw = fs.readFileSync(filePath, 'utf8');
  const body = raw.split(/\r?\n---\r?\n/).pop();
  const headingCount = (body.match(/^# /gm) || []).length;

  assert.equal(headingCount, 1, `expected exactly one heading, got:\n${body}`);
  assert.match(body, /^# Rate Limiting Notes\n\nToken bucket beats fixed window for bursty traffic\.\s*$/);
});

test('updateNodeFile preserves a node\'s real heading on a metadata-only patch, even when it differs from the filename', () => {
  // Simulates a node whose filename doesn't match its real heading (special
  // characters sanitized out of the filename, or the file predates a naming
  // convention change) — a scenario writeNode() itself can't produce, so the
  // fixture is written directly.
  const filePath = path.join(tmpVault, 'Project_Alpha_Notes.md');
  fs.writeFileSync(filePath,
    '---\ntype: memory\ntags: []\nagent: test\ncreatedAt: 2026-06-18\nlastAccessedAt: 2026-06-18\nimportance: 5\nversion: 1\n---\n' +
    '# Project Alpha: Launch Readiness Review 🚀\n\nFinal checklist before shipping.'
  );

  updateNodeFile(filePath, { meta: { lastAccessedAt: '2026-09-29' } });

  const raw = fs.readFileSync(filePath, 'utf8');
  const body = raw.split(/\r?\n---\r?\n/).pop();

  assert.match(body, /^# Project Alpha: Launch Readiness Review/,
    'the real heading must survive a metadata-only patch instead of being replaced by the bare filename');
});

test('updateNodeFile still updates content correctly on a real content edit', () => {
  const id = writeNode({
    title: 'Second Node',
    type: 'memory',
    content: 'Original body.',
    agent: 'test',
  });
  const filePath = path.join(tmpVault, `${id}.md`);

  updateNodeFile(filePath, { content: 'Updated body.' });

  const raw = fs.readFileSync(filePath, 'utf8');
  const body = raw.split(/\r?\n---\r?\n/).pop();
  const headingCount = (body.match(/^# /gm) || []).length;

  assert.equal(headingCount, 1, `expected exactly one heading, got:\n${body}`);
  assert.match(body, /^# Second Node\n\nUpdated body\.\s*$/);
});

test('old but relevant notes remain searchable (recency re-ranks, never hides)', async () => {
  const id = writeNode({
    title: 'Ancient Idempotency Decision',
    type: 'decision',
    content: 'Use idempotency keys for payment retries.',
    agent: 'test',
  });
  const filePath = path.join(tmpVault, `${id}.md`);
  // Backdate well past several half-lives (default importance => 30 days).
  updateNodeFile(filePath, { meta: { createdAt: '2020-01-01', lastAccessedAt: '2020-01-01' } });

  const { loadVault, searchNodes } = await import('../api/brain_engine.js');
  const nodes = loadVault();
  const hits = searchNodes(nodes, 'idempotency payment');
  assert.ok(hits.some(h => h.id === id), 'a years-old relevant note must still be returned');
});

test('writeNode refuses a subdir that escapes the vault', () => {
  for (const subdir of ['../escape', '../../escape', 'agents/../../escape']) {
    assert.throws(
      () => writeNode({ title: 'Escape', type: 'memory', content: 'x', agent: 't' }, subdir),
      /Invalid subdir/,
      `subdir ${JSON.stringify(subdir)} should be rejected`
    );
  }
  assert.ok(!fs.existsSync(path.join(tmpVault, '..', 'escape', 'Escape.md')));
});

test('writeNode never overwrites an existing note that shares a title', () => {
  const first = writeNode({ title: 'Same Title', type: 'memory', content: 'first', agent: 't' });
  const second = writeNode({ title: 'Same Title', type: 'memory', content: 'second', agent: 't' });
  assert.notEqual(first, second);
  assert.match(fs.readFileSync(path.join(tmpVault, `${first}.md`), 'utf8'), /first/);
  assert.match(fs.readFileSync(path.join(tmpVault, `${second}.md`), 'utf8'), /second/);
});

test('validateNode rejects control characters in a title', () => {
  assert.equal(validateNode({ title: 'a\nb' }).valid, false);
  assert.equal(validateNode({ title: 'fine title' }).valid, true);
});
