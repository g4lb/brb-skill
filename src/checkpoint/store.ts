import * as fs from 'node:fs';
import * as path from 'node:path';
import { atomicWriteFile, ensurePrivateDir, readRegularFile, withLock } from '../utils/fs.js';
import { errorMessage, sysCode } from '../utils/errors.js';
import { isPlainObject } from '../utils/json.js';
import { parseCheckpoint } from './schema.js';
import { brbHome, checkpointFileName, checkpointsDir, handoffsDir, isCheckpointFileName, type ProjectIdentity } from './paths.js';
import type { Checkpoint } from './types.js';

const MAX_CHECKPOINT_BYTES = 4 * 1024 * 1024;

export interface StoredCheckpoint {
  file: string;
  checkpoint: Checkpoint;
  migratedFrom?: number;
}

export interface BrokenCheckpoint {
  file: string;
  reason: string;
}

export interface Listing {
  valid: StoredCheckpoint[];
  broken: BrokenCheckpoint[];
  /** Leftover temp files from interrupted writes. */
  strayTemp: string[];
}

/** Per-project bookkeeping that is not part of any checkpoint (so checkpoint digests stay stable). */
export interface ProjectState {
  resumed: Record<string, string>;
  lastAuto: { sessionId: string | null; trigger: string; at: string; checkpointId: string } | null;
  milestones: Record<string, { completed: number; at: string }>;
}

export function withProjectLock<T>(project: ProjectIdentity, fn: () => T): T {
  ensureProjectDirs(project);
  return withLock(path.join(project.dir, '.lock'), fn);
}

export function ensureProjectDirs(project: ProjectIdentity): void {
  const home = path.dirname(path.dirname(project.dir));
  ensurePrivateDir(home);
  ensurePrivateDir(path.join(home, 'projects'));
  ensurePrivateDir(project.dir);
  ensurePrivateDir(checkpointsDir(project));
  ensurePrivateDir(handoffsDir(project));
}

export function handoffPathFor(project: ProjectIdentity, checkpointFile: string): string {
  return path.join(handoffsDir(project), checkpointFile.replace(/\.json$/, '.md'));
}

/**
 * Persist a checkpoint and its handoff. The JSON is written first; the
 * checkpoint counts as saved only if that write succeeds. Caller must hold
 * the project lock.
 */
export function writeCheckpoint(project: ProjectIdentity, cp: Checkpoint, handoff: string): { file: string; handoffFile: string | null; handoffError: string | null } {
  const name = checkpointFileName(cp.createdAt, cp.type, cp.checkpointId);
  const file = path.join(checkpointsDir(project), name);
  if (fs.existsSync(file)) throw new Error(`checkpoint file ${name} already exists`);
  atomicWriteFile(file, `${JSON.stringify(cp, null, 2)}\n`);
  const handoffFile = handoffPathFor(project, name);
  try {
    atomicWriteFile(handoffFile, handoff);
    return { file, handoffFile, handoffError: null };
  } catch (err) {
    return { file, handoffFile: null, handoffError: errorMessage(err) };
  }
}

export function listCheckpoints(project: ProjectIdentity): Listing {
  const dir = checkpointsDir(project);
  const out: Listing = { valid: [], broken: [], strayTemp: [] };
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch (err) {
    if (sysCode(err) === 'ENOENT') return out;
    throw err;
  }
  for (const name of names.sort()) {
    const file = path.join(dir, name);
    if (name.endsWith('.tmp')) {
      out.strayTemp.push(file);
      continue;
    }
    if (!isCheckpointFileName(name)) continue;
    let text: string | undefined;
    try {
      text = readRegularFile(file, MAX_CHECKPOINT_BYTES);
    } catch (err) {
      out.broken.push({ file, reason: errorMessage(err) });
      continue;
    }
    if (text === undefined) continue;
    const r = parseCheckpoint(text);
    if (!r.ok) {
      out.broken.push({ file, reason: r.message });
      continue;
    }
    const cp = r.checkpoint;
    if (cp.project.identity !== project.identity || cp.project.root !== project.root) {
      out.broken.push({ file, reason: `belongs to a different project (${cp.project.root})` });
      continue;
    }
    if (!name.includes(cp.checkpointId.slice(0, 8)) || !name.includes(`-${cp.type}-`)) {
      out.broken.push({ file, reason: 'file name does not match checkpoint id or type' });
      continue;
    }
    out.valid.push(r.migratedFrom === undefined ? { file, checkpoint: cp } : { file, checkpoint: cp, migratedFrom: r.migratedFrom });
  }
  out.valid.sort(compareNewestFirst);
  return out;
}

export function compareNewestFirst(a: StoredCheckpoint, b: StoredCheckpoint): number {
  const t = b.checkpoint.createdAt.localeCompare(a.checkpoint.createdAt);
  return t !== 0 ? t : b.checkpoint.checkpointId.localeCompare(a.checkpoint.checkpointId);
}

/**
 * Remove a checkpoint file and its handoff. Only files inside this project's
 * BRB checkpoint directory with a BRB file name can be removed.
 */
export function removeCheckpointFile(project: ProjectIdentity, file: string): void {
  const dir = checkpointsDir(project);
  const name = path.basename(file);
  if (path.resolve(path.dirname(file)) !== path.resolve(dir) || !(isCheckpointFileName(name) || name.endsWith('.tmp'))) {
    throw new Error(`refusing to delete ${file}: not a BRB checkpoint file`);
  }
  fs.rmSync(file, { force: true });
  if (isCheckpointFileName(name)) fs.rmSync(handoffPathFor(project, name), { force: true });
}

/** Delete the oldest automatic checkpoints beyond `keep`. Manual checkpoints are never pruned here. */
export function pruneAuto(project: ProjectIdentity, keep: number): string[] {
  const autos = listCheckpoints(project).valid.filter((s) => s.checkpoint.type === 'auto');
  const removed: string[] = [];
  for (const s of autos.slice(keep)) {
    removeCheckpointFile(project, s.file);
    removed.push(s.checkpoint.checkpointId);
  }
  return removed;
}

const EMPTY_STATE: ProjectState = { resumed: {}, lastAuto: null, milestones: {} };

export function readState(project: ProjectIdentity): ProjectState {
  try {
    const text = readRegularFile(path.join(project.dir, 'state.json'), 1024 * 1024);
    if (!text) return structuredClone(EMPTY_STATE);
    const raw: unknown = JSON.parse(text);
    if (!isPlainObject(raw)) return structuredClone(EMPTY_STATE);
    return {
      resumed: isPlainObject(raw.resumed) ? (raw.resumed as Record<string, string>) : {},
      lastAuto: isPlainObject(raw.lastAuto) ? (raw.lastAuto as unknown as ProjectState['lastAuto']) : null,
      milestones: isPlainObject(raw.milestones) ? (raw.milestones as ProjectState['milestones']) : {},
    };
  } catch {
    // State is advisory; a damaged state file must never block saving or resuming.
    return structuredClone(EMPTY_STATE);
  }
}

export function writeState(project: ProjectIdentity, state: ProjectState): void {
  // Bound the per-session maps so the file cannot grow without limit.
  const trim = <V>(m: Record<string, V>): Record<string, V> => Object.fromEntries(Object.entries(m).slice(-200));
  atomicWriteFile(path.join(project.dir, 'state.json'), `${JSON.stringify({ ...state, resumed: trim(state.resumed), milestones: trim(state.milestones) }, null, 2)}\n`);
}

/** All project directories under BRB_HOME (for diagnostics). */
export function listProjectDirs(home = brbHome()): string[] {
  try {
    return fs.readdirSync(path.join(home, 'projects')).map((n) => path.join(home, 'projects', n));
  } catch {
    return [];
  }
}
