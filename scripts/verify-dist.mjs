// Release checks that need no network:
// 1. Versions agree across package.json, plugin.json, marketplace.json and src/version.ts.
// 2. Every skill's committed scripts/brb.mjs equals a fresh bundle of src/
//    (plugins and skills install from git with no build step).
// 3. Hook and skill files reference only files that exist.
// 4. plugin/ (what Claude Code installs) has no package.json, so installing
//    BRB never runs npm install or downloads development dependencies.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { bundle, skillFolders, BUNDLE_NAME } from './bundle.mjs';

const fail = [];
const PLUGIN = 'plugin';
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const plugin = JSON.parse(readFileSync(join(PLUGIN, '.claude-plugin', 'plugin.json'), 'utf8'));
const market = JSON.parse(readFileSync('.claude-plugin/marketplace.json', 'utf8'));
const versionTs = /VERSION = '([^']+)'/.exec(readFileSync('src/version.ts', 'utf8'))?.[1];
const versions = { 'package.json': pkg.version, 'plugin.json': plugin.version, 'marketplace.json': market.plugins?.[0]?.version, 'src/version.ts': versionTs };
if (new Set(Object.values(versions)).size !== 1) fail.push(`version mismatch: ${JSON.stringify(versions)}`);

const fresh = await bundle();
for (const dir of skillFolders()) {
  const file = join(dir, BUNDLE_NAME);
  if (!existsSync(file)) fail.push(`${file} is missing; run npm run build`);
  else if (readFileSync(file, 'utf8') !== fresh) fail.push(`${file} is stale; run npm run build`);
}

const hooks = readFileSync(join(PLUGIN, 'hooks', 'hooks.json'), 'utf8');
for (const m of hooks.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([^"\\ ]+)/g)) if (!existsSync(join(PLUGIN, m[1]))) fail.push(`hooks.json references missing ${m[1]}`);
for (const dir of skillFolders()) {
  const text = readFileSync(join(dir, 'SKILL.md'), 'utf8');
  if (!/^---\nname: [a-z0-9-]+\ndescription: .+\n/m.test(text)) fail.push(`${dir}/SKILL.md frontmatter is missing name or description`);
  // Skills must be self-contained: only ${CLAUDE_SKILL_DIR} works when a skill is installed on its own.
  if (text.includes('${CLAUDE_PLUGIN_ROOT}')) fail.push(`${dir}/SKILL.md uses \${CLAUDE_PLUGIN_ROOT}; use \${CLAUDE_SKILL_DIR} so standalone installs work`);
  for (const m of text.matchAll(/\$\{CLAUDE_SKILL_DIR\}\/([^"\s`]+)/g)) if (!existsSync(join(dir, m[1]))) fail.push(`${dir}/SKILL.md references missing ${m[1]}`);
}

for (const f of ['package.json', 'package-lock.json', 'node_modules', 'dist']) {
  if (existsSync(join(PLUGIN, f))) fail.push(`${PLUGIN}/${f} must not exist (npm files would make Claude Code run npm install; dist/ is replaced by per-skill bundles)`);
}
const marketSource = market.plugins?.[0]?.source;
if (marketSource !== './plugin') fail.push(`marketplace.json source must be ./plugin (is ${JSON.stringify(marketSource)})`);

if (fail.length) {
  console.error(`verify-dist: FAILED\n- ${fail.join('\n- ')}`);
  process.exit(1);
}
console.log(`verify-dist: OK (version ${pkg.version}, ${skillFolders().length} skill bundles up to date, references resolve, no npm files in plugin/)`);
