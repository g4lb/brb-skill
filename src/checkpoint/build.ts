import { randomUUID } from 'node:crypto';
import { redactDeep } from '../security/redact.js';
import { VERSION } from '../version.js';
import { changedPaths } from './git.js';
import { computeDigest, LIMITS, validateCheckpointShape } from './schema.js';
import { snapshotFiles } from './snapshot.js';
import type { ProjectIdentity } from './paths.js';
import type { Checkpoint, CheckpointTrigger, CheckpointType, GitState, RelevantFile, SaveInput, TaskState } from './types.js';

export interface TranscriptContext {
  recentUserPrompts: string[];
  lastAssistantMessage: string | null;
  todos: { completed: string[]; inProgress: string[]; remaining: string[] } | null;
}

export interface BuildOptions {
  project: ProjectIdentity;
  type: CheckpointType;
  trigger: CheckpointTrigger;
  sessionId: string | null;
  git: GitState;
  input?: SaveInput;
  transcript?: TranscriptContext | null;
  now?: Date;
}

const clean = (s: string | undefined | null): string | null => {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  return t === '' ? null : t;
};
const cleanList = (xs: string[] | undefined): string[] => (xs ?? []).map((x) => x.trim()).filter((x) => x !== '');

const cut = (s: string, max: number): string => (s.length <= max ? s : `${s.slice(0, max - 1)}\u2026`);
const cutNullable = (s: string | null, max: number): string | null => (s === null ? null : cut(s, max));
const cutList = (xs: string[], items: number, max: number): string[] => xs.slice(0, items).map((x) => cut(x, max));

function clampToLimits(b: Omit<Checkpoint, 'integrity'>): void {
  b.project.name = cut(b.project.name, 200);
  b.task.objective = cutNullable(b.task.objective, LIMITS.text);
  b.task.nextAction = cutNullable(b.task.nextAction, LIMITS.text);
  b.task.completed = cutList(b.task.completed, LIMITS.items, LIMITS.item);
  b.task.inProgress = cutList(b.task.inProgress, LIMITS.items, LIMITS.item);
  b.task.remaining = cutList(b.task.remaining, LIMITS.items, LIMITS.item);
  b.files = b.files.slice(0, LIMITS.files).map((f) => (f.note === undefined ? f : { ...f, note: cut(f.note, LIMITS.item) }));
  b.decisions = cutList(b.decisions, LIMITS.items, LIMITS.item);
  b.blockers = cutList(b.blockers, LIMITS.items, LIMITS.item);
  b.assumptions = cutList(b.assumptions, LIMITS.items, LIMITS.item);
  b.tests = b.tests.slice(0, LIMITS.items).map((t) => ({ ...t, command: cut(t.command, LIMITS.item), ...(t.summary === undefined ? {} : { summary: cut(t.summary, LIMITS.item) }) }));
  b.environment.relevantTools = cutList(b.environment.relevantTools, LIMITS.items, LIMITS.item);
  b.environment.runningProcesses = cutList(b.environment.runningProcesses, LIMITS.items, LIMITS.item);
  if (b.context) {
    b.context.recentUserPrompts = cutList(b.context.recentUserPrompts, 20, LIMITS.text);
    b.context.lastAssistantMessage = cutNullable(b.context.lastAssistantMessage, LIMITS.text);
  }
  b.notes = cutNullable(b.notes, LIMITS.text);
  b.resume.instructions = cutNullable(b.resume.instructions, LIMITS.text);
  b.resume.warnings = cutList(b.resume.warnings, LIMITS.items, LIMITS.item);
}

export function buildCheckpoint(o: BuildOptions): { checkpoint: Checkpoint; missing: string[] } {
  const input = o.input ?? {};
  const files: RelevantFile[] = (input.files ?? []).map((f) => (typeof f === 'string' ? { path: f } : f.note ? { path: f.path, note: f.note } : { path: f.path }));

  let task: TaskState;
  if (o.input) {
    task = {
      source: 'claude',
      objective: clean(input.objective),
      completed: cleanList(input.completed),
      inProgress: cleanList(input.inProgress),
      remaining: cleanList(input.remaining),
      nextAction: clean(input.nextAction),
    };
  } else if (o.transcript && (o.transcript.todos || o.transcript.recentUserPrompts.length > 0)) {
    const todos = o.transcript.todos;
    task = {
      source: 'transcript',
      objective: null,
      completed: todos?.completed ?? [],
      inProgress: todos?.inProgress ?? [],
      remaining: todos?.remaining ?? [],
      nextAction: null,
    };
  } else {
    task = { source: 'none', objective: null, completed: [], inProgress: [], remaining: [], nextAction: null };
  }

  const missing: string[] = [];
  if (o.type === 'manual') {
    if (!task.objective) missing.push('objective');
    if (!task.nextAction) missing.push('nextAction');
  }

  const snapshotPaths = [...(o.git.available ? changedPaths(o.git.workingTree) : []), ...files.map((f) => f.path)];
  const snapshot = snapshotFiles(o.project.root, snapshotPaths);

  const counter = { count: 0 };
  const r = <T>(v: T): T => redactDeep(v, counter);

  const body: Omit<Checkpoint, 'integrity'> = {
    schemaVersion: 1,
    checkpointId: randomUUID(),
    createdAt: (o.now ?? new Date()).toISOString(),
    type: o.type,
    trigger: o.trigger,
    partial: missing.length > 0,
    producer: { name: 'brb', version: VERSION },
    session: { id: o.sessionId },
    project: { root: o.project.root, identity: o.project.identity, name: o.project.name },
    git: o.git,
    task: r(task),
    files: r(files),
    snapshot,
    decisions: r(cleanList(input.decisions)),
    blockers: r(cleanList(input.blockers)),
    assumptions: r(cleanList(input.assumptions)),
    tests: r((input.tests ?? []).map((t) => (t.summary ? { command: t.command, result: t.result, summary: t.summary } : { command: t.command, result: t.result }))),
    environment: {
      platform: process.platform,
      nodeVersion: process.version,
      relevantTools: r(cleanList(input.relevantTools)),
      runningProcesses: r(cleanList(input.runningProcesses)),
    },
    context: o.transcript ? r({ recentUserPrompts: o.transcript.recentUserPrompts, lastAssistantMessage: o.transcript.lastAssistantMessage }) : null,
    notes: r(clean(input.notes)),
    resume: { instructions: r(clean(input.resumeInstructions)), warnings: r(cleanList(input.warnings)) },
    redactions: 0,
  };
  body.redactions = counter.count;
  // Redaction can lengthen text, so limits are enforced after it.
  clampToLimits(body);
  const checkpoint: Checkpoint = { ...body, integrity: { algorithm: 'sha256', digest: computeDigest(body) } };
  const errors = validateCheckpointShape(checkpoint);
  if (errors.length > 0) throw new Error(`internal error: built checkpoint is invalid (${errors.slice(0, 3).join('; ')}); nothing was saved`);
  return { checkpoint, missing };
}
