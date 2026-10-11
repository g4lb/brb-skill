// Cross-platform `rm -rf <dir>` restricted to build output directories.
import { rmSync } from 'node:fs';
const allowed = new Set(['build']);
for (const dir of process.argv.slice(2)) {
  if (!allowed.has(dir)) throw new Error(`refusing to clean ${dir}`);
  rmSync(dir, { recursive: true, force: true });
}
