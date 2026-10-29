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

after(() => {
  apiProc?.kill();
  fs.rmSync(vault, { recursive: true, force: true });
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
    assert.equal(t.annotations.destructiveHint, false, t.name);
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
