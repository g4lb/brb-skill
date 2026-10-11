import * as path from 'node:path';
import { atomicWriteFile, readRegularFile } from '../utils/fs.js';
import { errorMessage } from '../utils/errors.js';
import { isPlainObject } from '../utils/json.js';
import { Validator } from '../utils/validate.js';
import { brbHome, type ProjectIdentity } from '../checkpoint/paths.js';

export interface AutoBrbConfig {
  /** Master switch for automatic checkpoints. Off by default. */
  enabled: boolean;
  /** Save before context compaction (PreCompact hook). */
  beforeCompaction: boolean;
  /** Save when a session ends (SessionEnd hook). */
  onSessionEnd: boolean;
  /** Save when a task in Claude's task list is marked completed (PostToolUse hook). */
  onMilestone: boolean;
  /** Automatic checkpoints kept per project. Manual checkpoints are not counted or pruned. */
  maxCheckpoints: number;
  /** Show a one-line message when an automatic checkpoint is saved (where Claude Code displays hook messages). */
  notifyOnCheckpoint: boolean;
}

export interface BrbConfig {
  autoBRB: AutoBrbConfig;
  /** At session start, tell Claude that an unresumed checkpoint exists for this project. */
  resumeHint: boolean;
}

export const DEFAULT_CONFIG: BrbConfig = {
  autoBRB: {
    enabled: false,
    beforeCompaction: true,
    onSessionEnd: true,
    onMilestone: false,
    maxCheckpoints: 10,
    notifyOnCheckpoint: true,
  },
  resumeHint: true,
};

const AUTO_KEYS = ['enabled', 'beforeCompaction', 'onSessionEnd', 'onMilestone', 'maxCheckpoints', 'notifyOnCheckpoint'] as const;

export type PartialConfig = { autoBRB?: Partial<AutoBrbConfig>; resumeHint?: boolean };

/** Strict validation: unknown keys and wrong types are errors, not silently ignored. */
export function validateConfig(raw: unknown, label: string): { ok: true; config: PartialConfig } | { ok: false; errors: string[] } {
  const v = new Validator();
  if (!v.object(raw, label, ['$schema', 'autoBRB', 'resumeHint'])) return { ok: false, errors: v.errors };
  if (raw.autoBRB !== undefined && v.object(raw.autoBRB, `${label}.autoBRB`, AUTO_KEYS)) {
    const a = raw.autoBRB;
    for (const k of ['enabled', 'beforeCompaction', 'onSessionEnd', 'onMilestone', 'notifyOnCheckpoint'] as const) {
      if (a[k] !== undefined) v.boolean(a[k], `${label}.autoBRB.${k}`);
    }
    if (a.maxCheckpoints !== undefined) v.integer(a.maxCheckpoints, `${label}.autoBRB.maxCheckpoints`, 1, 100);
  }
  if (raw.resumeHint !== undefined) v.boolean(raw.resumeHint, `${label}.resumeHint`);
  if (!v.ok) return { ok: false, errors: v.errors };
  const out: PartialConfig = {};
  if (raw.autoBRB !== undefined) out.autoBRB = raw.autoBRB as Partial<AutoBrbConfig>;
  if (raw.resumeHint !== undefined) out.resumeHint = raw.resumeHint as boolean;
  return { ok: true, config: out };
}

export function globalConfigPath(home = brbHome()): string {
  return path.join(home, 'config.json');
}

export function projectConfigPath(project: ProjectIdentity): string {
  return path.join(project.dir, 'config.json');
}

function readConfigFile(file: string, label: string): { config: PartialConfig; error: string | null; exists: boolean } {
  let text: string | undefined;
  try {
    text = readRegularFile(file, 256 * 1024);
  } catch (err) {
    return { config: {}, error: `${label} (${file}): ${errorMessage(err)}`, exists: true };
  }
  if (text === undefined) return { config: {}, error: null, exists: false };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { config: {}, error: `${label} (${file}) is not valid JSON: ${errorMessage(err)}`, exists: true };
  }
  const r = validateConfig(raw, label);
  if (!r.ok) return { config: {}, error: `${label} (${file}) is invalid: ${r.errors.join('; ')}`, exists: true };
  return { config: r.config, error: null, exists: true };
}

export interface EffectiveConfig {
  config: BrbConfig;
  /** Configuration problems. When present, automatic checkpointing is forced off (fail safe). */
  errors: string[];
  sources: { global: string; globalExists: boolean; project: string | null; projectExists: boolean };
}

/** Defaults, then global config, then per-project config. */
export function loadConfig(project: ProjectIdentity | null, home = brbHome()): EffectiveConfig {
  const g = readConfigFile(globalConfigPath(home), 'global config');
  const p = project ? readConfigFile(projectConfigPath(project), 'project config') : { config: {}, error: null, exists: false };
  const config: BrbConfig = {
    autoBRB: { ...DEFAULT_CONFIG.autoBRB, ...g.config.autoBRB, ...p.config.autoBRB },
    resumeHint: p.config.resumeHint ?? g.config.resumeHint ?? DEFAULT_CONFIG.resumeHint,
  };
  const errors = [g.error, p.error].filter((e): e is string => e !== null);
  if (errors.length > 0) config.autoBRB.enabled = false;
  return {
    config,
    errors,
    sources: { global: globalConfigPath(home), globalExists: g.exists, project: project ? projectConfigPath(project) : null, projectExists: p.exists },
  };
}

/** Merge `patch` into a config file, validating the result. Refuses to overwrite an invalid file. */
export function updateConfigFile(file: string, patch: PartialConfig): void {
  const current = readConfigFile(file, 'config');
  if (current.error) throw new Error(`${current.error}. Fix or remove the file, then retry.`);
  const next: Record<string, unknown> = { ...current.config };
  if (patch.autoBRB) next.autoBRB = { ...current.config.autoBRB, ...patch.autoBRB };
  if (patch.resumeHint !== undefined) next.resumeHint = patch.resumeHint;
  const r = validateConfig(next, 'config');
  if (!r.ok) throw new Error(r.errors.join('; '));
  if (isPlainObject(next)) atomicWriteFile(file, `${JSON.stringify(next, null, 2)}\n`);
}
