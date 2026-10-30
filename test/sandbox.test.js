import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import fs from 'fs';
import path from 'path';

process.env.SANDBOX_WORKSPACE = fs.mkdtempSync(path.join(os.tmpdir(), 'second-brain-sandbox-test-'));
process.on('exit', () => { try { fs.rmSync(process.env.SANDBOX_WORKSPACE, { recursive: true, force: true }); } catch { /* best effort */ } });
const { executeCode, isDockerRunning } = await import('../sdk/sandbox.js');

test('local fallback is refused unless SANDBOX_ALLOW_LOCAL=1', { skip: isDockerRunning() }, async () => {
  delete process.env.SANDBOX_ALLOW_LOCAL;
  const res = await executeCode('console.log("hi")', 'javascript');
  assert.equal(res.success, false);
  assert.match(res.stderr, /SANDBOX_ALLOW_LOCAL/);
});

test('local fallback runs when explicitly enabled', { skip: isDockerRunning() }, async () => {
  process.env.SANDBOX_ALLOW_LOCAL = '1';
  const res = await executeCode('console.log("hi")', 'javascript');
  delete process.env.SANDBOX_ALLOW_LOCAL;
  assert.equal(res.success, true);
  assert.equal(res.stdout, 'hi');
});

// ── Real Docker runs ──────────────────────────────────────────────────────
// Only when the daemon is up AND the image is already local, so the suite never
// triggers a surprise download (CI pulls it in a prior step).
const IMAGE = 'node:22-alpine';
const dockerReady = isDockerRunning() && spawnSync('docker', ['image', 'inspect', IMAGE], { stdio: 'ignore' }).status === 0;
const dockerOpts = { skip: !dockerReady && `Docker daemon or ${IMAGE} not available`, timeout: 60_000 };

test('docker: runs JavaScript in a container and returns its output', dockerOpts, async () => {
  const res = await executeCode('console.log("hi from container")', 'javascript', 20_000);
  assert.equal(res.runner, 'docker');
  assert.equal(res.success, true, res.stderr);
  assert.equal(res.stdout, 'hi from container');
});

test('docker: the container has no network', dockerOpts, async () => {
  const code = `
    const net = require('net');
    const s = net.connect({ host: '1.1.1.1', port: 80, timeout: 2000 });
    s.on('connect', () => { console.log('NET'); s.destroy(); });
    s.on('error', () => console.log('NONET'));
    s.on('timeout', () => { console.log('NONET'); s.destroy(); });
  `;
  const res = await executeCode(code, 'javascript', 20_000);
  assert.equal(res.stdout, 'NONET', res.stderr);
});

test('docker: root filesystem and the code mount are read-only', dockerOpts, async () => {
  const code = `
    const fs = require('fs');
    for (const target of ['/root-write-test', '/app/write-test']) {
      try { fs.writeFileSync(target, '1'); console.log('WROTE ' + target); } catch (e) { console.log('RO ' + e.code); }
    }
  `;
  const res = await executeCode(code, 'javascript', 20_000);
  assert.equal(res.success, true, res.stderr);
  assert.ok(!res.stdout.includes('WROTE'), res.stdout);
});

test('docker: a runaway script is stopped and its container removed', dockerOpts, async () => {
  const res = await executeCode('while (true) {}', 'javascript', 2000);
  assert.equal(res.success, false);
  assert.match(res.stderr, /timed out/i);
  await new Promise((r) => setTimeout(r, 2500)); // `docker rm -f` is fire-and-forget
  const left = spawnSync('docker', ['ps', '-aq', '--filter', 'name=sandbox_run_'], { encoding: 'utf8' }).stdout.trim();
  assert.equal(left, '', 'timed-out container was left behind');
});

test('docker: a private (0700) workspace is still readable by the container', dockerOpts, async () => {
  // The workspace chmod in sdk/sandbox.js exists for exactly this case.
  const mode = fs.statSync(process.env.SANDBOX_WORKSPACE).mode & 0o777;
  if (process.platform !== 'win32') assert.ok((mode & 0o055) === 0o055, `workspace mode is ${mode.toString(8)}`);
  const res = await executeCode('console.log(1 + 1)', 'javascript', 20_000);
  assert.equal(res.stdout, '2', res.stderr);
});
