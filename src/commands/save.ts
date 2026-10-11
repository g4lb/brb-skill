import * as path from 'node:path';
import { buildCheckpoint } from '../checkpoint/build.js';
import { collectGitState } from '../checkpoint/git.js';
import { brbHome } from '../checkpoint/paths.js';
import { renderHandoff } from '../checkpoint/handoff.js';
import { validateSaveInput } from '../checkpoint/schema.js';
import { listCheckpoints, withProjectLock, writeCheckpoint } from '../checkpoint/store.js';
import { loadConfig } from '../config/config.js';
import { readRegularFile } from '../utils/fs.js';
import { BrbError, errorMessage } from '../utils/errors.js';
import { flagString, parseArgs, resolveProject, shortId, type CommandContext } from './common.js';
import { elapsed, plural, step, sub, tildePath } from './ui.js';

const MAX_INPUT_BYTES = 1024 * 1024;

/**
 * `brb save` — create a manual checkpoint. Task context (written by Claude)
 * arrives as JSON on stdin or via --input; repository state is collected here.
 */
export function cmdSave(argv: string[], ctx: CommandContext): number {
  const started = performance.now();
  const { flags } = parseArgs(argv, ['json']);
  const project = resolveProject(ctx.cwd, ctx.env);

  let text: string | undefined;
  const inputFile = flagString(flags, 'input');
  if (inputFile) {
    text = readRegularFile(path.resolve(ctx.cwd, inputFile), MAX_INPUT_BYTES);
    if (text === undefined) throw new BrbError('USAGE', `Input file ${inputFile} does not exist.`);
  } else {
    text = ctx.readStdin();
    if (text === undefined) throw new BrbError('USAGE', 'No task context given.', 'Pipe JSON to stdin or pass --input <file>. See `brb help save`.');
  }
  if (Buffer.byteLength(text) > MAX_INPUT_BYTES) throw new BrbError('USAGE', 'Task context is larger than 1 MB.');
  let raw: unknown;
  try {
    raw = text.trim() === '' ? {} : JSON.parse(text);
  } catch (err) {
    throw new BrbError('INVALID_INPUT', `Task context is not valid JSON: ${errorMessage(err)}`, 'Nothing was saved. Fix the JSON and retry.');
  }
  const v = validateSaveInput(raw);
  if (!v.ok) {
    throw new BrbError('INVALID_INPUT', `Task context is invalid:\n  - ${v.errors.join('\n  - ')}`, 'Nothing was saved. Fix the fields above and retry.');
  }

  const git = collectGitState(project.root);
  const sessionId = flagString(flags, 'session') ?? null;
  const { checkpoint, missing } = buildCheckpoint({ project, type: 'manual', trigger: 'manual', sessionId, git, input: v.input, now: ctx.now() });

  const result = withProjectLock(project, () => writeCheckpoint(project, checkpoint, renderHandoff(checkpoint)));
  const { config, errors: configErrors } = loadConfig(project, brbHome(ctx.env));
  const total = listCheckpoints(project).valid.length;

  if (flags.json) {
    ctx.stdout(JSON.stringify({
      status: missing.length > 0 ? 'partial' : 'saved',
      checkpointId: checkpoint.checkpointId,
      file: result.file,
      handoff: result.handoffFile,
      handoffError: result.handoffError,
      missing,
      redactions: checkpoint.redactions,
      checkpointsForProject: total,
    }, null, 2));
    return 0;
  }

  const t = checkpoint.task;
  const lines: string[] = [];
  lines.push(missing.length > 0 ? 'BRB — Checkpoint partially saved' : 'BRB — Checkpoint saved');
  lines.push('');
  const where = git.available ? `${git.branch ?? 'detached HEAD'} @ ${git.head?.slice(0, 8) ?? 'no commits'}` : 'no git';
  lines.push(step('✓', 'Project', `${project.name} · ${where}`));
  if (git.available) {
    const wt = git.workingTree;
    const n = wt.modified.length + wt.added.length + wt.deleted.length + wt.renamed.length + wt.untracked.length + wt.conflicted.length;
    const hashed = checkpoint.snapshot.files.filter((f) => f.sha256 !== null).length;
    const capped = wt.truncated ? ` (capped; git reported ${wt.total})` : '';
    lines.push(step('✓', 'Repository', n === 0 ? 'working tree clean' : `${plural(n, 'changed path')} recorded${capped} · ${plural(hashed, 'file')} fingerprinted`));
  } else {
    lines.push(step('–', 'Repository', `git unavailable (${git.reason}); relevant files fingerprinted only`));
  }
  const background = checkpoint.environment.backgroundWork;
  if (background.length > 0) {
    lines.push(step('!', 'Background', `${plural(background.length, 'task')} still running; files may change after this checkpoint`));
    for (const b of background.slice(0, 5)) lines.push(sub(`- ${firstLine(b)}`));
  }
  const taskParts = [
    t.objective ? 'objective' : 'objective missing',
    t.nextAction ? 'next step' : 'next step missing',
    `${t.completed.length} done, ${t.inProgress.length} in progress, ${t.remaining.length} left`,
  ];
  lines.push(step(missing.length > 0 ? '✗' : '✓', 'Task', taskParts.join(' · ')));
  const ctxParts = [plural(checkpoint.decisions.length, 'decision'), plural(checkpoint.blockers.length, 'blocker'), plural(checkpoint.tests.length, 'test result')];
  if (checkpoint.files.length > 0) ctxParts.push(plural(checkpoint.files.length, 'key file'));
  lines.push(step('✓', 'Context', ctxParts.join(' · ')));
  lines.push(checkpoint.redactions > 0
    ? step('!', 'Privacy', `${checkpoint.redactions} value(s) that looked like secrets were redacted`)
    : step('✓', 'Privacy', 'no secret-like values found'));
  if (result.handoffError) lines.push(step('!', 'Handoff', `could not be written (${result.handoffError}); the checkpoint itself is saved`));
  if (config.autoBRB.enabled) lines.push(step('✓', 'Auto-BRB', 'on'));
  lines.push(step('✓', 'Stored', `checkpoint ${shortId(checkpoint)} · ${elapsed(started)}`));
  lines.push(sub(tildePath(result.file)));
  for (const e of configErrors) lines.push(step('!', 'Config', e));
  lines.push('');
  if (t.nextAction) lines.push(`Next → ${firstLine(t.nextAction)}`);
  if (missing.length > 0) lines.push(`Missing: ${missing.join(', ')}. Run /brb again with these details for a complete checkpoint.`);
  lines.push('');
  lines.push(missing.length > 0 ? 'The checkpoint is usable, but incomplete.' : 'You can leave now.');
  if (background.length > 0) lines.push('Background work keeps running while you are away. It stops if you close this session.');
  lines.push('Run /brb continue when you\'re back.');
  ctx.stdout(lines.join('\n'));
  return 0;
}

function firstLine(s: string): string {
  const l = s.split('\n')[0] ?? '';
  return l.length > 160 ? `${l.slice(0, 159)}…` : l;
}
