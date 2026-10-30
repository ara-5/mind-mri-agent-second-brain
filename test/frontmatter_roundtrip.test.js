import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpVault = fs.mkdtempSync(path.join(os.tmpdir(), 'second-brain-frontmatter-test-'));
process.on('exit', () => { try { fs.rmSync(tmpVault, { recursive: true, force: true }); } catch { /* best effort */ } });
process.env.BRAIN_VAULT = tmpVault;

const { writeNode, updateNodeFile, loadVault } = await import('../api/brain_engine.js');

test('frontmatter round-trips tricky tag and agent values', () => {
  const id = writeNode({
    title: 'Roundtrip',
    type: 'memory',
    content: 'body',
    agent: '123',
    tags: ['plain', 'has, comma', '42', 'say "hi"', '[bracket]'],
  });
  const filePath = path.join(tmpVault, `${id}.md`);
  // A metadata-only patch rewrites the frontmatter through build/parse again.
  updateNodeFile(filePath, { meta: { lastAccessedAt: '2026-09-29' } });

  const node = loadVault()[id];
  assert.equal(node.agent, '123');
  for (const t of ['plain', 'has, comma', '42', 'say "hi"', '[bracket]']) {
    assert.ok(node.tags.includes(t), `missing tag ${JSON.stringify(t)}; got ${JSON.stringify(node.tags)}`);
  }
});

test('legacy unquoted frontmatter still parses', () => {
  fs.writeFileSync(path.join(tmpVault, 'legacy.md'),
    '---\ntype: memory\nagent: bot\nimportance: 7\ntags: [a, b]\n---\n# legacy\n\nhi\n');
  const node = loadVault()['legacy'];
  assert.equal(node.agent, 'bot');
  assert.equal(node.importance, 7);
  assert.ok(node.tags.includes('a') && node.tags.includes('b'));
});
