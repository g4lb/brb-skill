import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCheckpoint } from '../../src/checkpoint/build.js';
import { computeDigest, parseCheckpoint, validateSaveInput } from '../../src/checkpoint/schema.js';
import { projectIdentity } from '../../src/checkpoint/paths.js';
import type { Checkpoint } from '../../src/checkpoint/types.js';
import { tmpDir } from '../helpers.js';

function sample(): Checkpoint {
  const root = tmpDir();
  const project = projectIdentity(root, tmpDir());
  return buildCheckpoint({
    project, type: 'manual', trigger: 'manual', sessionId: 's1',
    git: { available: false, reason: 'not a git repository' },
    input: { objective: 'Do the thing', nextAction: 'Next', completed: ['a'], files: ['src/x.ts'] },
  }).checkpoint;
}

test('a built checkpoint round-trips through parse and validation', () => {
  const cp = sample();
  const r = parseCheckpoint(JSON.stringify(cp));
  assert.ok(r.ok, r.ok ? '' : r.message);
  assert.deepEqual(r.checkpoint, cp);
});

test('truncated JSON is reported as damaged, not thrown', () => {
  const text = JSON.stringify(sample());
  const r = parseCheckpoint(text.slice(0, text.length / 2));
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.reason, 'parse');
});

test('edited content fails the integrity check', () => {
  const cp = sample();
  cp.task.nextAction = 'Delete everything';
  const r = parseCheckpoint(JSON.stringify(cp));
  assert.equal(!r.ok && r.reason, 'integrity');
});

test('a newer schema version is rejected with an upgrade message', () => {
  const cp = { ...sample(), schemaVersion: 99 };
  const r = parseCheckpoint(JSON.stringify(cp));
  assert.equal(!r.ok && r.reason, 'version');
  assert.match(!r.ok ? r.message : '', /newer BRB/);
});

test('missing or invalid schemaVersion is rejected', () => {
  const { schemaVersion: _v, ...rest } = sample();
  void _v;
  assert.equal(parseCheckpoint(JSON.stringify(rest)).ok, false);
  assert.equal(parseCheckpoint(JSON.stringify({ ...sample(), schemaVersion: 0 })).ok, false);
});

test('unknown fields and traversal paths are schema errors even with a valid digest', () => {
  const extra = { ...sample(), injected: 'x' } as Record<string, unknown>;
  (extra as { integrity: { digest: string } }).integrity.digest = computeDigest(extra as unknown as Checkpoint);
  const r1 = parseCheckpoint(JSON.stringify(extra));
  assert.equal(!r1.ok && r1.reason, 'schema');

  const cp = sample();
  cp.files = [{ path: '../../etc/passwd' }];
  cp.integrity.digest = computeDigest(cp);
  const r2 = parseCheckpoint(JSON.stringify(cp));
  assert.equal(!r2.ok && r2.reason, 'schema');
});

test('save input is validated strictly', () => {
  assert.ok(validateSaveInput({ objective: 'x', files: ['src/a.ts', { path: 'b.ts', note: 'n' }] }).ok);
  const bad = [
    { objectve: 'typo' },
    { objective: 42 },
    { files: ['/etc/passwd'] },
    { files: ['../outside.txt'] },
    { files: ['C:\\Windows\\system.ini'] },
    { tests: [{ command: 'npm test', result: 'great' }] },
    { completed: 'not a list' },
    { objective: 'x'.repeat(5000) },
    [],
  ];
  for (const b of bad) assert.equal(validateSaveInput(b).ok, false, JSON.stringify(b).slice(0, 80));
});

test('manual checkpoints without objective or next action are partial', () => {
  const project = projectIdentity(tmpDir(), tmpDir());
  const { checkpoint, missing } = buildCheckpoint({ project, type: 'manual', trigger: 'manual', sessionId: null, git: { available: false, reason: 'x' }, input: {} });
  assert.deepEqual(missing, ['objective', 'nextAction']);
  assert.equal(checkpoint.partial, true);
});

test('secrets in task input are redacted before the checkpoint is sealed', () => {
  const project = projectIdentity(tmpDir(), tmpDir());
  const { checkpoint } = buildCheckpoint({
    project, type: 'manual', trigger: 'manual', sessionId: null, git: { available: false, reason: 'x' },
    input: { objective: 'Fix login', nextAction: 'Use API_KEY=abcd1234efgh', notes: 'ghp_abcdefghijklmnopqrstuvwxyz0123456789AB' },
  });
  const text = JSON.stringify(checkpoint);
  assert.ok(!text.includes('abcd1234efgh'));
  assert.ok(!text.includes('ghp_abcdefghijklmnopqrstuvwxyz0123456789AB'));
  assert.equal(checkpoint.redactions, 2);
  assert.ok(parseCheckpoint(text).ok);
});

test('the documented example checkpoint is valid', async () => {
  const { readFileSync } = await import('node:fs');
  const r = parseCheckpoint(readFileSync('examples/checkpoint.json', 'utf8'));
  assert.ok(r.ok, r.ok ? '' : r.message);
});

test('a version 1 checkpoint loads and is migrated to record no background work', () => {
  const v2 = sample();
  const { integrity: _i, ...body } = v2;
  void _i;
  const { backgroundWork: _b, ...environment } = body.environment;
  void _b;
  const v1 = { ...body, schemaVersion: 1, environment } as unknown as Checkpoint;
  const sealed = { ...v1, integrity: { algorithm: 'sha256', digest: computeDigest(v1) } };
  const r = parseCheckpoint(JSON.stringify(sealed));
  assert.ok(r.ok, r.ok ? '' : r.message);
  assert.equal(r.ok && r.migratedFrom, 1);
  assert.equal(r.ok && r.checkpoint.schemaVersion, 2);
  assert.deepEqual(r.ok && r.checkpoint.environment.backgroundWork, []);
  // The original digest still protects a version 1 file.
  assert.equal(parseCheckpoint(JSON.stringify({ ...sealed, notes: 'edited' })).ok, false);
});

test('backgroundWork is accepted on save and stored in the environment', () => {
  const v = validateSaveInput({ objective: 'x', backgroundWork: ['subagent: review fixes on branch feat/x'] });
  assert.ok(v.ok);
  assert.equal(validateSaveInput({ backgroundWork: 'not a list' }).ok, false);
});
