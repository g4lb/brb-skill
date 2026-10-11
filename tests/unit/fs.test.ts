import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { atomicWriteFile, ensurePrivateDir, isInside, isSafeRelativePath, readRegularFile, withLock } from '../../src/utils/fs.js';
import { snapshotFiles } from '../../src/checkpoint/snapshot.js';
import { isWindows, tmpDir } from '../helpers.js';

test('atomic write replaces content and leaves no temp files', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'a.json');
  atomicWriteFile(file, 'one');
  atomicWriteFile(file, 'two');
  assert.equal(fs.readFileSync(file, 'utf8'), 'two');
  assert.deepEqual(fs.readdirSync(dir), ['a.json']);
  if (!isWindows) assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

test('refuses to write through or read a symlink', { skip: isWindows && 'symlinks need privileges on Windows' }, () => {
  const dir = tmpDir();
  const target = path.join(dir, 'target.txt');
  fs.writeFileSync(target, 'original');
  const link = path.join(dir, 'link.json');
  fs.symlinkSync(target, link);
  assert.throws(() => atomicWriteFile(link, 'evil'), /symbolic link/);
  assert.equal(fs.readFileSync(target, 'utf8'), 'original');
  assert.throws(() => readRegularFile(link, 1000), /symbolic link/);
});

test('refuses a storage directory that is a symlink', { skip: isWindows && 'symlinks need privileges on Windows' }, () => {
  const dir = tmpDir();
  const real = path.join(dir, 'real');
  fs.mkdirSync(real);
  const link = path.join(dir, 'home');
  fs.symlinkSync(real, link);
  assert.throws(() => ensurePrivateDir(link), /symbolic link/);
});

test('private directories are created with 0700 and fixed if too open', { skip: isWindows && 'POSIX permissions' }, () => {
  const dir = path.join(tmpDir(), 'p');
  ensurePrivateDir(dir);
  assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
  fs.chmodSync(dir, 0o777);
  ensurePrivateDir(dir);
  assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
});

test('readRegularFile enforces size limits', () => {
  const file = path.join(tmpDir(), 'big');
  fs.writeFileSync(file, 'x'.repeat(100));
  assert.throws(() => readRegularFile(file, 10), /exceeds/);
  assert.equal(readRegularFile(path.join(tmpDir(), 'missing'), 10), undefined);
});

test('path validation rejects traversal and absolute paths', () => {
  for (const p of ['../x', 'a/../../b', '/etc/passwd', 'C:\\x', 'C:x', '\\\\server\\share', '', 'a\0b']) assert.equal(isSafeRelativePath(p), false, JSON.stringify(p));
  for (const p of ['a', 'src/x.ts', 'dir/', '.github/workflows/ci.yml', 'a..b/c']) assert.equal(isSafeRelativePath(p), true, p);
  assert.ok(isInside('/a/b', '/a/b/c'));
  assert.ok(!isInside('/a/b', '/a/bc'));
  assert.ok(!isInside('/a/b', '/a/b/../c'));
});

test('lock serializes callers and breaks stale locks', () => {
  const dir = tmpDir();
  const lock = path.join(dir, '.lock');
  let inner = false;
  withLock(lock, () => {
    assert.throws(() => withLock(lock, () => { inner = true; }, { timeoutMs: 100 }), /in progress/);
  });
  assert.equal(inner, false);
  assert.ok(!fs.existsSync(lock));
  fs.mkdirSync(lock);
  const old = new Date(Date.now() - 120_000);
  fs.utimesSync(lock, old, old);
  assert.equal(withLock(lock, () => 42, { timeoutMs: 100 }), 42);
});

test('snapshot hashes files without storing content and skips sensitive files and symlinks', () => {
  const root = tmpDir();
  fs.writeFileSync(path.join(root, 'a.txt'), 'hello');
  fs.writeFileSync(path.join(root, '.env'), 'SECRET=1');
  const outside = path.join(tmpDir(), 'outside.txt');
  fs.writeFileSync(outside, 'outside');
  if (!isWindows) fs.symlinkSync(outside, path.join(root, 'link.txt'));
  const snap = snapshotFiles(root, ['a.txt', '.env', 'missing.txt', '../escape', ...(isWindows ? [] : ['link.txt'])]);
  const by = Object.fromEntries(snap.files.map((f) => [f.path, f]));
  assert.equal(by['a.txt']?.sha256, '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  assert.equal(by['.env']?.skipped, 'sensitive');
  assert.equal(by['missing.txt']?.skipped, 'missing');
  assert.equal(by['../escape'], undefined);
  if (!isWindows) assert.equal(by['link.txt']?.skipped, 'symlink');
  assert.ok(!JSON.stringify(snap).includes('hello'));
});

test('a lock holder never removes a lock that was broken and re-taken by another process', () => {
  const lock = path.join(tmpDir(), '.lock');
  withLock(lock, () => {
    // Simulate: our lock was judged stale, broken, and re-created by someone else.
    fs.rmSync(lock, { recursive: true, force: true });
    fs.mkdirSync(lock);
    fs.writeFileSync(path.join(lock, 'owner'), 'someone-else 2026-01-01T00:00:00Z\n');
  });
  assert.ok(fs.existsSync(lock), 'the other owner keeps its lock');
});
