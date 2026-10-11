// Bundle the helper into one dependency-free ES module and place a copy in
// every skill folder. Each skill is then self-contained: installed as a
// Claude Code plugin or copied alone by `npx skills add`, it finds its
// helper at ${CLAUDE_SKILL_DIR}/scripts/brb.mjs.
import { build } from 'esbuild';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const SKILLS_DIR = join('plugin', 'skills');
export const BUNDLE_NAME = join('scripts', 'brb.mjs');

export async function bundle() {
  const result = await build({
    entryPoints: ['src/cli.ts'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    write: false,
    legalComments: 'none',
    banner: { js: '// BRB helper. Generated from src/ by scripts/bundle.mjs; do not edit. MIT License, (c) g4lb.' },
  });
  const file = result.outputFiles[0];
  if (!file) throw new Error('esbuild produced no output');
  return file.text;
}

export function skillFolders() {
  return readdirSync(SKILLS_DIR, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => join(SKILLS_DIR, e.name));
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('bundle.mjs')) {
  const text = await bundle();
  for (const dir of skillFolders()) {
    mkdirSync(join(dir, 'scripts'), { recursive: true });
    writeFileSync(join(dir, BUNDLE_NAME), text);
  }
  console.log(`bundle: ${(text.length / 1024).toFixed(0)} KB -> ${skillFolders().map((d) => join(d, BUNDLE_NAME)).join(', ')}`);
}
