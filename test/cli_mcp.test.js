import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Port 1 is never listening, so these tests can never reach a real vault.
const DEAD_API = 'http://127.0.0.1:1';

function cli(...args) {
  return spawnSync(process.execPath, [path.join(ROOT, 'sdk', 'cli.js'), ...args], {
    encoding: 'utf8', timeout: 20_000, env: { ...process.env, BRAIN_API: DEAD_API, BRAIN_KEY: '' },
  });
}

test('cli search reports the failure instead of "Found 0 nodes" when the server is unreachable', () => {
  const r = cli('search', 'anything');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /search failed/);
  assert.doesNotMatch(r.stdout, /Found 0 nodes/);
});

test('cli recall exits non-zero with the reason when the server is unreachable', () => {
  const r = cli('recall', 'anything');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /recall failed/);
});

test('cli rejects non-numeric and negative numeric flags before contacting the server', () => {
  for (const flag of ['--limit=abc', '--limit=-1', '--limit=']) {
    const r = cli('search', 'x', flag);
    assert.equal(r.status, 1, flag);
    assert.match(r.stderr, /--limit must be a non-negative integer/, flag);
  }
  const r = cli('recall', 'x', '--hops=1.5');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--hops must be a non-negative integer/);
});

test('cli prints a plain error, not a stack trace, when a client call throws', () => {
  const r = cli('tasks', 'submit', 'do a thing');
  assert.equal(r.status, 1);
  assert.doesNotMatch(r.stderr, /\n\s+at /);
});

test('open_ui refuses an invalid BRAIN_PORT instead of passing it to a shell', () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'sdk', 'open_ui.js')], {
    encoding: 'utf8', timeout: 20_000, env: { ...process.env, BRAIN_PORT: '1;calc' },
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Refusing to open/);
});

test('mcp tools/call rejects missing required arguments instead of sending "undefined"', () => {
  const input = [
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'brain_search', arguments: null } },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'brain_node_get', arguments: {} } },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'brain_remember', arguments: { title: 't' } } },
  ].map(m => JSON.stringify(m)).join('\n') + '\n';
  const r = spawnSync(process.execPath, [path.join(ROOT, 'mcp', 'server.js')], {
    input, encoding: 'utf8', timeout: 20_000, env: { ...process.env, BRAIN_PORT: '1' },
  });
  const replies = r.stdout.trim().split('\n').map(l => JSON.parse(l));
  assert.equal(replies.length, 3);
  for (const reply of replies) {
    assert.equal(reply.result.isError, true);
    assert.match(reply.result.content[0].text, /missing required argument/);
  }
  assert.match(replies[0].result.content[0].text, /query/);
  assert.match(replies[1].result.content[0].text, /id/);
  assert.match(replies[2].result.content[0].text, /content/);
});

function rawMcp(input) {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'mcp', 'server.js')], {
    input, encoding: 'utf8', timeout: 20_000, env: { ...process.env, BRAIN_PORT: '1' },
  });
  return r.stdout.trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
}

test('mcp: unparseable input gets a JSON-RPC parse error instead of silence', () => {
  const out = rawMcp('{not json\n[1,2]\n"str"\n');
  assert.equal(out.length, 3);
  assert.equal(out[0].error.code, -32700);
  assert.equal(out[0].id, null);
  assert.equal(out[1].error.code, -32600);
  assert.equal(out[2].error.code, -32600);
});

test('mcp: a final message without a trailing newline is still handled', () => {
  const out = rawMcp('{"jsonrpc":"2.0","id":7,"method":"ping"}');
  assert.deepEqual(out, [{ jsonrpc: '2.0', id: 7, result: {} }]);
});

test('mcp: responses from the client are ignored; malformed requests get -32600', () => {
  const out = rawMcp([
    '{"jsonrpc":"2.0","id":1,"result":{}}',
    '{"jsonrpc":"2.0","id":2,"error":{"code":1,"message":"x"}}',
    '{"jsonrpc":"2.0","id":3}',
    '{"jsonrpc":"2.0","id":4,"method":"nope/nothing"}',
  ].join('\n') + '\n');
  assert.equal(out.length, 2);
  assert.equal(out[0].id, 3);
  assert.equal(out[0].error.code, -32600);
  assert.equal(out[1].id, 4);
  assert.equal(out[1].error.code, -32601);
});

test('mcp: initialize negotiates the protocol version and ships instructions', () => {
  const out = rawMcp([
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26"}}',
    '{"jsonrpc":"2.0","id":2,"method":"initialize","params":{"protocolVersion":"1999-01-01"}}',
    '{"jsonrpc":"2.0","id":3,"method":"tools/list"}',
  ].join('\n') + '\n');
  assert.equal(out[0].result.protocolVersion, '2025-03-26');
  assert.equal(out[1].result.protocolVersion, '2025-11-25');
  assert.match(out[0].result.instructions, /brain_recall/);
  assert.ok(out[2].result.tools.every(t => t.title && t.annotations));
});
