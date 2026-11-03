// "Build" step for a project that has nothing to compile: parse every source file
// so a syntax error fails here instead of at runtime.   npm run build
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const roots = ['api', 'sdk', 'mcp', 'scripts'];
const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else if (/\.(js|mjs)$/.test(name)) files.push(full);
  }
};
for (const root of roots) walk(root);

let failed = 0;
for (const file of files) {
  const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (r.status !== 0) { failed++; console.error(`SYNTAX ERROR in ${file}\n${r.stderr}`); }
}
if (failed) process.exit(1);
console.log(`checked ${files.length} files, no syntax errors`);
