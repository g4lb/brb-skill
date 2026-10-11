import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { BrbError } from '../utils/errors.js';

/**
 * Root of all BRB state. Defaults to ~/.brb, outside every project working
 * tree, so checkpoints are never committed by accident and survive plugin
 * uninstall/upgrade. Override with BRB_HOME.
 */
export function brbHome(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.BRB_HOME;
  if (override && override.trim() !== '') {
    if (!path.isAbsolute(override)) {
      throw new BrbError('CONFIG', `BRB_HOME must be an absolute path (got "${override}").`);
    }
    return path.resolve(override);
  }
  return path.join(os.homedir(), '.brb');
}

export interface ProjectIdentity {
  root: string;
  identity: string;
  name: string;
  /** Directory under BRB_HOME holding this project's checkpoints. */
  dir: string;
}

/** Normalize a project root so the same directory always maps to the same identity. */
export function normalizeRoot(root: string): string {
  const resolved = realpathOfExistingPrefix(path.resolve(root));
  const real = resolved.replace(/[\\/]+$/, '') || resolved;
  return process.platform === 'win32' ? real.toLowerCase() : real;
}

/**
 * realpath() of the longest existing prefix, with the missing remainder
 * re-attached. A path that does not exist yet (e.g. a new BRB_HOME) then
 * normalizes the same way as existing paths, including Windows 8.3 names.
 */
function realpathOfExistingPrefix(p: string): string {
  const missing: string[] = [];
  let cur = p;
  for (;;) {
    try {
      return path.join(fs.realpathSync.native(cur), ...missing.reverse());
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) return p;
      missing.push(path.basename(cur));
      cur = parent;
    }
  }
}

export function projectIdentity(root: string, home = brbHome()): ProjectIdentity {
  const normalized = normalizeRoot(root);
  const identity = createHash('sha256').update(normalized).digest('hex').slice(0, 32);
  const name = path.basename(normalized) || 'root';
  const slug = name.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'project';
  return {
    root: normalized,
    identity,
    name,
    dir: path.join(home, 'projects', `${slug}-${identity.slice(0, 12)}`),
  };
}

export function checkpointsDir(p: ProjectIdentity): string {
  return path.join(p.dir, 'checkpoints');
}

export function handoffsDir(p: ProjectIdentity): string {
  return path.join(p.dir, 'handoffs');
}

const FILE_RE = /^(\d{8}T\d{6}(?:\d{3})?Z)-(manual|auto)-([0-9a-f]{8})\.json$/;

export function checkpointFileName(createdAt: string, type: string, id: string): string {
  const stamp = createdAt.replace(/[-:]/g, '').replace(/\.(\d{3})\d*Z$/, '$1Z');
  return `${stamp}-${type}-${id.slice(0, 8)}.json`;
}

export function isCheckpointFileName(name: string): boolean {
  return FILE_RE.test(name);
}
