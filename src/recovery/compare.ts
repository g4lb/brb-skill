import * as fs from 'node:fs';
import { changedPaths, collectGitState, headRelation, runGit, type GitRunner } from '../checkpoint/git.js';
import { hashFile } from '../checkpoint/snapshot.js';
import type { Checkpoint, GitState } from '../checkpoint/types.js';

export type VerificationLevel =
  /** Repository matches the checkpoint. */
  | 'passed'
  /** Repository changed since the checkpoint, but nothing contradicts it. */
  | 'changed'
  /** Branch, history or files differ in ways that need the developer's attention. */
  | 'conflict'
  /** Verification was not possible (e.g. no git, root missing). */
  | 'limited';

export interface RepoComparison {
  level: VerificationLevel;
  findings: string[];
  /** Files edited after the checkpoint was saved (content hash differs). */
  modifiedSinceCheckpoint: string[];
  /** Files that were in flight at checkpoint time and are now gone. */
  missingSinceCheckpoint: string[];
  /** Files that became dirty after the checkpoint. */
  newlyChanged: string[];
  /** Files that were dirty at checkpoint time and are clean now (committed or reverted). */
  noLongerChanged: string[];
  current: GitState | null;
}

const LIST_CAP = 50;

/** Compare the current repository against a checkpoint. Read-only. */
export function compareRepository(cp: Checkpoint, root: string, git: GitRunner = runGit): RepoComparison {
  const out: RepoComparison = { level: 'passed', findings: [], modifiedSinceCheckpoint: [], missingSinceCheckpoint: [], newlyChanged: [], noLongerChanged: [], current: null };
  const raise = (lvl: VerificationLevel) => {
    const order: VerificationLevel[] = ['passed', 'limited', 'changed', 'conflict'];
    if (order.indexOf(lvl) > order.indexOf(out.level)) out.level = lvl;
  };

  if (!fs.existsSync(root)) {
    out.level = 'conflict';
    out.findings.push(`Project directory ${root} no longer exists.`);
    return out;
  }

  // File content hashes work with or without git.
  for (const snap of cp.snapshot.files) {
    if (snap.sha256 === null) continue;
    const now = hashFile(root, snap.path);
    if (now.skipped === 'missing') out.missingSinceCheckpoint.push(snap.path);
    else if (now.sha256 !== null && now.sha256 !== snap.sha256) out.modifiedSinceCheckpoint.push(snap.path);
  }

  const then = cp.git;
  const current = collectGitState(root, git);
  out.current = current;

  if (!then.available || !current.available) {
    raise('limited');
    if (!then.available && !current.available) out.findings.push(`Git unavailable (${current.reason}); only file hashes were compared.`);
    else if (!then.available) out.findings.push('Checkpoint was saved without git information; only file hashes were compared.');
    else out.findings.push(`Git was available at checkpoint time but not now (${current.available ? '' : current.reason}).`);
  } else {
    if (then.branch !== current.branch) {
      raise('conflict');
      out.findings.push(`Branch changed: checkpoint was on ${then.branch ?? '(detached HEAD)'}, now on ${current.branch ?? '(detached HEAD)'}.`);
    }
    if (then.head && current.head) {
      const rel = headRelation(root, then.head, current.head, git);
      if (rel.kind === 'ahead') {
        raise('changed');
        out.findings.push(`${rel.commits} new commit(s) since the checkpoint (${then.head.slice(0, 8)}..${current.head.slice(0, 8)}).`);
      } else if (rel.kind === 'rewritten') {
        raise('conflict');
        out.findings.push(`HEAD moved to ${current.head.slice(0, 8)}, which does not contain the checkpoint commit ${then.head.slice(0, 8)} (reset, rebase, or different branch).`);
      } else if (rel.kind === 'unknown') {
        raise('limited');
        out.findings.push(`Could not compare commits: ${rel.error.slice(0, 200)}`);
      }
    } else if (then.head !== current.head) {
      raise('changed');
      out.findings.push(`HEAD changed from ${then.head ?? '(no commits)'} to ${current.head ?? '(no commits)'}.`);
    }

    const before = new Set(changedPaths(then.workingTree));
    const after = new Set(changedPaths(current.workingTree));
    for (const p of after) if (!before.has(p)) out.newlyChanged.push(p);
    for (const p of before) if (!after.has(p) && !out.missingSinceCheckpoint.includes(p)) out.noLongerChanged.push(p);
    if (then.workingTree.truncated || current.workingTree.truncated) {
      raise('limited');
      out.findings.push('Working tree is very large; file lists were capped, so the comparison is partial.');
    }
    if (current.workingTree.conflicted.length > 0) {
      raise('conflict');
      out.findings.push(`Unresolved merge conflicts in: ${current.workingTree.conflicted.slice(0, 10).join(', ')}.`);
    }
  }

  if (out.modifiedSinceCheckpoint.length > 0) {
    raise('changed');
    out.findings.push(`Edited after the checkpoint (re-read before changing): ${capList(out.modifiedSinceCheckpoint)}.`);
  }
  if (out.missingSinceCheckpoint.length > 0) {
    raise('conflict');
    out.findings.push(`In-progress files missing since the checkpoint: ${capList(out.missingSinceCheckpoint)}.`);
  }
  if (out.newlyChanged.length > 0) {
    raise('changed');
    out.findings.push(`Changed since the checkpoint: ${capList(out.newlyChanged)}.`);
  }
  if (out.noLongerChanged.length > 0) {
    raise('changed');
    out.findings.push(`No longer uncommitted (committed, reverted or stashed): ${capList(out.noLongerChanged)}.`);
  }
  for (const k of ['modifiedSinceCheckpoint', 'missingSinceCheckpoint', 'newlyChanged', 'noLongerChanged'] as const) {
    out[k] = out[k].slice(0, LIST_CAP);
  }
  return out;
}

function capList(items: string[], n = 15): string {
  return items.length <= n ? items.join(', ') : `${items.slice(0, n).join(', ')} and ${items.length - n} more`;
}
