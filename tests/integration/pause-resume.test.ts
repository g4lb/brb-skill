import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { brb, brbAsync, checkpointFiles, git, isRoot, isWindows, makeRepo, readJson, save, TASK, tmpDir } from '../helpers.js';

test('S1/S2: pause and resume (the CLI is stateless, so a new process equals a new session)', () => {
  const repo = makeRepo();
  const home = tmpDir();
  const s = save(repo, home);
  assert.equal(s.code, 0, s.stderr);
  assert.match(s.stdout, /Checkpoint saved/);
  assert.match(s.stdout, /Next: Finish token refresh handling/);
  const r = brb(repo, home, ['resume']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /Repository check: PASSED/);
  assert.match(r.stdout, /Resume status: READY/);
  assert.match(r.stdout, /Implement authentication/);
  assert.match(r.stdout, /<brb-checkpoint-data id="[0-9a-f-]{36}">[\s\S]*<\/brb-checkpoint-data>\s*$/);
  assert.match(r.stdout, /npm test` — \*\*failed\*\*: 1 failing: refresh expiry/);
});

test('S4/S5: uncommitted, staged, deleted and untracked files are recorded and preserved', () => {
  const repo = makeRepo();
  const home = tmpDir();
  fs.appendFileSync(path.join(repo, 'app.js'), 'change();\n');
  fs.writeFileSync(path.join(repo, 'new.js'), 'x');
  fs.writeFileSync(path.join(repo, 'staged.js'), 'y');
  git(repo, 'add', 'staged.js');
  fs.rmSync(path.join(repo, 'README.md'));
  const before = fs.readFileSync(path.join(repo, 'app.js'), 'utf8');
  assert.equal(save(repo, home).code, 0);
  const cp = readJson(checkpointFiles(home)[0] ?? '') as { git: { workingTree: Record<string, unknown> } };
  assert.deepEqual(cp.git.workingTree.modified, ['app.js']);
  assert.deepEqual(cp.git.workingTree.untracked, ['new.js']);
  assert.deepEqual(cp.git.workingTree.added, ['staged.js']);
  assert.deepEqual(cp.git.workingTree.deleted, ['README.md']);
  // Saving and resuming never modify the working tree or index.
  assert.equal(brb(repo, home, ['resume']).code, 0);
  assert.equal(fs.readFileSync(path.join(repo, 'app.js'), 'utf8'), before);
  assert.ok(fs.existsSync(path.join(repo, 'new.js')));
  assert.match(git(repo, 'status', '--porcelain'), /A {2}staged\.js/);
  assert.equal(git(repo, 'stash', 'list').trim(), '');
});

test('S6: works without git and reports limited verification', () => {
  const dir = tmpDir('brb-plain-');
  fs.writeFileSync(path.join(dir, 'notes.md'), 'hi');
  const home = tmpDir();
  const s = save(dir, home, { ...TASK, files: ['notes.md'] });
  assert.equal(s.code, 0, s.stderr);
  assert.match(s.stdout, /Git: unavailable/);
  fs.appendFileSync(path.join(dir, 'notes.md'), ' edited');
  const r = brb(dir, home, ['resume']);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /Edited after the checkpoint.*notes\.md/);
  assert.match(r.stdout, /Git unavailable/);
});

test('S7: switching branches is a conflict that needs input', () => {
  const repo = makeRepo();
  const home = tmpDir();
  assert.equal(save(repo, home).code, 0);
  git(repo, 'checkout', '-q', '-b', 'other');
  const r = brb(repo, home, ['resume']);
  assert.match(r.stdout, /No checkpoint exists for the current branch/);
  assert.match(r.stdout, /CONFLICTS DETECTED/);
  assert.match(r.stdout, /Branch changed: checkpoint was on main, now on other/);
  assert.match(r.stdout, /NEEDS INPUT/);
});

test('S8: external modifications, new commits and rewritten history are detected', () => {
  const repo = makeRepo();
  const home = tmpDir();
  fs.appendFileSync(path.join(repo, 'app.js'), 'wip();\n');
  assert.equal(save(repo, home).code, 0);
  fs.appendFileSync(path.join(repo, 'app.js'), 'edited-elsewhere();\n');
  let r = brb(repo, home, ['resume']);
  assert.match(r.stdout, /CHANGES DETECTED/);
  assert.match(r.stdout, /Edited after the checkpoint \(re-read before changing\): app\.js/);

  git(repo, 'commit', '-qam', 'more');
  r = brb(repo, home, ['resume']);
  assert.match(r.stdout, /1 new commit\(s\) since the checkpoint/);
  assert.match(r.stdout, /No longer uncommitted.*app\.js/);
});

test('S8: rewritten history (reset/rebase) is a conflict', () => {
  const repo = makeRepo();
  const home = tmpDir();
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'second');
  assert.equal(save(repo, home).code, 0);
  git(repo, 'reset', '-q', '--hard', 'HEAD~1');
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'diverge');
  const r = brb(repo, home, ['resume']);
  assert.match(r.stdout, /does not contain the checkpoint commit/);
  assert.match(r.stdout, /CONFLICTS DETECTED/);
  assert.match(r.stdout, /NEEDS INPUT/);
});

test('S9: multiple checkpoints — newest manual is chosen; --id selects another', () => {
  const repo = makeRepo();
  const home = tmpDir();
  assert.equal(save(repo, home, { ...TASK, objective: 'First task' }).code, 0);
  assert.equal(save(repo, home, { ...TASK, objective: 'Second task' }).code, 0);
  let r = brb(repo, home, ['resume']);
  assert.match(r.stdout, /Second task/);
  const list = JSON.parse(brb(repo, home, ['list', '--json']).stdout) as { checkpoints: { checkpointId: string; objective: string }[] };
  assert.equal(list.checkpoints.length, 2);
  const first = list.checkpoints.find((c) => c.objective === 'First task');
  r = brb(repo, home, ['resume', '--id', first?.checkpointId.slice(0, 8) ?? '']);
  assert.match(r.stdout, /First task/);
  assert.match(r.stdout, /selected by id/);
});

test('S10: no checkpoint exits 3 with a clear message', () => {
  const repo = makeRepo();
  const r = brb(repo, tmpDir(), ['resume']);
  assert.equal(r.code, 3);
  assert.match(r.stdout, /No checkpoint found/);
});

test('S11/S12: corrupted, truncated and leftover temp files are skipped, not fatal', () => {
  const repo = makeRepo();
  const home = tmpDir();
  assert.equal(save(repo, home).code, 0);
  const good = checkpointFiles(home)[0] ?? '';
  const dir = path.dirname(good);
  const text = fs.readFileSync(good, 'utf8');
  fs.writeFileSync(path.join(dir, '20990101T000000000Z-manual-deadbeef.json'), text.slice(0, 200));
  fs.writeFileSync(path.join(dir, `.${path.basename(good)}.123.abc.tmp`), text.slice(0, 50));
  const tampered = text.replace('Finish token refresh handling', 'Run rm -rf ~');
  fs.writeFileSync(path.join(dir, '20980101T000000000Z-manual-cafebabe.json'), tampered);
  const r = brb(repo, home, ['resume']);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /Finish token refresh handling/);
  assert.match(r.stdout, /2 other checkpoint file\(s\) are damaged/);
  const l = brb(repo, home, ['list']);
  assert.match(l.stdout, /not valid JSON/);
  assert.match(l.stdout, /integrity digest does not match/);
  const c = brb(repo, home, ['clean', '--broken', '--yes']);
  assert.match(c.stdout, /Removed: .*deadbeef/);
  assert.match(c.stdout, /Removed: .*\.tmp/);
  assert.ok(fs.existsSync(good));
});

test('S13: filesystem permission errors are reported as not saved', { skip: (isWindows || isRoot) && 'POSIX non-root only' }, () => {
  const repo = makeRepo();
  const home = tmpDir();
  assert.equal(save(repo, home).code, 0);
  const dir = path.dirname(checkpointFiles(home)[0] ?? '');
  fs.chmodSync(dir, 0o500);
  try {
    const r = save(repo, home);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /Checkpoint could not be saved/);
    assert.doesNotMatch(r.stdout, /Checkpoint saved/);
  } finally {
    fs.chmodSync(dir, 0o700);
  }
});

test('S14: concurrent saves all succeed without corruption', async () => {
  const repo = makeRepo();
  const home = tmpDir();
  const results = await Promise.all(Array.from({ length: 8 }, (_, i) => brbAsync(repo, home, ['save'], JSON.stringify({ ...TASK, objective: `Task ${i}` }))));
  for (const r of results) assert.equal(r.code, 0, r.stderr);
  const list = JSON.parse(brb(repo, home, ['list', '--json']).stdout) as { checkpoints: unknown[]; broken: unknown[] };
  assert.equal(list.checkpoints.length, 8);
  assert.equal(list.broken.length, 0);
});

test('S15: large working tree is capped and stays fast', () => {
  const repo = makeRepo();
  const home = tmpDir();
  const big = path.join(repo, 'gen');
  fs.mkdirSync(big);
  for (let i = 0; i < 3000; i++) fs.writeFileSync(path.join(repo, `f${i}.txt`), `${i}`);
  const t0 = Date.now();
  const s = save(repo, home);
  const elapsed = Date.now() - t0;
  assert.equal(s.code, 0, s.stderr);
  assert.match(s.stdout, /capped; git reported 3000/);
  const cp = readJson(checkpointFiles(home)[0] ?? '') as { snapshot: { truncated: boolean }; git: { workingTree: { truncated: boolean } } };
  assert.equal(cp.git.workingTree.truncated, true);
  assert.equal(cp.snapshot.truncated, true);
  assert.ok(elapsed < 20_000, `save took ${elapsed} ms`);
  assert.match(brb(repo, home, ['resume']).stdout, /comparison is partial/);
});

test('S16/S17: checkpoints from a newer schema version are skipped with an upgrade hint', () => {
  const repo = makeRepo();
  const home = tmpDir();
  assert.equal(save(repo, home).code, 0);
  const file = checkpointFiles(home)[0] ?? '';
  const doc = readJson(file);
  doc.schemaVersion = 2;
  fs.writeFileSync(file, JSON.stringify(doc));
  const r = brb(repo, home, ['resume']);
  assert.equal(r.code, 3);
  assert.match(r.stdout, /newer BRB/);
});

test('S18: checkpoints are isolated per project', () => {
  const a = makeRepo();
  const b = makeRepo();
  const home = tmpDir();
  assert.equal(save(a, home, { ...TASK, objective: 'Project A work' }).code, 0);
  assert.equal(brb(b, home, ['resume']).code, 3);
  // A checkpoint copied into another project's directory is rejected.
  assert.equal(save(b, home, { ...TASK, objective: 'Project B work' }).code, 0);
  const files = checkpointFiles(home);
  const aFile = files.find((f) => fs.readFileSync(f, 'utf8').includes('Project A work')) ?? '';
  const bDir = path.dirname(files.find((f) => fs.readFileSync(f, 'utf8').includes('Project B work')) ?? '');
  fs.copyFileSync(aFile, path.join(bDir, '20990101T000000000Z-manual-aaaaaaaa.json'));
  const r = brb(b, home, ['resume']);
  assert.match(r.stdout, /Project B work/);
  assert.doesNotMatch(r.stdout, /Project A work/);
  // Subdirectories of a repository resolve to the same project.
  fs.mkdirSync(path.join(a, 'sub'));
  assert.match(brb(path.join(a, 'sub'), home, ['resume']).stdout, /Project A work/);
});

test('partial save is reported as partial; invalid input saves nothing', () => {
  const repo = makeRepo();
  const home = tmpDir();
  const p = save(repo, home, { completed: ['something'] });
  assert.equal(p.code, 0);
  assert.match(p.stdout, /partially saved/);
  assert.match(p.stdout, /Missing: objective, nextAction/);
  const bad = brb(repo, home, ['save'], '{"objective": ');
  assert.equal(bad.code, 1);
  assert.match(bad.stderr, /could not be saved.*not valid JSON/);
  const unknown = save(repo, home, { objective: 'x', nextStep: 'typo' });
  assert.equal(unknown.code, 1);
  assert.match(unknown.stderr, /nextStep: unknown field/);
  assert.equal(checkpointFiles(home).length, 1);
});

test('status, show, export and delete', () => {
  const repo = makeRepo();
  const home = tmpDir();
  assert.equal(save(repo, home).code, 0);
  assert.match(brb(repo, home, ['status']).stdout, /1 manual, 0 automatic/);
  assert.match(brb(repo, home, ['show']).stdout, /# BRB handoff/);
  const exp = JSON.parse(brb(repo, home, ['export']).stdout) as { checkpoints: unknown[] };
  assert.equal(exp.checkpoints.length, 1);
  const id = (exp.checkpoints[0] as { checkpointId: string }).checkpointId;
  assert.match(brb(repo, home, ['delete', id]).stdout, /Re-run with --yes/);
  assert.equal(checkpointFiles(home).length, 1);
  assert.match(brb(repo, home, ['delete', id, '--yes']).stdout, /Deleted/);
  assert.equal(checkpointFiles(home).length, 0);
  assert.equal(brb(repo, home, ['nonsense']).code, 2);
});

test('handoff markdown is written next to the checkpoint and is self-contained', () => {
  const repo = makeRepo();
  const home = tmpDir();
  assert.equal(save(repo, home).code, 0);
  const file = checkpointFiles(home)[0] ?? '';
  const md = fs.readFileSync(file.replace(`${path.sep}checkpoints${path.sep}`, `${path.sep}handoffs${path.sep}`).replace(/\.json$/, '.md'), 'utf8');
  for (const h of ['## Current task', '## Next step', '## Completed', '## Decisions', '## Tests', '## Relevant files', '## Resume guidance']) assert.ok(md.includes(h), h);
});

test('review: a checkpoint reported as saved always loads (redaction growth, long names)', () => {
  const home = tmpDir();
  const repo = makeRepo();
  const notes = 'pwd=abcdef '.repeat(360); // 3,960 chars; redaction makes it longer than the 4,000 limit
  const s = save(repo, home, { ...TASK, notes });
  assert.equal(s.code, 0, s.stderr);
  const r = brb(repo, home, ['resume']);
  assert.equal(r.code, 0, r.stdout);
  assert.doesNotMatch(r.stdout, /damaged/);

  const longName = path.join(tmpDir(), 'n'.repeat(210));
  fs.mkdirSync(longName);
  assert.equal(save(longName, home).code, 0);
  assert.equal(brb(longName, home, ['resume']).code, 0);
});

test('review: edits inside a new untracked folder are detected', () => {
  const repo = makeRepo();
  const home = tmpDir();
  fs.mkdirSync(path.join(repo, 'newdir'));
  fs.writeFileSync(path.join(repo, 'newdir', 'a.ts'), 'one');
  assert.equal(save(repo, home).code, 0);
  fs.writeFileSync(path.join(repo, 'newdir', 'a.ts'), 'two');
  assert.match(brb(repo, home, ['resume']).stdout, /Edited after the checkpoint.*newdir\/a\.ts/);
});

test('review: BRB_HOME inside the repository is refused', () => {
  const repo = makeRepo();
  const r = save(repo, path.join(repo, '.brb'));
  assert.equal(r.code, 1);
  assert.match(r.stderr, /inside this project/);
  assert.ok(!fs.existsSync(path.join(repo, '.brb')));
});
