// Checks a plugin folder (default: lite/) against the Claude plugin directory's
// rules for organizations that are not Verified. `claude plugin validate
// --profile directory` does not run these checks, so CI runs this script.
//
// Allowed: Markdown, text, JSON, YAML and PNG/JPEG/GIF/WebP/ICO files, plus
// LICENSE. No hooks, scripts, commands, agents, MCP/LSP/monitor configs, no
// file starting with #!, UTF-8 text without NUL bytes, and no SKILL.md with
// allowed-tools or inline shell.
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, relative, extname, basename, sep } from 'node:path';
import { TextDecoder } from 'node:util';

const root = process.argv[2] ?? 'lite';
const TEXT = new Set(['.md', '.txt', '.json', '.yaml', '.yml']);
const IMAGE = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico']);
const FORBIDDEN_DIRS = new Set(['hooks', 'bin', 'scripts', 'commands', 'agents']);
const FORBIDDEN_FILES = new Set(['hooks.json', '.mcp.json', '.lsp.json', 'monitors.json']);
const MANIFEST_FILES = new Set(['plugin.json', 'icon.png']);

const fail = [];
const problem = (file, reason) => fail.push(`${file}: ${reason}`);

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

if (!existsSync(root) || !statSync(root).isDirectory()) {
  console.error(`verify-lite: FAILED\n- ${root}: folder not found`);
  process.exit(1);
}

const files = walk(root);
for (const file of files) {
  const rel = relative(root, file);
  const parts = rel.split(sep);
  const name = basename(file);
  const ext = extname(name).toLowerCase();
  const bytes = readFileSync(file);

  if (parts.slice(0, -1).some((d) => FORBIDDEN_DIRS.has(d))) problem(file, `${parts.find((d) => FORBIDDEN_DIRS.has(d))}/ folders are not allowed`);
  if (FORBIDDEN_FILES.has(name)) problem(file, name === 'hooks.json' ? 'hooks are not allowed' : `${name} is not allowed`);
  if (parts[0] === '.claude-plugin' && !(parts.length === 2 && MANIFEST_FILES.has(name))) problem(file, 'only plugin.json and icon.png are allowed in .claude-plugin/');
  if (name !== 'LICENSE' && !TEXT.has(ext) && !IMAGE.has(ext)) problem(file, 'file type not allowed');
  if (bytes[0] === 0x23 && bytes[1] === 0x21) problem(file, 'starts with #!');

  if (TEXT.has(ext) || name === 'LICENSE') {
    let text = '';
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      problem(file, 'not valid UTF-8');
    }
    if (text.includes('\0')) problem(file, 'contains NUL bytes');
    if (name === 'SKILL.md') {
      const front = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? '';
      if (/^allowed-tools\s*:/m.test(front)) problem(file, 'allowed-tools is not allowed');
      if (text.includes('!`')) problem(file, 'inline shell (!`…`) is not allowed');
    }
  }
}

const manifest = join(root, '.claude-plugin', 'plugin.json');
if (!existsSync(manifest)) problem(manifest, 'missing');
else {
  try {
    const name = JSON.parse(readFileSync(manifest, 'utf8')).name;
    if (root.replace(/[\\/]+$/, '') === 'lite' && name !== 'brb') problem(manifest, `name must be "brb" (is ${JSON.stringify(name)})`);
  } catch {
    problem(manifest, 'not valid JSON');
  }
}
if (!existsSync(join(root, 'README.md'))) problem(join(root, 'README.md'), 'missing');

if (fail.length) {
  console.error(`verify-lite: FAILED\n- ${fail.join('\n- ')}`);
  process.exit(1);
}
console.log(`verify-lite: OK (${files.length} files)`);
