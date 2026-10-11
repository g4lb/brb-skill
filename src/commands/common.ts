import * as fs from 'node:fs';
import * as path from 'node:path';
import { gitTopLevel } from '../checkpoint/git.js';
import { brbHome, projectIdentity, type ProjectIdentity } from '../checkpoint/paths.js';
import { BrbError } from '../utils/errors.js';
import { safeLine } from '../security/sanitize.js';
import type { Checkpoint } from '../checkpoint/types.js';

export interface CommandContext {
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  /** Reads all of stdin; undefined when stdin is a terminal. */
  readStdin: () => string | undefined;
  now: () => Date;
}

export interface Flags {
  [key: string]: string | boolean | undefined;
}

export interface ParsedArgs {
  positionals: string[];
  flags: Flags;
}

/** `--key value`, `--key=value`, and boolean `--flag`. Boolean-only flags are listed so they never swallow a value. */
export function parseArgs(argv: string[], booleans: readonly string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags: Flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? '';
    if (a === '--') {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const key = eq > 0 ? a.slice(2, eq) : a.slice(2);
      if (eq > 0) flags[key] = a.slice(eq + 1);
      else if (booleans.includes(key)) flags[key] = true;
      else {
        const next = argv[i + 1];
        if (next === undefined || next.startsWith('--')) throw new BrbError('USAGE', `--${key} needs a value.`);
        flags[key] = next;
        i++;
      }
    } else {
      positionals.push(a);
    }
  }
  return { positionals, flags };
}

export function flagString(flags: Flags, key: string): string | undefined {
  const v = flags[key];
  return typeof v === 'string' ? v : undefined;
}

/**
 * Identify the project for `cwd`: the git top-level directory when inside a
 * repository, otherwise the directory itself.
 */
export function resolveProject(cwd: string, env: NodeJS.ProcessEnv): ProjectIdentity {
  let dir: string;
  try {
    dir = fs.realpathSync.native(cwd);
  } catch {
    throw new BrbError('NO_PROJECT', `Working directory ${cwd} does not exist.`);
  }
  if (!fs.statSync(dir).isDirectory()) throw new BrbError('NO_PROJECT', `${cwd} is not a directory.`);
  const top = gitTopLevel(dir);
  const root = top ? path.resolve(top) : dir;
  const home = brbHome(env);
  if (isSameOrInside(home, root)) {
    throw new BrbError('NO_PROJECT', `Refusing to checkpoint BRB's own storage directory (${home}).`, 'Run BRB from your project directory.');
  }
  // Inside a git repository, checkpoints would show up as untracked files and change the state BRB compares.
  if (top && isSameOrInside(root, home)) {
    throw new BrbError('CONFIG', `BRB_HOME (${home}) is inside this project; checkpoints must be stored outside the working tree.`, 'Set BRB_HOME to a directory outside the project, or unset it to use ~/.brb.');
  }
  return projectIdentity(root, home);
}

function isSameOrInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export function relativeTime(iso: string, now: Date): string {
  const ms = now.getTime() - Date.parse(iso);
  if (!Number.isFinite(ms)) return 'unknown time';
  if (ms < 0) return 'in the future (clock skew?)';
  const m = Math.floor(ms / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.floor(h / 24)} days ago`;
}

export function shortId(cp: Checkpoint): string {
  return cp.checkpointId.slice(0, 8);
}

export function describeCheckpoint(cp: Checkpoint, now: Date): string {
  const kind = cp.type === 'manual' ? 'manual' : `auto: ${cp.trigger}`;
  const branch = cp.git.available ? (cp.git.branch ?? 'detached') : 'no git';
  return safeLine(`${shortId(cp)}  ${cp.createdAt.replace('T', ' ').replace(/\.\d+Z$/, 'Z')}  (${relativeTime(cp.createdAt, now)})  ${kind}${cp.partial ? ', partial' : ''}  [${branch}]`);
}
