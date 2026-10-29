import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// This repository is the public, generic project. A maintainer's own vault (and
// anything that identifies it) must live elsewhere. These checks run only inside a
// git checkout; an npm-installed copy has no .git and nothing to check.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const inGit = fs.existsSync(path.join(ROOT, '.git'));

const tracked = inGit
  ? execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean)
  : [];

// The only notes that ship: a small mock vault demonstrating the features.
const TEMPLATE_VAULT = [
  'vault/Second Brain Index.md',
  'vault/agents/personas/Pipeline Engineer.md',
  'vault/agents/personas/Research Analyst.md',
  'vault/agents/personas/Research Lead.md',
  'vault/agents/sample-agent/Sample Agent Memory.md',
  'vault/decisions/architectural-decisions.md',
  'vault/insights/rag-context-savings.md',
  'vault/research/artificial-intelligence.md',
  'vault/tasks/agent-scheduling.md',
];

test('only the template vault notes are tracked', { skip: !inGit }, () => {
  const vaultFiles = tracked.filter((f) => f.startsWith('vault/')).sort();
  assert.deepEqual(vaultFiles, [...TEMPLATE_VAULT].sort(),
    'A note outside the template set is tracked. Personal or generated notes must not be committed here; ' +
    'if you are deliberately adding a template note, add it to TEMPLATE_VAULT in this test.');
});

test('no tracked file contains personal paths or private-vault markers', { skip: !inGit }, () => {
  // Patterns are assembled from pieces so this file does not match itself.
  const markers = [
    new RegExp(['Life', 'Forge'].join(''), 'i'),
    new RegExp(['Time', 'AI'].join('')),
    new RegExp(['Second-Brain', '---', 'obsidian'].join(''), 'i'),
    new RegExp(['One', 'Drive'].join(''), 'i'),
    new RegExp(['C:', '\\\\', 'Users', '\\\\', 'HP'].join(''), 'i'),
    new RegExp(['/c/', 'Users', '/HP'].join(''), 'i'),
  ];
  const offenders = [];
  for (const rel of tracked) {
    if (/\.(png|webp|jpg|jpeg|gif|ico|db)$/i.test(rel) || /\.min\.js$/.test(rel)) continue;
    if (rel === 'test/repo_hygiene.test.js') continue;
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    for (const re of markers) if (re.test(text)) offenders.push(`${rel} matches ${re}`);
  }
  assert.deepEqual(offenders, []);
});

test('.gitignore keeps runtime-generated vault folders out of commits', () => {
  const ignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  for (const dir of ['vault/messages/', 'vault/memories/', 'vault/memorys/', 'vault/archive/', 'vault/.embeddings.db']) {
    assert.ok(ignore.includes(dir), `.gitignore should list ${dir}`);
  }
});
