import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

// dedup.js pulls in embeddings.js, which resolves its cache path from
// BRAIN_VAULT at import time — point it at a scratch directory before the
// (dynamic) import runs, same pattern as embeddings.test.js.
const tmpVault = fs.mkdtempSync(path.join(os.tmpdir(), 'second-brain-dedup-test-'));
process.on('exit', () => { try { fs.rmSync(tmpVault, { recursive: true, force: true }); } catch { /* best effort */ } });
process.env.BRAIN_VAULT = tmpVault;

const { findMostSimilarNode, judgeDuplicate, scanForDuplicates, DEDUP_SIMILARITY_THRESHOLD, DEFAULT_MAX_JUDGED } = await import('../sdk/dedup.js');
const { saveEmbeddingsCache } = await import('../sdk/embeddings.js');

function fakeEmbeddingResponse(vector) {
  return { data: [{ embedding: vector }] };
}

// ── findMostSimilarNode ───────────────────────────────────────────────────

test('findMostSimilarNode returns the closest existing node above the threshold', async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ json: async () => fakeEmbeddingResponse([1, 0, 0]) });
  t.after(() => { globalThis.fetch = originalFetch; });

  saveEmbeddingsCache({
    existingClose: { hash: 'h1', vector: [0.999, 0.001, 0], updatedAt: '' },
    existingFar:   { hash: 'h2', vector: [0, 1, 0], updatedAt: '' },
  });

  const nodes = {
    existingClose: { id: 'existingClose', type: 'memory', agent: 'research-agent', title: 'Close', content: 'x' },
    existingFar:   { id: 'existingFar',   type: 'memory', agent: 'research-agent', title: 'Far',   content: 'y' },
  };
  const candidate = { id: 'newNode', type: 'memory', agent: 'research-agent', title: 'New', content: 'z' };

  const match = await findMostSimilarNode(nodes, candidate, { openaiKey: 'test-key' });
  assert.ok(match, 'a match above threshold should be found');
  assert.equal(match.node.id, 'existingClose');
  assert.ok(match.similarity >= DEDUP_SIMILARITY_THRESHOLD);
});

test('findMostSimilarNode ignores nodes of a different type or agent', async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ json: async () => fakeEmbeddingResponse([1, 0, 0]) });
  t.after(() => { globalThis.fetch = originalFetch; });

  saveEmbeddingsCache({
    wrongType:  { hash: 'h1', vector: [1, 0, 0], updatedAt: '' },
    wrongAgent: { hash: 'h2', vector: [1, 0, 0], updatedAt: '' },
  });

  const nodes = {
    wrongType:  { id: 'wrongType',  type: 'task',   agent: 'research-agent', title: 'T',  content: 'x' },
    wrongAgent: { id: 'wrongAgent', type: 'memory', agent: 'pipeline-agent', title: 'T2', content: 'y' },
  };
  const candidate = { id: 'newNode', type: 'memory', agent: 'research-agent', title: 'New', content: 'z' };

  const match = await findMostSimilarNode(nodes, candidate, { openaiKey: 'test-key' });
  assert.equal(match, null);
});

test('findMostSimilarNode returns null below the similarity threshold', async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ json: async () => fakeEmbeddingResponse([1, 0, 0]) });
  t.after(() => { globalThis.fetch = originalFetch; });

  saveEmbeddingsCache({
    unrelated: { hash: 'h1', vector: [0, 1, 0], updatedAt: '' },
  });

  const nodes = {
    unrelated: { id: 'unrelated', type: 'memory', agent: 'research-agent', title: 'Unrelated', content: 'x' },
  };
  const candidate = { id: 'newNode', type: 'memory', agent: 'research-agent', title: 'New', content: 'z' };

  const match = await findMostSimilarNode(nodes, candidate, { openaiKey: 'test-key' });
  assert.equal(match, null);
});

// ── judgeDuplicate ────────────────────────────────────────────────────────

test('judgeDuplicate returns the LLM merge verdict when the judge approves a merge', async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    json: async () => ({ content: [{ text: JSON.stringify({ action: 'merge', title: 'Merged', content: 'Merged content', tags: ['a'] }) }] }),
  });
  t.after(() => { globalThis.fetch = originalFetch; });

  const verdict = await judgeDuplicate(
    { title: 'New', content: 'New content' },
    { title: 'Existing', content: 'Existing content' },
    { anthropicKey: 'test-key' },
  );
  assert.equal(verdict.action, 'merge');
  assert.equal(verdict.title, 'Merged');
});

test('judgeDuplicate fails open (keeps both) when the LLM call errors', async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('network down'); };
  t.after(() => { globalThis.fetch = originalFetch; });

  const verdict = await judgeDuplicate(
    { title: 'New', content: 'New content' },
    { title: 'Existing', content: 'Existing content' },
    { anthropicKey: 'test-key' },
  );
  assert.equal(verdict.action, 'keep');
});

// ── scanForDuplicates ─────────────────────────────────────────────────────

function scanFixture(count) {
  const cache = {};
  const nodes = {};
  for (let i = 0; i < count; i++) {
    const id = `n${i}`;
    // near-identical vectors, each slightly closer/farther so the order is deterministic
    cache[id] = { hash: `h${i}`, vector: [1, i * 0.0001, 0], updatedAt: '' };
    nodes[id] = { id, type: 'memory', agent: 'a', title: `Note ${i}`, content: `c${i}` };
  }
  saveEmbeddingsCache(cache);
  return nodes;
}

test('scanForDuplicates judges at most maxJudged pairs but still reports every candidate', async (t) => {
  const nodes = scanFixture(6); // 15 pairs, all above the threshold
  let llmCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { llmCalls++; return { json: async () => ({ content: [{ text: '{"action":"keep"}' }] }) }; };
  t.after(() => { globalThis.fetch = originalFetch; });

  const out = await scanForDuplicates(nodes, { llmKeys: { anthropicKey: 'k' }, maxJudged: 4 });
  assert.equal(out.length, 15);
  assert.equal(llmCalls, 4);
  assert.equal(out.filter(c => c.verdict).length, 4);
  assert.ok(out.every((c, i) => i === 0 || out[i - 1].similarity >= c.similarity), 'sorted most-similar first');
  assert.ok(out.slice(0, 4).every(c => c.verdict), 'the closest pairs are the ones judged');
  assert.ok(out.every(c => !('pair' in c)), 'internal node references are not leaked');
});

test('scanForDuplicates makes no LLM calls with judge:false, and the default cap is bounded', async (t) => {
  const nodes = scanFixture(10); // 45 pairs
  let llmCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { llmCalls++; return { json: async () => ({ content: [{ text: '{"action":"keep"}' }] }) }; };
  t.after(() => { globalThis.fetch = originalFetch; });

  assert.equal((await scanForDuplicates(nodes, { judge: false })).length, 45);
  assert.equal(llmCalls, 0);

  await scanForDuplicates(scanFixture(12), { llmKeys: { anthropicKey: 'k' } }); // 66 pairs
  assert.equal(llmCalls, DEFAULT_MAX_JUDGED);
});
