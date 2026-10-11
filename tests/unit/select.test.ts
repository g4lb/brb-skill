import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectCheckpoint } from '../../src/recovery/select.js';
import type { StoredCheckpoint } from '../../src/checkpoint/store.js';
import type { Checkpoint } from '../../src/checkpoint/types.js';

let n = 0;
function cp(type: 'manual' | 'auto', createdAt: string, branch: string | null, fingerprint = 'a'.repeat(64)): StoredCheckpoint {
  n++;
  const id = `${n.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`;
  const checkpoint = {
    checkpointId: id, createdAt, type, trigger: type === 'manual' ? 'manual' : 'pre-compact',
    git: branch === null ? { available: false, reason: 'x' } : { available: true, branch, fingerprint },
  } as unknown as Checkpoint;
  return { file: `/x/${id}.json`, checkpoint };
}

test('no checkpoints selects nothing', () => {
  const s = selectCheckpoint([], 'main');
  assert.equal(s.selected, null);
});

test('latest manual on the current branch wins', () => {
  const old = cp('manual', '2026-01-01T00:00:00.000Z', 'main');
  const newer = cp('manual', '2026-01-02T00:00:00.000Z', 'main');
  const other = cp('manual', '2026-01-03T00:00:00.000Z', 'feature');
  const s = selectCheckpoint([old, other, newer], 'main');
  assert.equal(s.selected, newer);
  assert.equal(s.needsChoice, false);
  assert.equal(s.branchMismatch, false);
});

test('falls back to other branches and flags the mismatch', () => {
  const f = cp('manual', '2026-01-03T00:00:00.000Z', 'feature');
  const s = selectCheckpoint([f], 'main');
  assert.equal(s.selected, f);
  assert.equal(s.branchMismatch, true);
});

test('older automatic checkpoint never beats a newer manual one', () => {
  const a = cp('auto', '2026-01-01T00:00:00.000Z', 'main');
  const m = cp('manual', '2026-01-02T00:00:00.000Z', 'main');
  assert.equal(selectCheckpoint([a, m], 'main').selected, m);
});

test('a newer automatic checkpoint with repository changes keeps the manual one selected but asks', () => {
  const m = cp('manual', '2026-01-01T00:00:00.000Z', 'main', 'a'.repeat(64));
  const a = cp('auto', '2026-01-02T00:00:00.000Z', 'main', 'b'.repeat(64));
  const s = selectCheckpoint([m, a], 'main');
  assert.equal(s.selected, m);
  assert.equal(s.needsChoice, true);
  assert.equal(s.alternatives[0], a);
});

test('a newer automatic checkpoint of the same repository state is redundant', () => {
  const m = cp('manual', '2026-01-01T00:00:00.000Z', 'main');
  const a = cp('auto', '2026-01-02T00:00:00.000Z', 'main');
  const s = selectCheckpoint([m, a], 'main');
  assert.equal(s.selected, m);
  assert.equal(s.needsChoice, false);
});

test('only automatic checkpoints: the newest is used', () => {
  const a1 = cp('auto', '2026-01-01T00:00:00.000Z', 'main');
  const a2 = cp('auto', '2026-01-02T00:00:00.000Z', 'main');
  assert.equal(selectCheckpoint([a1, a2], 'main').selected, a2);
});

test('selection is deterministic for identical timestamps', () => {
  const x = cp('manual', '2026-01-01T00:00:00.000Z', 'main');
  const y = cp('manual', '2026-01-01T00:00:00.000Z', 'main');
  assert.equal(selectCheckpoint([x, y], 'main').selected, selectCheckpoint([y, x], 'main').selected);
});

test('explicit id and unique prefix', () => {
  const x = cp('manual', '2026-01-01T00:00:00.000Z', 'main');
  const y = cp('auto', '2026-01-02T00:00:00.000Z', 'main');
  assert.equal(selectCheckpoint([x, y], 'main', x.checkpoint.checkpointId.slice(0, 8)).selected, x);
  assert.match(selectCheckpoint([x, y], 'main', 'ffffffff').error ?? '', /No valid checkpoint/);
  assert.match(selectCheckpoint([x, y], 'main', '../etc').error ?? '', /not a valid/);
  assert.match(selectCheckpoint([x, y], 'main', '0000').error ?? '', /matches 2/);
});

test('no git: falls back to newest without branch mismatch', () => {
  const x = cp('manual', '2026-01-01T00:00:00.000Z', null);
  const s = selectCheckpoint([x], null);
  assert.equal(s.selected, x);
  assert.equal(s.branchMismatch, false);
});
