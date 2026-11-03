// Speaks MCP to the Docker image and checks it end to end.
//   docker build -t second-brain-ci .
//   node scripts/docker-smoke.mjs second-brain-ci
// Used by CI; also handy locally. Exits non-zero with a reason on any failure.
import { spawnSync } from 'node:child_process';

const image = process.argv[2] || 'second-brain-ci';

const requests = [
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
  { jsonrpc: '2.0', id: 2, method: 'tools/list' },
  // A real write: proves the API starts inside the container and the unprivileged
  // user can write to the vault volume.
  { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'brain_remember', arguments: { title: 'Container smoke test', content: 'written from inside the container' } } },
];

const run = spawnSync('docker', ['run', '-i', '--rm', image], {
  input: requests.map((r) => JSON.stringify(r)).join('\n') + '\n',
  encoding: 'utf8',
  timeout: 90_000,
});

console.log(run.stdout);
if (run.stderr) console.error(run.stderr);

function fail(message) {
  console.error(`docker smoke test FAILED: ${message}`);
  process.exit(1);
}

if (run.error) fail(run.error.message);
const replies = Object.fromEntries(
  run.stdout.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)).map((m) => [m.id, m]),
);

if (!replies[1]?.result?.serverInfo) fail('no initialize reply');
const tools = replies[2]?.result?.tools ?? [];
if (tools.length < 11) fail(`expected at least 11 tools, got ${tools.length}`);
const saved = replies[3]?.result;
if (!saved || saved.isError || !saved.content[0].text.includes('"success": true')) {
  fail(`the note was not saved inside the container: ${JSON.stringify(replies[3])}`);
}
console.log(`container OK: ${tools.length} tools, note saved`);
