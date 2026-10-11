import { renderHandoff } from '../checkpoint/handoff.js';
import { brbHome, checkpointsDir } from '../checkpoint/paths.js';
import { listCheckpoints, readState, removeCheckpointFile, withProjectLock, type StoredCheckpoint } from '../checkpoint/store.js';
import { collectGitState } from '../checkpoint/git.js';
import { selectCheckpoint } from '../recovery/select.js';
import { globalConfigPath, loadConfig, projectConfigPath, updateConfigFile, type AutoBrbConfig } from '../config/config.js';
import { BrbError } from '../utils/errors.js';
import { DATA_TAG, safeLine } from '../security/sanitize.js';
import { describeCheckpoint, parseArgs, resolveProject, shortId, type CommandContext } from './common.js';

export function cmdStatus(argv: string[], ctx: CommandContext): number {
  const { flags } = parseArgs(argv, ['json']);
  const project = resolveProject(ctx.cwd, ctx.env);
  const listing = listCheckpoints(project);
  const eff = loadConfig(project, brbHome(ctx.env));
  const git = collectGitState(project.root);
  const sel = selectCheckpoint(listing.valid, git.available ? git.branch : null);
  const state = readState(project);
  const now = ctx.now();
  const manual = listing.valid.filter((s) => s.checkpoint.type === 'manual').length;
  const auto = listing.valid.length - manual;

  if (flags.json) {
    ctx.stdout(JSON.stringify({
      project: { name: project.name, root: project.root, identity: project.identity, storage: project.dir },
      checkpoints: { manual, auto, broken: listing.broken.length, strayTemp: listing.strayTemp.length },
      wouldResume: sel.selected ? { checkpointId: sel.selected.checkpoint.checkpointId, reason: sel.reason, needsChoice: sel.needsChoice } : null,
      config: eff.config,
      configErrors: eff.errors,
    }, null, 2));
    return 0;
  }
  const lines = ['BRB — Status', ''];
  lines.push(`Project: ${project.name}`);
  lines.push(`Root: ${project.root}`);
  lines.push(`Storage: ${project.dir}`);
  lines.push(`Checkpoints: ${manual} manual, ${auto} automatic${listing.broken.length ? `, ${listing.broken.length} damaged` : ''}`);
  if (sel.selected) {
    const cp = sel.selected.checkpoint;
    const resumedAt = state.resumed[cp.checkpointId];
    lines.push(`/continue would load: ${describeCheckpoint(cp, now)}`);
    lines.push(`  ${sel.reason}${sel.needsChoice ? ' — you will be asked to choose' : ''}`);
    if (cp.task.objective) lines.push(`  Task: ${oneLine(cp.task.objective)}`);
    if (cp.task.nextAction) lines.push(`  Next: ${oneLine(cp.task.nextAction)}`);
    if (resumedAt) lines.push(`  Already resumed at ${resumedAt}`);
  } else {
    lines.push('/continue would load: nothing (no valid checkpoint)');
  }
  const a = eff.config.autoBRB;
  lines.push('');
  lines.push(`Auto-BRB: ${a.enabled ? 'on' : 'off'}${a.enabled ? ` (before compaction: ${onOff(a.beforeCompaction)}, session end: ${onOff(a.onSessionEnd)}, milestones: ${onOff(a.onMilestone)}, keep ${a.maxCheckpoints})` : ''}`);
  lines.push(`Resume hint at session start: ${onOff(eff.config.resumeHint)}`);
  for (const e of eff.errors) lines.push(`! ${e} — Auto-BRB is disabled until this is fixed.`);
  ctx.stdout(lines.join('\n'));
  return 0;
}

export function cmdList(argv: string[], ctx: CommandContext): number {
  const { flags } = parseArgs(argv, ['json']);
  const project = resolveProject(ctx.cwd, ctx.env);
  const listing = listCheckpoints(project);
  const state = readState(project);
  const now = ctx.now();
  if (flags.json) {
    ctx.stdout(JSON.stringify({
      checkpoints: listing.valid.map((s) => ({
        checkpointId: s.checkpoint.checkpointId, createdAt: s.checkpoint.createdAt, type: s.checkpoint.type, trigger: s.checkpoint.trigger,
        partial: s.checkpoint.partial, branch: s.checkpoint.git.available ? s.checkpoint.git.branch : null,
        objective: s.checkpoint.task.objective, resumedAt: state.resumed[s.checkpoint.checkpointId] ?? null, file: s.file,
      })),
      broken: listing.broken,
    }, null, 2));
    return 0;
  }
  const lines = [`BRB — Checkpoints for ${project.name}`, ''];
  if (listing.valid.length === 0) lines.push('No valid checkpoints.');
  for (const s of listing.valid) {
    const cp = s.checkpoint;
    lines.push(`${describeCheckpoint(cp, now)}${state.resumed[cp.checkpointId] ? '  resumed' : ''}`);
    lines.push(`          ${cp.task.objective ? oneLine(cp.task.objective) : cp.task.source === 'transcript' ? '(automatic — task extracted from transcript)' : '(no objective recorded)'}`);
  }
  if (listing.broken.length > 0) {
    lines.push('', 'Damaged (skipped):');
    for (const b of listing.broken) lines.push(`  ${safeLine(b.file)}: ${safeLine(b.reason)}`);
  }
  lines.push('', `Storage: ${checkpointsDir(project)}`);
  ctx.stdout(lines.join('\n'));
  return 0;
}

export function cmdShow(argv: string[], ctx: CommandContext): number {
  const { positionals, flags } = parseArgs(argv, ['json']);
  const project = resolveProject(ctx.cwd, ctx.env);
  const listing = listCheckpoints(project);
  const id = positionals[0];
  const sel = selectCheckpoint(listing.valid, null, id);
  const chosen = id ? sel.selected : listing.valid[0] ?? null;
  if (!chosen) throw new BrbError('NOT_FOUND', sel.error ?? 'No valid checkpoint for this project.');
  if (flags.json) ctx.stdout(JSON.stringify(chosen.checkpoint, null, 2));
  else ctx.stdout(`<${DATA_TAG} id="${chosen.checkpoint.checkpointId}">\n${renderHandoff(chosen.checkpoint).trimEnd()}\n</${DATA_TAG}>`);
  return 0;
}

interface CleanPlan {
  remove: { file: string; why: string }[];
  keep: number;
}

export function planClean(valid: StoredCheckpoint[], broken: { file: string }[], stray: string[], opts: { keepManual: number; keepAuto: number; olderThanDays: number | null; includeBroken: boolean }, now: Date): CleanPlan {
  const remove: { file: string; why: string }[] = [];
  const manual = valid.filter((s) => s.checkpoint.type === 'manual');
  const auto = valid.filter((s) => s.checkpoint.type === 'auto');
  const cutoff = opts.olderThanDays === null ? null : now.getTime() - opts.olderThanDays * 86_400_000;
  const consider = (items: StoredCheckpoint[], keep: number, label: string) => {
    items.forEach((s, i) => {
      if (i >= keep) remove.push({ file: s.file, why: `${label} beyond newest ${keep}` });
      else if (cutoff !== null && Date.parse(s.checkpoint.createdAt) < cutoff) remove.push({ file: s.file, why: `${label} older than ${opts.olderThanDays} days` });
    });
  };
  consider(manual, opts.keepManual, 'manual');
  consider(auto, opts.keepAuto, 'automatic');
  if (opts.includeBroken) for (const b of broken) remove.push({ file: b.file, why: 'damaged' });
  for (const t of stray) remove.push({ file: t, why: 'leftover temp file from an interrupted write' });
  return { remove, keep: valid.length - remove.filter((r) => valid.some((v) => v.file === r.file)).length };
}

function intFlag(flags: Record<string, unknown>, key: string, def: number, min: number, max: number): number {
  const v = flags[key];
  if (v === undefined) return def;
  const n = typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isInteger(n) || n < min || n > max) throw new BrbError('USAGE', `--${key} must be an integer from ${min} to ${max}.`);
  return n;
}

/** `brb clean` — dry run by default; deletes only BRB's own checkpoint files, and only with --yes. */
export function cmdClean(argv: string[], ctx: CommandContext): number {
  const { flags } = parseArgs(argv, ['yes', 'json', 'broken']);
  const project = resolveProject(ctx.cwd, ctx.env);
  const eff = loadConfig(project, brbHome(ctx.env));
  const opts = {
    keepManual: intFlag(flags, 'keep-manual', 10, 0, 1000),
    keepAuto: intFlag(flags, 'keep-auto', eff.config.autoBRB.maxCheckpoints, 0, 1000),
    olderThanDays: flags['older-than'] === undefined ? null : intFlag(flags, 'older-than', 30, 1, 36500),
    includeBroken: flags.broken === true,
  };
  return withProjectLock(project, () => {
    const listing = listCheckpoints(project);
    const plan = planClean(listing.valid, listing.broken, listing.strayTemp, opts, ctx.now());
    if (flags.yes) for (const r of plan.remove) removeCheckpointFile(project, r.file);
    if (flags.json) {
      ctx.stdout(JSON.stringify({ dryRun: !flags.yes, remove: plan.remove, remaining: plan.keep }, null, 2));
      return 0;
    }
    const lines = [`BRB — Clean${flags.yes ? '' : ' (dry run)'}`, ''];
    if (plan.remove.length === 0) lines.push('Nothing to remove.');
    for (const r of plan.remove) lines.push(`${flags.yes ? 'Removed' : 'Would remove'}: ${r.file} (${r.why})`);
    lines.push('', `Policy: keep newest ${opts.keepManual} manual and ${opts.keepAuto} automatic${opts.olderThanDays ? `, drop older than ${opts.olderThanDays} days` : ''}${opts.includeBroken ? ', drop damaged files' : ''}.`);
    if (!flags.yes && plan.remove.length > 0) lines.push('Nothing was deleted. Re-run with --yes to apply.');
    lines.push('Only BRB checkpoint files are affected; project files are never touched.');
    ctx.stdout(lines.join('\n'));
    return 0;
  });
}

export function cmdDelete(argv: string[], ctx: CommandContext): number {
  const { positionals, flags } = parseArgs(argv, ['yes']);
  const id = positionals[0];
  if (!id) throw new BrbError('USAGE', 'Usage: brb delete <checkpoint-id> --yes');
  const project = resolveProject(ctx.cwd, ctx.env);
  return withProjectLock(project, () => {
    const sel = selectCheckpoint(listCheckpoints(project).valid, null, id);
    if (!sel.selected) throw new BrbError('NOT_FOUND', sel.error ?? `No checkpoint ${id}.`);
    if (!flags.yes) {
      ctx.stdout(`Would delete ${describeCheckpoint(sel.selected.checkpoint, ctx.now())}\nRe-run with --yes to delete it.`);
      return 0;
    }
    removeCheckpointFile(project, sel.selected.file);
    ctx.stdout(`Deleted checkpoint ${shortId(sel.selected.checkpoint)}.`);
    return 0;
  });
}

/** `brb export` — print every valid checkpoint for this project as one JSON document. */
export function cmdExport(argv: string[], ctx: CommandContext): number {
  parseArgs(argv, []);
  const project = resolveProject(ctx.cwd, ctx.env);
  const listing = listCheckpoints(project);
  ctx.stdout(JSON.stringify({ format: 'brb-export', version: 1, exportedAt: ctx.now().toISOString(), project: { name: project.name, root: project.root }, checkpoints: listing.valid.map((s) => s.checkpoint) }, null, 2));
  return 0;
}

const AUTO_SETTINGS: Record<string, keyof AutoBrbConfig> = {
  'before-compaction': 'beforeCompaction',
  'session-end': 'onSessionEnd',
  milestone: 'onMilestone',
  notify: 'notifyOnCheckpoint',
};

/** `brb auto on|off|status [--global]`, plus `brb auto set <setting> <value>`. */
export function cmdAuto(argv: string[], ctx: CommandContext): number {
  const { positionals, flags } = parseArgs(argv, ['global', 'json']);
  const action = positionals[0] ?? 'status';
  const project = resolveProject(ctx.cwd, ctx.env);
  const home = brbHome(ctx.env);
  const file = flags.global ? globalConfigPath(home) : projectConfigPath(project);
  const scope = flags.global ? 'all projects' : `project ${project.name}`;

  if (action === 'on' || action === 'off') {
    updateConfigFile(file, { autoBRB: { enabled: action === 'on' } });
  } else if (action === 'set') {
    const [, key, value] = positionals;
    if (key === 'max') {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1 || n > 100) throw new BrbError('USAGE', 'max must be an integer from 1 to 100.');
      updateConfigFile(file, { autoBRB: { maxCheckpoints: n } });
    } else if (key === 'resume-hint') {
      if (value !== 'on' && value !== 'off') throw new BrbError('USAGE', 'Value must be on or off.');
      updateConfigFile(file, { resumeHint: value === 'on' });
    } else {
      const setting = key ? AUTO_SETTINGS[key] : undefined;
      if (!setting) throw new BrbError('USAGE', `Unknown setting "${key ?? ''}". Settings: ${[...Object.keys(AUTO_SETTINGS), 'max', 'resume-hint'].join(', ')}.`);
      if (value !== 'on' && value !== 'off') throw new BrbError('USAGE', 'Value must be on or off.');
      updateConfigFile(file, { autoBRB: { [setting]: value === 'on' } });
    }
  } else if (action !== 'status') {
    throw new BrbError('USAGE', 'Usage: brb auto on|off|status|set <setting> <value> [--global]');
  }

  const eff = loadConfig(project, home);
  const a = eff.config.autoBRB;
  if (flags.json) {
    ctx.stdout(JSON.stringify({ config: eff.config, errors: eff.errors, sources: eff.sources }, null, 2));
    return 0;
  }
  const lines: string[] = [];
  if (action === 'on' || action === 'off') lines.push(`BRB — Auto-BRB turned ${action} for ${scope}.`, '');
  else if (action === 'set') lines.push(`BRB — Setting saved for ${scope}.`, '');
  lines.push(`Auto-BRB for ${project.name}: ${a.enabled ? 'ON' : 'OFF'}`);
  lines.push(`  before compaction (PreCompact hook):   ${onOff(a.beforeCompaction)}`);
  lines.push(`  on session end (SessionEnd hook):     ${onOff(a.onSessionEnd)}`);
  lines.push(`  on task completed (PostToolUse hook): ${onOff(a.onMilestone)}`);
  lines.push(`  automatic checkpoints kept:           ${a.maxCheckpoints}`);
  lines.push(`  notify on save:                       ${onOff(a.notifyOnCheckpoint)}`);
  lines.push(`Resume hint at session start: ${onOff(eff.config.resumeHint)}`);
  lines.push(`Config: ${eff.sources.global}${eff.sources.globalExists ? '' : ' (not created)'}; ${eff.sources.project ?? ''}${eff.sources.projectExists ? '' : ' (not created)'}`);
  if (a.enabled && action === 'on') lines.push('', 'Manual checkpoints are never overwritten or pruned by Auto-BRB.');
  for (const e of eff.errors) lines.push(`! ${e} — Auto-BRB stays off until this is fixed.`);
  ctx.stdout(lines.join('\n'));
  return 0;
}

function onOff(b: boolean): string {
  return b ? 'on' : 'off';
}

function oneLine(s: string): string {
  const l = safeLine(s).replace(/\s+/g, ' ').trim();
  return l.length > 120 ? `${l.slice(0, 119)}…` : l;
}
