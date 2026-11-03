import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

test('package.json: bins exist, are executable scripts, and npx can pick one by package name', () => {
  assert.ok(pkg.bin[pkg.name], 'a bin named like the package lets `npx <name>` run the MCP server');
  for (const rel of Object.values(pkg.bin)) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.ok(src.startsWith('#!/usr/bin/env node'), `${rel} needs a node shebang`);
  }
  for (const entry of pkg.files) assert.ok(fs.existsSync(path.join(ROOT, entry)), `files entry ${entry} is missing`);
  assert.ok(pkg.repository?.url && pkg.mcpName);
});

test('server.json matches package.json', () => {
  const server = JSON.parse(fs.readFileSync(path.join(ROOT, 'server.json'), 'utf8'));
  assert.equal(server.name, pkg.mcpName);
  assert.equal(server.version, pkg.version);
  assert.equal(server.packages[0].identifier, pkg.name);
  assert.equal(server.packages[0].version, pkg.version);
  assert.ok(server.description.length <= 100, 'registry descriptions are capped at 100 characters');
});

let apiProc;
let port;
let vault;

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const { port: p } = s.address(); s.close(() => resolve(p)); });
    s.on('error', reject);
  });
}

before(async () => {
  port = await freePort();
  vault = fs.mkdtempSync(path.join(os.tmpdir(), 'second-brain-mcp-test-'));
  apiProc = spawn(process.execPath, ['api/server.js'], {
    cwd: ROOT, stdio: 'ignore',
    env: { ...process.env, BRAIN_PORT: String(port), BRAIN_VAULT: vault, BRAIN_KEY: '', SANDBOX_WORKSPACE: path.join(vault, '.sandbox') },
  });
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('test API server did not start');
});

after(async () => {
  if (apiProc && apiProc.exitCode === null) {
    const exited = new Promise((resolve) => apiProc.once('exit', resolve));
    apiProc.kill();
    await exited;
  }
  // Windows can still hold the folder for a moment after the process exits, and
  // a leftover temp folder must not fail the suite.
  try { fs.rmSync(vault, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* best effort */ }
});

function mcp(messages) {
  const input = messages.map((m, i) => JSON.stringify({ jsonrpc: '2.0', id: i + 1, ...m })).join('\n') + '\n';
  const r = spawnSync(process.execPath, [path.join(ROOT, 'mcp', 'server.js')], {
    input, encoding: 'utf8', timeout: 30_000,
    env: { ...process.env, BRAIN_PORT: String(port), BRAIN_VAULT: vault, BRAIN_KEY: '' },
  });
  return r.stdout.trim().split('\n').map((l) => JSON.parse(l));
}

const call = (name, args) => ({ method: 'tools/call', params: { name, arguments: args } });
const text = (reply) => JSON.parse(reply.result.content[0].text);

test('initialize reports the package version; every tool has annotations', () => {
  const [init, list] = mcp([{ method: 'initialize', params: {} }, { method: 'tools/list' }]);
  assert.equal(init.result.serverInfo.version, pkg.version);
  const tools = list.result.tools;
  assert.ok(tools.find((t) => t.name === 'brain_messages_mark_read'));
  for (const t of tools) {
    assert.equal(typeof t.annotations.readOnlyHint, 'boolean', t.name);
    assert.equal(t.annotations.destructiveHint, t.name === 'brain_node_update', t.name);
  }
  assert.equal(tools.find((t) => t.name === 'brain_search').annotations.readOnlyHint, true);
  assert.equal(tools.find((t) => t.name === 'brain_remember').annotations.readOnlyHint, false);
});

test('messages: send, read inbox, mark read, inbox empties', () => {
  const [sent] = mcp([call('brain_messages_send', { toAgent: 'qa-bot', fromAgent: 'dev-bot', content: 'ping', subject: 'Hello' })]);
  const id = text(sent).id;
  assert.ok(id);

  const [inbox] = mcp([call('brain_messages_get', { agent: 'qa-bot' })]);
  assert.equal(text(inbox).count, 1);

  const [marked] = mcp([call('brain_messages_mark_read', { id })]);
  assert.equal(text(marked).success, true);

  const [after1] = mcp([call('brain_messages_get', { agent: 'qa-bot' })]);
  assert.equal(text(after1).count, 0);
  const [all] = mcp([call('brain_messages_get', { agent: 'qa-bot', unread: false })]);
  assert.equal(text(all).count, 1);
});

test('mark_read rejects unknown ids and non-message notes', async () => {
  const [missing] = mcp([call('brain_messages_mark_read', { id: 'messages/nobody/nope' })]);
  assert.equal(missing.result.isError, true);
  assert.match(missing.result.content[0].text, /not found/i);

  const [note] = mcp([call('brain_remember', { title: 'Plain note', content: 'not a message' })]);
  const noteId = text(note).id;
  const [wrong] = mcp([call('brain_messages_mark_read', { id: noteId })]);
  assert.equal(wrong.result.isError, true);

  const res = await fetch(`http://127.0.0.1:${port}/messages/read`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 42 }) });
  assert.equal(res.status, 400);
});

test('POST /dedup/scan validates threshold and maxJudged instead of flagging everything', async () => {
  const post = (body) => fetch(`http://127.0.0.1:${port}/dedup/scan`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  for (const threshold of ['abc', 0, -1, 1.5, null, [], {}]) {
    assert.equal((await post({ threshold, judge: false })).status, 400, `threshold ${JSON.stringify(threshold)}`);
  }
  for (const maxJudged of ['5', -1, 1.5, 1000]) {
    assert.equal((await post({ maxJudged, judge: false })).status, 400, `maxJudged ${JSON.stringify(maxJudged)}`);
  }
  assert.equal((await post({ threshold: 0.9, maxJudged: 3, judge: false })).status, 200);
  assert.equal((await post({ judge: false })).status, 200);
});

test('declared licence matches the LICENSE file', () => {
  const text = fs.readFileSync(path.join(ROOT, 'LICENSE'), 'utf8');
  assert.equal(pkg.license, 'MIT');
  assert.match(text, /^MIT License/);
  assert.match(text, /Permission is hereby granted, free of charge/);
});

test('brain_node_update: append keeps existing text, replace overwrites, tags and importance change', () => {
  const [made] = mcp([call('brain_remember', { title: 'Updatable', content: 'first line', tags: ['alpha'], importance: 3 })]);
  const id = text(made).id;

  const [appended] = mcp([call('brain_node_update', { id, content: 'second line' })]);
  assert.equal(text(appended).success, true);
  assert.equal(text(appended).mode, 'append');
  let [got] = mcp([call('brain_node_get', { id })]);
  let node = text(got);
  assert.ok(node.content.includes('first line') && node.content.includes('second line'));
  assert.ok(node.content.indexOf('first line') < node.content.indexOf('second line'));
  assert.equal(node.version, 2);

  const [replaced] = mcp([call('brain_node_update', { id, content: 'only this now', mode: 'replace', tags: ['beta', 'gamma'], importance: 9 })]);
  assert.equal(text(replaced).success, true);
  [got] = mcp([call('brain_node_get', { id })]);
  node = text(got);
  assert.ok(node.content.includes('only this now'));
  assert.ok(!node.content.includes('first line') && !node.content.includes('second line'));
  assert.deepEqual([...node.tags].sort(), ['beta', 'gamma']);
  assert.equal(node.importance, 9);
  assert.equal(node.version, 3);

  // tags-only update leaves the body alone
  mcp([call('brain_node_update', { id, tags: ['delta'] })]);
  [got] = mcp([call('brain_node_get', { id })]);
  assert.ok(text(got).content.includes('only this now'));
  assert.deepEqual(text(got).tags, ['delta']);
});

test('brain_node_update: rejects bad input and unknown notes with a clear error', () => {
  const [made] = mcp([call('brain_remember', { title: 'Strict update', content: 'body' })]);
  const id = text(made).id;
  const cases = [
    [{ id }, /Nothing to update/],
    [{ id, content: 'x', mode: 'merge' }, /mode must be/],
    [{ id: 'agents/nobody/missing', content: 'x' }, /not found/i],
    [{ id, tags: 'not-an-array' }, /tags|Validation/i],
    [{ id, importance: 99 }, /importance|Validation/i],
  ];
  for (const [args, pattern] of cases) {
    const [reply] = mcp([call('brain_node_update', args)]);
    assert.equal(reply.result.isError, true, JSON.stringify(args));
    assert.match(reply.result.content[0].text, pattern, JSON.stringify(args));
  }
  const [got] = mcp([call('brain_node_get', { id })]);
  assert.ok(text(got).content.includes('body'), 'a rejected update must not change the note');
});

test('brain_node_update: concurrent appends are all kept (no lost updates)', async () => {
  const [made] = mcp([call('brain_remember', { title: 'Race target', content: 'base' })]);
  const id = text(made).id;
  // Separate MCP processes writing at the same moment, like several agents.
  const runs = Array.from({ length: 4 }, (_, i) => new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'mcp', 'server.js')], {
      stdio: ['pipe', 'pipe', 'ignore'],
      env: { ...process.env, BRAIN_PORT: String(port), BRAIN_VAULT: vault, BRAIN_KEY: '' },
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.on('close', () => resolve(JSON.parse(out.trim().split(String.fromCharCode(10))[0])));
    child.stdin.end(JSON.stringify({ jsonrpc: '2.0', id: 1, ...call('brain_node_update', { id, content: `appended-${i}` }) }) + String.fromCharCode(10));
  }));
  const replies = await Promise.all(runs);
  const ok = replies.filter((r) => !r.result.isError).length;
  const [got] = mcp([call('brain_node_get', { id })]);
  const body = text(got).content;
  const kept = [0, 1, 2, 3].filter((i) => body.includes(`appended-${i}`)).length;
  assert.equal(kept, ok, `${ok} updates reported success but ${kept} are in the note`);
  assert.ok(ok >= 2, 'at least some concurrent updates succeed (a single retry cannot save every one)');
});

test('an oversized request gets a clear 413 (not a reset connection), and the server stays healthy', async () => {
  const big = JSON.stringify({ title: 'Too big', content: 'x'.repeat(2_600_000) });

  // 1. Content-Length is declared up front.
  const res = await fetch(`http://127.0.0.1:${port}/remember`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: big });
  assert.equal(res.status, 413);
  assert.match((await res.json()).error, /too large/i);

  // 2. Chunked upload: the size is only discovered while reading.
  const http = await import('node:http');
  const status = await new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/remember', method: 'POST', headers: { 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked' } }, (r) => {
      let data = '';
      r.on('data', (d) => { data += d; });
      r.on('end', () => resolve({ code: r.statusCode, data }));
    });
    req.on('error', reject);
    for (let i = 0; i < big.length; i += 100_000) req.write(big.slice(i, i + 100_000));
    req.end();
  });
  assert.equal(status.code, 413);
  assert.match(JSON.parse(status.data).error, /too large/i);

  assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status, 200);
  const small = await fetch(`http://127.0.0.1:${port}/remember`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'After big', content: 'ok' }) });
  assert.equal(small.status, 201);
});

test('brain_tasks_update: claim, complete with a result, release a dependent, keep the prompt', () => {
  const [a] = mcp([call('brain_tasks_submit', { prompt: 'Step one: write the migration', title: 'Lifecycle A' })]);
  const aId = text(a).nodeId;
  const [b] = mcp([call('brain_tasks_submit', { prompt: 'Step two: run it', title: 'Lifecycle B', dependencies: [aId] })]);
  assert.equal(text(b).status, 'blocked');

  const [running] = mcp([call('brain_tasks_update', { id: aId, status: 'running' })]);
  assert.equal(text(running).success, true);
  assert.equal(text(running).releasedDependents, 0);

  const [done] = mcp([call('brain_tasks_update', { id: aId, status: 'completed', result: 'Migration written in db/001.sql' })]);
  assert.equal(text(done).success, true);
  assert.equal(text(done).releasedDependents, 1);

  const [got] = mcp([call('brain_node_get', { id: aId })]);
  const node = text(got);
  assert.ok(node.tags.includes('completed') && !node.tags.includes('running'));
  assert.ok(node.content.includes('Step one: write the migration'), 'the prompt must survive');
  assert.ok(node.content.includes('Migration written in db/001.sql'), 'the result must be recorded');
  assert.match(node.content, /status: completed/);

  const [pending] = mcp([call('brain_tasks_list', { status: 'pending' })]);
  assert.ok(text(pending).tasks.some((t) => t.title === 'Lifecycle B'), 'the dependent should now be pending');
  const [blocked] = mcp([call('brain_tasks_list', { status: 'blocked' })]);
  assert.ok(!text(blocked).tasks.some((t) => t.title === 'Lifecycle B'));

  // a second result replaces the first; the status call is repeatable
  mcp([call('brain_tasks_update', { id: aId, status: 'completed', result: 'Revised outcome' })]);
  const [again] = mcp([call('brain_node_get', { id: aId })]);
  assert.ok(text(again).content.includes('Revised outcome') && !text(again).content.includes('db/001.sql'));
});

test('brain_tasks_update: a failed dependency fails its dependents', () => {
  const [c] = mcp([call('brain_tasks_submit', { prompt: 'Risky step', title: 'Cascade C' })]);
  const cId = text(c).nodeId;
  const [d] = mcp([call('brain_tasks_submit', { prompt: 'Needs C', title: 'Cascade D', dependencies: [cId] })]);
  const dId = text(d).nodeId;
  mcp([call('brain_tasks_update', { id: cId, status: 'failed', result: 'It broke' })]);
  const [got] = mcp([call('brain_node_get', { id: dId })]);
  assert.ok(text(got).tags.includes('failed'), 'the dependent should be failed, not left blocked forever');
});

test('brain_tasks_update refuses ids that are not tasks and leaves those notes untouched', async () => {
  const [made] = mcp([call('brain_remember', { title: 'Not a task note', content: 'plain note', tags: ['keep-me'] })]);
  const id = text(made).id;
  const [reply] = mcp([call('brain_tasks_update', { id, status: 'completed' })]);
  assert.equal(reply.result.isError, true);
  assert.match(reply.result.content[0].text, /Task not found/);
  const [missing] = mcp([call('brain_tasks_update', { id: 'tasks/does-not-exist', status: 'completed' })]);
  assert.equal(missing.result.isError, true);
  const [after] = mcp([call('brain_node_get', { id })]);
  assert.deepEqual(text(after).tags, ['keep-me'], 'a rejected update must not retag the note');

  const bad = await fetch(`http://127.0.0.1:${port}/tasks/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'completed', result: 42 }) });
  assert.equal(bad.status, 400);
  const [badStatus] = mcp([call('brain_tasks_update', { id: 'tasks/x', status: 'finished' })]);
  assert.equal(badStatus.result.isError, true);
});

test('/health reports an opaque vault id, and an MCP server configured for another vault is refused', async () => {
  const { vaultIdFor } = await import('../sdk/vault_id.js');
  const health = await (await fetch(`http://127.0.0.1:${port}/health`)).json();
  assert.equal(health.vaultId, vaultIdFor(vault));
  assert.ok(!JSON.stringify(health).includes(vault), 'health must not leak the absolute vault path');

  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'second-brain-other-vault-'));
  const run = spawnSync(process.execPath, [path.join(ROOT, 'mcp', 'server.js')], {
    input: JSON.stringify({ jsonrpc: '2.0', id: 1, ...call('brain_remember', { title: 'Must not be written', content: 'wrong vault' }) }) + '\n',
    encoding: 'utf8', timeout: 30_000,
    env: { ...process.env, BRAIN_PORT: String(port), BRAIN_VAULT: elsewhere, BRAIN_KEY: '' },
  });
  const reply = JSON.parse(run.stdout.trim().split('\n')[0]);
  assert.equal(reply.result.isError, true);
  assert.match(reply.result.content[0].text, /different vault/);
  const found = await (await fetch(`http://127.0.0.1:${port}/search?q=wrong%20vault`)).json();
  assert.equal(found.results.length, 0, 'the refused note must not exist in either vault');
  fs.rmSync(elsewhere, { recursive: true, force: true });
});
