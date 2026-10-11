// Release checks that need no network:
// 1. Versions agree across package.json, plugin.json, marketplace.json and src/version.ts.
// 2. Committed plugin/dist/ matches a fresh build of src/ (plugins install from git with no build step).
// 3. The plugin's hook and skill files reference only files that exist.
// 4. plugin/ (the directory Claude Code installs) has no package.json, so installing
//    BRB never runs npm install or downloads development dependencies.
import { readFileSync, readdirSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

const fail = [];
const PLUGIN = 'plugin';
const DIST = join(PLUGIN, 'dist');
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const plugin = JSON.parse(readFileSync(join(PLUGIN, '.claude-plugin', 'plugin.json'), 'utf8'));
const market = JSON.parse(readFileSync('.claude-plugin/marketplace.json', 'utf8'));
const versionTs = /VERSION = '([^']+)'/.exec(readFileSync('src/version.ts', 'utf8'))?.[1];
const versions = { 'package.json': pkg.version, 'plugin.json': plugin.version, 'marketplace.json': market.plugins?.[0]?.version, 'src/version.ts': versionTs };
if (new Set(Object.values(versions)).size !== 1) fail.push(`version mismatch: ${JSON.stringify(versions)}`);

const out = mkdtempSync(join(tmpdir(), 'brb-dist-'));
try {
  execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json', '--outDir', out], { stdio: 'inherit' });
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
  const fresh = walk(out).map((f) => relative(out, f)).sort();
  const committed = existsSync(DIST) ? walk(DIST).map((f) => relative(DIST, f)).sort() : [];
  if (JSON.stringify(fresh) !== JSON.stringify(committed)) fail.push('plugin/dist/ file list differs from a fresh build; run npm run build');
  for (const f of fresh) {
    if (existsSync(join(DIST, f)) && readFileSync(join(DIST, f), 'utf8') !== readFileSync(join(out, f), 'utf8')) fail.push(`plugin/dist/${f} is stale; run npm run build`);
  }
} finally {
  rmSync(out, { recursive: true, force: true });
}

const hooks = readFileSync(join(PLUGIN, 'hooks', 'hooks.json'), 'utf8');
for (const m of hooks.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([^"\\ ]+)/g)) if (!existsSync(join(PLUGIN, m[1]))) fail.push(`hooks.json references missing ${m[1]}`);
for (const skill of readdirSync(join(PLUGIN, 'skills'))) {
  const text = readFileSync(join(PLUGIN, 'skills', skill, 'SKILL.md'), 'utf8');
  if (!/^---\nname: [a-z0-9-]+\ndescription: .+\n/m.test(text)) fail.push(`skills/${skill}/SKILL.md frontmatter is missing name or description`);
  for (const m of text.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([^"\s`]+)/g)) if (!existsSync(join(PLUGIN, m[1]))) fail.push(`skills/${skill} references missing ${m[1]}`);
}

for (const f of ['package.json', 'package-lock.json', 'node_modules']) {
  if (existsSync(join(PLUGIN, f))) fail.push(`${PLUGIN}/${f} must not exist: Claude Code would run npm install when users install the plugin`);
}
const marketSource = market.plugins?.[0]?.source;
if (marketSource !== './plugin') fail.push(`marketplace.json source must be ./plugin (is ${JSON.stringify(marketSource)})`);

if (fail.length) {
  console.error(`verify-dist: FAILED\n- ${fail.join('\n- ')}`);
  process.exit(1);
}
console.log(`verify-dist: OK (version ${pkg.version}, dist up to date, plugin references resolve)`);
