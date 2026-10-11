import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { classify, parsePorcelainZ } from '../../src/checkpoint/git.js';
import { extractTranscript } from '../../src/checkpoint/transcript.js';
import { validateConfig, loadConfig, DEFAULT_CONFIG } from '../../src/config/config.js';
import { projectIdentity, checkpointFileName, isCheckpointFileName } from '../../src/checkpoint/paths.js';
import { planClean } from '../../src/commands/manage.js';
import { parseArgs } from '../../src/commands/common.js';
import type { StoredCheckpoint } from '../../src/checkpoint/store.js';
import { tmpDir, userEntry, writeTranscript } from '../helpers.js';

test('parses porcelain -z output including renames, conflicts and untracked files', () => {
  const out = [' M src/a.ts', 'A  src/new.ts', 'D  old.ts', 'R  src/renamed.ts', 'src/orig.ts', 'UU conflict.ts', '?? notes.txt', 'MM both.ts', ''].join('\0');
  const wt = classify(parsePorcelainZ(out).entries);
  assert.deepEqual(wt.modified, ['src/a.ts', 'both.ts']);
  assert.deepEqual(wt.added, ['src/new.ts']);
  assert.deepEqual(wt.deleted, ['old.ts']);
  assert.deepEqual(wt.renamed, [{ from: 'src/orig.ts', to: 'src/renamed.ts' }]);
  assert.deepEqual(wt.conflicted, ['conflict.ts']);
  assert.deepEqual(wt.untracked, ['notes.txt']);
  assert.deepEqual(wt.staged, ['src/new.ts', 'old.ts', 'src/renamed.ts', 'both.ts']);
  assert.equal(wt.truncated, false);
});

test('caps very large working trees', () => {
  const out = Array.from({ length: 1500 }, (_, i) => `?? f${i}.txt`).join('\0');
  const wt = classify(parsePorcelainZ(out).entries);
  assert.equal(wt.untracked.length, 1000);
  assert.equal(wt.truncated, true);
  assert.equal(wt.total, 1500);
});

test('drops unsafe paths reported by git', () => {
  const wt = classify(parsePorcelainZ(['?? ../escape.txt', '?? ok.txt', ''].join('\0')).entries);
  assert.deepEqual(wt.untracked, ['ok.txt']);
});

test('extracts prompts, last assistant text and TodoWrite state from a transcript', () => {
  const dir = tmpDir();
  const file = writeTranscript(dir, [
    userEntry('Build the login page'),
    userEntry('<command-name>/compact</command-name>'),
    userEntry('meta stuff', undefined, { isMeta: true }),
    userEntry('This session is being continued from a previous conversation...', undefined, { isCompactSummary: true }),
    { type: 'assistant', message: { content: [{ type: 'text', text: 'Working on it' }, { type: 'tool_use', id: 't1', name: 'TodoWrite', input: { todos: [
      { content: 'Form', status: 'completed' }, { content: 'Validation', status: 'in_progress' }, { content: 'Tests', status: 'pending' }] } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } },
    { type: 'assistant', isSidechain: true, message: { content: [{ type: 'text', text: 'subagent noise' }] } },
    userEntry('Also add a remember-me box'),
  ]);
  const s = extractTranscript(file);
  assert.deepEqual(s.recentUserPrompts, ['Build the login page', 'Also add a remember-me box']);
  assert.equal(s.lastAssistantMessage, 'Working on it');
  assert.deepEqual(s.todos, { completed: ['Form'], inProgress: ['Validation'], remaining: ['Tests'] });
  assert.equal(s.userPromptCount, 2);
});

test('reconstructs TaskCreate/TaskUpdate task lists', () => {
  const dir = tmpDir();
  const file = writeTranscript(dir, [
    userEntry('go'),
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'c1', name: 'TaskCreate', input: { subject: 'Write parser' } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'c1', content: 'Task #1 created successfully: Write parser' }] } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'c2', name: 'TaskCreate', input: { subject: 'Write tests' } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'c2', content: 'Task #2 created successfully: Write tests' }] } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'u1', name: 'TaskUpdate', input: { taskId: '1', status: 'completed' } }] } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'u2', name: 'TaskUpdate', input: { taskId: '2', status: 'in_progress' } }] } },
  ]);
  assert.deepEqual(extractTranscript(file).todos, { completed: ['Write parser'], inProgress: ['Write tests'], remaining: [] });
});

test('garbage and missing transcripts yield empty context instead of errors', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'bad.jsonl');
  fs.writeFileSync(file, '{"type":"user","mess\nnot json\n\n[1,2]\n');
  assert.deepEqual(extractTranscript(file).recentUserPrompts, []);
  assert.deepEqual(extractTranscript(path.join(dir, 'missing.jsonl')).recentUserPrompts, []);
});

test('config validation is strict', () => {
  assert.ok(validateConfig({ autoBRB: { enabled: true, maxCheckpoints: 5 } }, 'c').ok);
  assert.equal(validateConfig({ autoBRB: { enabled: 'yes' } }, 'c').ok, false);
  assert.equal(validateConfig({ autoBRB: { maxCheckpoints: 0 } }, 'c').ok, false);
  assert.equal(validateConfig({ autoBRB: { onEverything: true } }, 'c').ok, false);
  assert.equal(validateConfig({ telemetry: true }, 'c').ok, false);
});

test('an invalid config file forces Auto-BRB off and reports the error', () => {
  const home = tmpDir();
  const project = projectIdentity(tmpDir(), home);
  fs.mkdirSync(project.dir, { recursive: true });
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ autoBRB: { enabled: true } }));
  fs.writeFileSync(path.join(project.dir, 'config.json'), '{ broken');
  const eff = loadConfig(project, home);
  assert.equal(eff.config.autoBRB.enabled, false);
  assert.equal(eff.errors.length, 1);
});

test('project config overrides global config, which overrides defaults', () => {
  const home = tmpDir();
  const project = projectIdentity(tmpDir(), home);
  fs.mkdirSync(project.dir, { recursive: true });
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ autoBRB: { enabled: true, maxCheckpoints: 3 } }));
  fs.writeFileSync(path.join(project.dir, 'config.json'), JSON.stringify({ autoBRB: { enabled: false } }));
  const c = loadConfig(project, home).config;
  assert.equal(c.autoBRB.enabled, false);
  assert.equal(c.autoBRB.maxCheckpoints, 3);
  assert.equal(c.autoBRB.onSessionEnd, DEFAULT_CONFIG.autoBRB.onSessionEnd);
});

test('project identity is stable and isolates different roots', () => {
  const home = tmpDir();
  const a = tmpDir();
  const b = tmpDir();
  assert.equal(projectIdentity(a, home).identity, projectIdentity(`${a}${path.sep}`, home).identity);
  assert.notEqual(projectIdentity(a, home).identity, projectIdentity(b, home).identity);
  assert.notEqual(projectIdentity(a, home).dir, projectIdentity(b, home).dir);
});

test('checkpoint file names are well-formed and recognized', () => {
  const name = checkpointFileName('2026-10-11T07:45:46.830Z', 'manual', '9410b410-74ab-46d0-91f7-121d15645f71');
  assert.equal(name, '20261011T074546830Z-manual-9410b410.json');
  assert.ok(isCheckpointFileName(name));
  assert.ok(!isCheckpointFileName('../../etc/passwd'));
  assert.ok(!isCheckpointFileName('x.json'));
});

test('clean plan keeps the newest per type and never mixes types', () => {
  const mk = (type: string, i: number): StoredCheckpoint => ({
    file: `/c/${type}${i}.json`,
    checkpoint: { type, createdAt: new Date(Date.UTC(2026, 0, 30 - i)).toISOString() } as never,
  });
  const valid = [mk('manual', 0), mk('manual', 1), mk('manual', 2), mk('auto', 0), mk('auto', 1)];
  const plan = planClean(valid, [{ file: '/c/broken.json' }], ['/c/x.tmp'], { keepManual: 2, keepAuto: 1, olderThanDays: null, includeBroken: false }, new Date(Date.UTC(2026, 1, 1)));
  assert.deepEqual(plan.remove.map((r) => r.file), ['/c/manual2.json', '/c/auto1.json', '/c/x.tmp']);
  const aged = planClean(valid, [], [], { keepManual: 10, keepAuto: 10, olderThanDays: 2, includeBroken: false }, new Date(Date.UTC(2026, 1, 1)));
  assert.deepEqual(aged.remove.map((r) => r.file), ['/c/manual1.json', '/c/manual2.json', '/c/auto1.json']);
});

test('argument parser handles values, booleans and errors', () => {
  assert.deepEqual(parseArgs(['--id', 'abc', '--json', 'x', '--k=v'], ['json']), { positionals: ['x'], flags: { id: 'abc', json: true, k: 'v' } });
  assert.throws(() => parseArgs(['--id'], []), /needs a value/);
});
