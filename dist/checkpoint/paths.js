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
export function brbHome(env = process.env) {
    const override = env.BRB_HOME;
    if (override && override.trim() !== '') {
        if (!path.isAbsolute(override)) {
            throw new BrbError('CONFIG', `BRB_HOME must be an absolute path (got "${override}").`);
        }
        return path.resolve(override);
    }
    return path.join(os.homedir(), '.brb');
}
/** Normalize a project root so the same directory always maps to the same identity. */
export function normalizeRoot(root) {
    let real = root;
    try {
        real = fs.realpathSync.native(root);
    }
    catch {
        real = path.resolve(root);
    }
    real = real.replace(/[\\/]+$/, '') || real;
    return process.platform === 'win32' ? real.toLowerCase() : real;
}
export function projectIdentity(root, home = brbHome()) {
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
export function checkpointsDir(p) {
    return path.join(p.dir, 'checkpoints');
}
export function handoffsDir(p) {
    return path.join(p.dir, 'handoffs');
}
const FILE_RE = /^(\d{8}T\d{6}(?:\d{3})?Z)-(manual|auto)-([0-9a-f]{8})\.json$/;
export function checkpointFileName(createdAt, type, id) {
    const stamp = createdAt.replace(/[-:]/g, '').replace(/\.(\d{3})\d*Z$/, '$1Z');
    return `${stamp}-${type}-${id.slice(0, 8)}.json`;
}
export function isCheckpointFileName(name) {
    return FILE_RE.test(name);
}
