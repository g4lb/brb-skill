import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { sanitizeRemoteUrl } from '../security/redact.js';
import { isSafeRelativePath } from '../utils/fs.js';
const MAX_ENTRIES = 1000;
const GIT_TIMEOUT_MS = 15_000;
/** Run git without a shell. Read-only commands only. */
export const runGit = (args, cwd) => {
    try {
        const stdout = execFileSync('git', ['-c', 'core.quotepath=off', '--no-optional-locks', ...args], {
            cwd,
            encoding: 'utf8',
            timeout: GIT_TIMEOUT_MS,
            maxBuffer: 64 * 1024 * 1024,
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
            env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' },
        });
        return { ok: true, stdout };
    }
    catch (err) {
        const e = err;
        if (e.code === 'ENOENT')
            return { ok: false, error: 'git is not installed or not on PATH', notFound: true };
        const stderr = typeof e.stderr === 'string' ? e.stderr.trim() : '';
        return { ok: false, error: stderr || e.message };
    }
};
/** Return the repository top-level directory for `cwd`, or null when not in a git repository. */
export function gitTopLevel(cwd, git = runGit) {
    const r = git(['rev-parse', '--show-toplevel'], cwd);
    if (!r.ok)
        return null;
    const top = r.stdout.trim();
    return top === '' ? null : top;
}
export function parsePorcelainZ(out) {
    const parts = out.split('\0');
    const entries = [];
    for (let i = 0; i < parts.length; i++) {
        const rec = parts[i];
        if (!rec || rec.length < 4)
            continue;
        const xy = rec.slice(0, 2);
        const p = rec.slice(3);
        if (xy[0] === 'R' || xy[0] === 'C' || xy[1] === 'R' || xy[1] === 'C') {
            const from = parts[++i] ?? '';
            entries.push({ xy, path: p, from });
        }
        else {
            entries.push({ xy, path: p });
        }
    }
    return { entries };
}
export function classify(entries) {
    const wt = { modified: [], added: [], deleted: [], renamed: [], untracked: [], conflicted: [], staged: [], total: entries.length, truncated: false };
    let kept = 0;
    for (const e of entries) {
        if (!isSafeRelativePath(e.path) || (e.from !== undefined && !isSafeRelativePath(e.from)))
            continue;
        if (kept >= MAX_ENTRIES) {
            wt.truncated = true;
            break;
        }
        kept++;
        const [x, y] = [e.xy[0] ?? ' ', e.xy[1] ?? ' '];
        if (e.xy === '??') {
            wt.untracked.push(e.path);
            continue;
        }
        if (e.xy === '!!')
            continue;
        if (x === 'U' || y === 'U' || e.xy === 'AA' || e.xy === 'DD') {
            wt.conflicted.push(e.path);
            continue;
        }
        if (x !== ' ' && x !== '?')
            wt.staged.push(e.path);
        if (x === 'R' || x === 'C' || y === 'R' || y === 'C') {
            wt.renamed.push({ from: e.from ?? '', to: e.path });
        }
        else if (x === 'D' || y === 'D') {
            wt.deleted.push(e.path);
        }
        else if (x === 'A') {
            wt.added.push(e.path);
        }
        else {
            wt.modified.push(e.path);
        }
    }
    return wt;
}
/** Collect branch, HEAD and working-tree state. Never modifies the repository. */
export function collectGitState(root, git = runGit) {
    const inside = git(['rev-parse', '--is-inside-work-tree'], root);
    if (!inside.ok) {
        return { available: false, reason: inside.notFound ? 'git is not installed or not on PATH' : 'not a git repository' };
    }
    if (inside.stdout.trim() !== 'true')
        return { available: false, reason: 'not inside a git working tree' };
    const headR = git(['rev-parse', '--verify', '--quiet', 'HEAD'], root);
    const head = headR.ok && /^[0-9a-f]{40,64}$/.test(headR.stdout.trim()) ? headR.stdout.trim() : null;
    const branchR = git(['symbolic-ref', '--quiet', '--short', 'HEAD'], root);
    const branch = branchR.ok ? branchR.stdout.trim() || null : null;
    const upstreamR = branch ? git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], root) : null;
    const upstream = upstreamR && upstreamR.ok ? upstreamR.stdout.trim() || null : null;
    const remoteR = git(['config', '--get', 'remote.origin.url'], root);
    const remote = remoteR.ok && remoteR.stdout.trim() ? sanitizeRemoteUrl(remoteR.stdout.trim()) : null;
    const statusR = git(['status', '--porcelain=v1', '-z', '--untracked-files=all'], root);
    if (!statusR.ok)
        return { available: false, reason: `git status failed: ${statusR.error.slice(0, 300)}` };
    const { entries } = parsePorcelainZ(statusR.stdout);
    const workingTree = classify(entries);
    const fingerprint = createHash('sha256').update(`${head ?? 'no-head'}\n${branch ?? ''}\n${statusR.stdout}`).digest('hex');
    return { available: true, branch, detached: branch === null && head !== null, head, upstream, remote, workingTree, fingerprint };
}
/** Current branch name only (cheap; no status scan). Null when detached, unborn-less, or not a repository. */
export function currentBranch(root, git = runGit) {
    const r = git(['symbolic-ref', '--quiet', '--short', 'HEAD'], root);
    return r.ok ? r.stdout.trim() || null : null;
}
/** Paths whose content is "in flight": changed relative to HEAD or untracked. */
export function changedPaths(wt) {
    return [...wt.modified, ...wt.added, ...wt.untracked, ...wt.conflicted, ...wt.renamed.map((r) => r.to)];
}
/** Relationship of `oldHead` to the current HEAD. */
export function headRelation(root, oldHead, newHead, git = runGit) {
    if (oldHead === newHead)
        return { kind: 'same' };
    const exists = git(['cat-file', '-e', `${oldHead}^{commit}`], root);
    if (!exists.ok)
        return { kind: 'rewritten' };
    const anc = git(['merge-base', '--is-ancestor', oldHead, newHead], root);
    if (!anc.ok)
        return { kind: 'rewritten' };
    const count = git(['rev-list', '--count', `${oldHead}..${newHead}`], root);
    if (!count.ok)
        return { kind: 'unknown', error: count.error };
    return { kind: 'ahead', commits: Number.parseInt(count.stdout.trim(), 10) || 0 };
}
