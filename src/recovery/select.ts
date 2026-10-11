import type { StoredCheckpoint } from '../checkpoint/store.js';
import { compareNewestFirst } from '../checkpoint/store.js';

export interface Selection {
  selected: StoredCheckpoint | null;
  /** Why this checkpoint was chosen, in one sentence. */
  reason: string;
  /** True when the developer should confirm which checkpoint to use before work resumes. */
  needsChoice: boolean;
  /** Other plausible candidates, newest first. */
  alternatives: StoredCheckpoint[];
  /** True when no checkpoint matched the current branch and one from another branch was selected. */
  branchMismatch: boolean;
  error?: string;
}

/**
 * Choose a checkpoint deterministically.
 *
 * 1. An explicit id (or unique id prefix) always wins.
 * 2. Prefer checkpoints recorded on the current branch; fall back to all.
 * 3. The latest manual checkpoint wins over an older automatic one.
 * 4. An automatic checkpoint newer than the latest manual one does not
 *    silently replace it: if the repository changed between them, the manual
 *    one is selected and the conflict is surfaced for the developer to choose.
 */
export function selectCheckpoint(all: StoredCheckpoint[], currentBranch: string | null, requestedId?: string): Selection {
  const sorted = [...all].sort(compareNewestFirst);
  const none: Selection = { selected: null, reason: '', needsChoice: false, alternatives: [], branchMismatch: false };

  if (requestedId) {
    const id = requestedId.toLowerCase();
    if (!/^[0-9a-f-]{4,36}$/.test(id)) return { ...none, error: `"${requestedId}" is not a valid checkpoint id.` };
    const matches = sorted.filter((s) => s.checkpoint.checkpointId.startsWith(id));
    if (matches.length === 0) return { ...none, error: `No valid checkpoint with id ${requestedId} for this project.` };
    if (matches.length > 1) return { ...none, error: `Id prefix ${requestedId} matches ${matches.length} checkpoints; use more characters.` };
    const selected = matches[0] ?? null;
    return { ...none, selected, reason: 'selected by id' };
  }

  if (sorted.length === 0) return { ...none, reason: 'no valid checkpoints for this project' };

  const onBranch = currentBranch === null ? [] : sorted.filter((s) => s.checkpoint.git.available && s.checkpoint.git.branch === currentBranch);
  const branchMismatch = currentBranch !== null && onBranch.length === 0 && sorted.some((s) => s.checkpoint.git.available);
  const pool = onBranch.length > 0 ? onBranch : sorted;
  const scope = onBranch.length > 0 ? `on branch ${currentBranch}` : 'for this project';

  const manual = pool.find((s) => s.checkpoint.type === 'manual');
  const auto = pool.find((s) => s.checkpoint.type === 'auto');
  const others = (chosen: StoredCheckpoint) => pool.filter((s) => s !== chosen).slice(0, 4);

  if (!manual && auto) {
    return { selected: auto, reason: `latest checkpoint ${scope} (automatic; no manual checkpoint exists)`, needsChoice: false, alternatives: others(auto), branchMismatch };
  }
  if (manual && (!auto || manual.checkpoint.createdAt >= auto.checkpoint.createdAt)) {
    return { selected: manual, reason: `latest checkpoint ${scope} (manual)`, needsChoice: false, alternatives: others(manual), branchMismatch };
  }
  if (manual && auto) {
    const mg = manual.checkpoint.git;
    const ag = auto.checkpoint.git;
    const sameRepoState = mg.available && ag.available && mg.fingerprint === ag.fingerprint;
    if (sameRepoState) {
      return {
        selected: manual,
        reason: `latest manual checkpoint ${scope}; a newer automatic checkpoint exists but the repository did not change between them`,
        needsChoice: false,
        alternatives: [auto, ...others(manual).filter((s) => s !== auto)].slice(0, 4),
        branchMismatch,
      };
    }
    return {
      selected: manual,
      reason: `latest manual checkpoint ${scope}; a newer automatic checkpoint (${auto.checkpoint.trigger}) was saved after more work`,
      needsChoice: true,
      alternatives: [auto, ...others(manual).filter((s) => s !== auto)].slice(0, 4),
      branchMismatch,
    };
  }
  return { ...none, reason: 'no valid checkpoints for this project' };
}
