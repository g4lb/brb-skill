// Run node:test on every *.test.js under the given directories.
// Node 20's `node --test` does not expand glob patterns, so files are listed here.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const walk = (dir) => readdirSync(dir, { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith('.test.js') ? [join(dir, e.name)] : []));
const files = process.argv.slice(2).flatMap(walk).sort();
if (files.length === 0) {
  console.error('run-tests: no test files found');
  process.exit(1);
}
const r = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...files], { stdio: 'inherit' });
process.exit(r.status ?? 1);
