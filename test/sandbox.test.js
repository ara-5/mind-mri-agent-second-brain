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
