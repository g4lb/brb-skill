import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { isInside, isSafeRelativePath } from '../utils/fs.js';
import { isSensitivePath } from '../security/redact.js';
export const SNAPSHOT_LIMITS = { files: 500, bytesPerFile: 5 * 1024 * 1024, totalBytes: 100 * 1024 * 1024 };
/**
 * Hash the current content of `paths` (relative to `root`). Only SHA-256
 * digests and sizes are kept; content is never stored. Used on resume to
 * detect files edited after the checkpoint was taken.
 */
export function snapshotFiles(root, paths) {
    const unique = [...new Set(paths)].filter(isSafeRelativePath);
    const files = [];
    let truncated = false;
    let total = 0;
    const realRoot = safeRealpath(root) ?? root;
    for (const rel of unique) {
        if (files.length >= SNAPSHOT_LIMITS.files) {
            truncated = true;
            break;
        }
        files.push(hashOne(realRoot, rel, () => total, (n) => { total += n; }));
    }
    return { files, truncated };
}
/** Hash one file for comparison. Returns the same shape as snapshotFiles entries. */
export function hashFile(root, rel) {
    const realRoot = safeRealpath(root) ?? root;
    return hashOne(realRoot, rel, () => 0, () => undefined);
}
function hashOne(root, rel, used, add) {
    if (isSensitivePath(rel))
        return { path: rel, sha256: null, size: null, skipped: 'sensitive' };
    const abs = path.join(root, rel);
    let st;
    try {
        st = fs.lstatSync(abs);
    }
    catch {
        return { path: rel, sha256: null, size: null, skipped: 'missing' };
    }
    if (st.isSymbolicLink())
        return { path: rel, sha256: null, size: null, skipped: 'symlink' };
    if (!st.isFile())
        return { path: rel, sha256: null, size: null, skipped: 'not-a-file' };
    const parent = safeRealpath(path.dirname(abs));
    if (!parent || !isInside(root, parent))
        return { path: rel, sha256: null, size: null, skipped: 'outside-project' };
    if (st.size > SNAPSHOT_LIMITS.bytesPerFile)
        return { path: rel, sha256: null, size: st.size, skipped: 'too-large' };
    if (used() + st.size > SNAPSHOT_LIMITS.totalBytes)
        return { path: rel, sha256: null, size: st.size, skipped: 'limit' };
    try {
        const data = fs.readFileSync(abs);
        add(data.length);
        return { path: rel, sha256: createHash('sha256').update(data).digest('hex'), size: data.length };
    }
    catch {
        return { path: rel, sha256: null, size: null, skipped: 'missing' };
    }
}
function safeRealpath(p) {
    try {
        return fs.realpathSync.native(p);
    }
    catch {
        return null;
    }
}
