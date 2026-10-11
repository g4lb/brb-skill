export const SCHEMA_VERSION = 1 as const;

export type CheckpointType = 'manual' | 'auto';
export type CheckpointTrigger = 'manual' | 'pre-compact' | 'session-end' | 'milestone';

/** Where the task section of a checkpoint came from. */
export type TaskSource =
  /** Written by Claude during /brb from the live conversation. */
  | 'claude'
  /** Extracted by a hook from the session transcript (best effort). */
  | 'transcript'
  /** No task context was available; only repository metadata was recorded. */
  | 'none';

export interface FileChange {
  path: string;
  /** Git porcelain status code, e.g. " M", "A ", "??". */
  status: string;
  /** Original path, for renames and copies. */
  from?: string;
}

export interface WorkingTree {
  modified: string[];
  added: string[];
  deleted: string[];
  renamed: { from: string; to: string }[];
  untracked: string[];
  conflicted: string[];
  staged: string[];
  /** Total number of entries reported by git before any cap was applied. */
  total: number;
  /** True when the lists were capped for very large working trees. */
  truncated: boolean;
}

export type GitState =
  | {
    available: true;
    branch: string | null;
    detached: boolean;
    head: string | null;
    upstream: string | null;
    remote: string | null;
    workingTree: WorkingTree;
    /** Hash of HEAD plus the full porcelain status; equal fingerprints mean an unchanged repository state. */
    fingerprint: string;
  }
  | {
    available: false;
    reason: string;
  };

export interface FileSnapshot {
  path: string;
  /** SHA-256 of file content at checkpoint time; null when not hashed (missing, too large, sensitive, symlink). */
  sha256: string | null;
  size: number | null;
  skipped?: 'missing' | 'too-large' | 'sensitive' | 'symlink' | 'not-a-file' | 'outside-project' | 'limit';
}

export interface TestRecord {
  command: string;
  result: 'passed' | 'failed' | 'partial' | 'not-run' | 'unknown';
  summary?: string;
}

export interface RelevantFile {
  path: string;
  note?: string;
}

export interface TaskState {
  source: TaskSource;
  objective: string | null;
  completed: string[];
  inProgress: string[];
  remaining: string[];
  nextAction: string | null;
}

export interface Checkpoint {
  schemaVersion: typeof SCHEMA_VERSION;
  checkpointId: string;
  createdAt: string;
  type: CheckpointType;
  trigger: CheckpointTrigger;
  /** True when required task fields (objective, next action) were missing at save time. */
  partial: boolean;
  producer: { name: 'brb'; version: string };
  session: { id: string | null };
  project: {
    root: string;
    identity: string;
    name: string;
  };
  git: GitState;
  task: TaskState;
  files: RelevantFile[];
  snapshot: { files: FileSnapshot[]; truncated: boolean };
  decisions: string[];
  blockers: string[];
  assumptions: string[];
  tests: TestRecord[];
  environment: {
    platform: string;
    nodeVersion: string;
    relevantTools: string[];
    /** Processes Claude reported as relevant (BRB does not inspect the OS process table). */
    runningProcesses: string[];
  };
  /** Raw context extracted from the transcript by automatic checkpoints. */
  context: {
    recentUserPrompts: string[];
    lastAssistantMessage: string | null;
  } | null;
  notes: string | null;
  resume: {
    instructions: string | null;
    warnings: string[];
  };
  redactions: number;
  integrity: { algorithm: 'sha256'; digest: string };
}

/** Task context that Claude supplies to `brb save`. */
export interface SaveInput {
  objective?: string;
  completed?: string[];
  inProgress?: string[];
  remaining?: string[];
  nextAction?: string;
  decisions?: string[];
  blockers?: string[];
  assumptions?: string[];
  tests?: TestRecord[];
  files?: (RelevantFile | string)[];
  runningProcesses?: string[];
  relevantTools?: string[];
  notes?: string;
  resumeInstructions?: string;
  warnings?: string[];
}
