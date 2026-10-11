import { createHash } from 'node:crypto';
import { canonicalJson, isPlainObject } from '../utils/json.js';
import { Validator } from '../utils/validate.js';
import { isSafeRelativePath } from '../utils/fs.js';
import { SCHEMA_VERSION } from './types.js';
export const LIMITS = {
    text: 4000,
    item: 1000,
    items: 100,
    files: 300,
    pathLen: 4096,
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const SHA = /^[0-9a-f]{64}$/;
export function computeDigest(cp) {
    const { integrity: _ignored, ...rest } = cp;
    void _ignored;
    return createHash('sha256').update(canonicalJson(rest)).digest('hex');
}
/**
 * Migrations from older schema versions, keyed by the version they upgrade
 * from. Each returns a document of version + 1. Version 1 is the first
 * release, so the table is empty; it exists so future versions can load
 * checkpoints written by v1.
 */
export const MIGRATIONS = {};
/** Parse, migrate, and validate checkpoint JSON. Never throws. */
export function parseCheckpoint(json, migrations = MIGRATIONS) {
    let raw;
    try {
        raw = JSON.parse(json);
    }
    catch (err) {
        return { ok: false, reason: 'parse', message: `not valid JSON (${err.message}); the file may be truncated or damaged` };
    }
    if (!isPlainObject(raw))
        return { ok: false, reason: 'schema', message: 'top level is not an object' };
    const version = raw.schemaVersion;
    if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
        return { ok: false, reason: 'version', message: 'missing or invalid schemaVersion' };
    }
    if (version > SCHEMA_VERSION) {
        return {
            ok: false,
            reason: 'version',
            message: `schemaVersion ${version} was written by a newer BRB (this BRB reads up to ${SCHEMA_VERSION}); upgrade BRB to load it`,
        };
    }
    let doc = raw;
    let migratedFrom;
    if (version < SCHEMA_VERSION) {
        // Integrity covers the original document; check it before migrating.
        const integrity = doc.integrity;
        if (!isPlainObject(integrity) || typeof integrity.digest !== 'string' || integrity.digest !== computeDigest(doc)) {
            return { ok: false, reason: 'integrity', message: 'integrity digest does not match; the file was modified or damaged' };
        }
        migratedFrom = version;
        for (let v = version; v < SCHEMA_VERSION; v++) {
            const step = migrations[v];
            if (!step)
                return { ok: false, reason: 'version', message: `no migration available from schemaVersion ${v}` };
            doc = step(doc);
        }
        doc.integrity = { algorithm: 'sha256', digest: computeDigest(doc) };
    }
    const errors = validateCheckpointShape(doc);
    if (errors.length > 0)
        return { ok: false, reason: 'schema', message: errors.slice(0, 5).join('; ') };
    const cp = doc;
    if (cp.integrity.digest !== computeDigest(cp)) {
        return { ok: false, reason: 'integrity', message: 'integrity digest does not match; the file was modified or damaged' };
    }
    return migratedFrom === undefined ? { ok: true, checkpoint: cp } : { ok: true, checkpoint: cp, migratedFrom };
}
const TOP_FIELDS = [
    'schemaVersion', 'checkpointId', 'createdAt', 'type', 'trigger', 'partial', 'producer', 'session', 'project',
    'git', 'task', 'files', 'snapshot', 'decisions', 'blockers', 'assumptions', 'tests', 'environment',
    'context', 'notes', 'resume', 'redactions', 'integrity',
];
export function validateCheckpointShape(doc) {
    const v = new Validator();
    if (!v.object(doc, '', TOP_FIELDS))
        return v.errors;
    for (const f of TOP_FIELDS)
        if (!(f in doc))
            v.fail(f, 'missing');
    if (!v.ok)
        return v.errors;
    const d = doc;
    v.integer(d.schemaVersion, 'schemaVersion', SCHEMA_VERSION, SCHEMA_VERSION);
    v.string(d.checkpointId, 'checkpointId', { pattern: UUID });
    v.string(d.createdAt, 'createdAt', { pattern: ISO });
    v.oneOf(d.type, 'type', ['manual', 'auto']);
    v.oneOf(d.trigger, 'trigger', ['manual', 'pre-compact', 'session-end', 'milestone']);
    v.boolean(d.partial, 'partial');
    if (v.object(d.producer, 'producer', ['name', 'version'])) {
        v.oneOf(d.producer.name, 'producer.name', ['brb']);
        v.string(d.producer.version, 'producer.version', { max: 64 });
    }
    if (v.object(d.session, 'session', ['id']))
        v.string(d.session.id, 'session.id', { max: 200, nullable: true });
    if (v.object(d.project, 'project', ['root', 'identity', 'name'])) {
        v.string(d.project.root, 'project.root', { max: LIMITS.pathLen });
        v.string(d.project.identity, 'project.identity', { pattern: /^[0-9a-f]{16,64}$/ });
        v.string(d.project.name, 'project.name', { max: 200 });
    }
    validateGit(v, d.git);
    if (v.object(d.task, 'task', ['source', 'objective', 'completed', 'inProgress', 'remaining', 'nextAction'])) {
        v.oneOf(d.task.source, 'task.source', ['claude', 'transcript', 'none']);
        v.string(d.task.objective, 'task.objective', { max: LIMITS.text, nullable: true });
        v.string(d.task.nextAction, 'task.nextAction', { max: LIMITS.text, nullable: true });
        for (const k of ['completed', 'inProgress', 'remaining'])
            v.stringArray(d.task[k], `task.${k}`, LIMITS.items, LIMITS.item);
    }
    v.array(d.files, 'files', LIMITS.files, (el, p) => {
        if (v.object(el, p, ['path', 'note'])) {
            if (v.string(el.path, `${p}.path`, { max: LIMITS.pathLen }) && !isSafeRelativePath(el.path))
                v.fail(`${p}.path`, 'must be a project-relative path without ".."');
            v.string(el.note, `${p}.note`, { max: LIMITS.item, optional: true });
        }
    });
    if (v.object(d.snapshot, 'snapshot', ['files', 'truncated'])) {
        v.boolean(d.snapshot.truncated, 'snapshot.truncated');
        v.array(d.snapshot.files, 'snapshot.files', 2000, (el, p) => {
            if (v.object(el, p, ['path', 'sha256', 'size', 'skipped'])) {
                if (v.string(el.path, `${p}.path`, { max: LIMITS.pathLen }) && !isSafeRelativePath(el.path))
                    v.fail(`${p}.path`, 'must be a project-relative path without ".."');
                v.string(el.sha256, `${p}.sha256`, { pattern: SHA, nullable: true });
                v.integer(el.size, `${p}.size`, 0, Number.MAX_SAFE_INTEGER, { nullable: true });
                if (el.skipped !== undefined)
                    v.oneOf(el.skipped, `${p}.skipped`, ['missing', 'too-large', 'sensitive', 'symlink', 'not-a-file', 'outside-project', 'limit']);
            }
        });
    }
    for (const k of ['decisions', 'blockers', 'assumptions'])
        v.stringArray(d[k], k, LIMITS.items, LIMITS.item);
    v.array(d.tests, 'tests', LIMITS.items, (el, p) => validateTest(v, el, p));
    if (v.object(d.environment, 'environment', ['platform', 'nodeVersion', 'relevantTools', 'runningProcesses'])) {
        v.string(d.environment.platform, 'environment.platform', { max: 64 });
        v.string(d.environment.nodeVersion, 'environment.nodeVersion', { max: 64 });
        v.stringArray(d.environment.relevantTools, 'environment.relevantTools', LIMITS.items, LIMITS.item);
        v.stringArray(d.environment.runningProcesses, 'environment.runningProcesses', LIMITS.items, LIMITS.item);
    }
    if (d.context !== null && v.object(d.context, 'context', ['recentUserPrompts', 'lastAssistantMessage'])) {
        v.stringArray(d.context.recentUserPrompts, 'context.recentUserPrompts', 20, LIMITS.text);
        v.string(d.context.lastAssistantMessage, 'context.lastAssistantMessage', { max: LIMITS.text, nullable: true });
    }
    v.string(d.notes, 'notes', { max: LIMITS.text, nullable: true });
    if (v.object(d.resume, 'resume', ['instructions', 'warnings'])) {
        v.string(d.resume.instructions, 'resume.instructions', { max: LIMITS.text, nullable: true });
        v.stringArray(d.resume.warnings, 'resume.warnings', LIMITS.items, LIMITS.item);
    }
    v.integer(d.redactions, 'redactions', 0, Number.MAX_SAFE_INTEGER);
    if (v.object(d.integrity, 'integrity', ['algorithm', 'digest'])) {
        v.oneOf(d.integrity.algorithm, 'integrity.algorithm', ['sha256']);
        v.string(d.integrity.digest, 'integrity.digest', { pattern: SHA });
    }
    return v.errors;
}
function validateTest(v, el, p) {
    if (v.object(el, p, ['command', 'result', 'summary'])) {
        v.string(el.command, `${p}.command`, { max: LIMITS.item });
        v.oneOf(el.result, `${p}.result`, ['passed', 'failed', 'partial', 'not-run', 'unknown']);
        v.string(el.summary, `${p}.summary`, { max: LIMITS.item, optional: true });
    }
}
function validateGit(v, git) {
    if (!v.object(git, 'git'))
        return;
    if (git.available === false) {
        v.object(git, 'git', ['available', 'reason']);
        v.string(git.reason, 'git.reason', { max: LIMITS.item });
        return;
    }
    if (!v.object(git, 'git', ['available', 'branch', 'detached', 'head', 'upstream', 'remote', 'workingTree', 'fingerprint']))
        return;
    v.boolean(git.available, 'git.available');
    v.string(git.branch, 'git.branch', { max: LIMITS.pathLen, nullable: true });
    v.boolean(git.detached, 'git.detached');
    v.string(git.head, 'git.head', { pattern: /^[0-9a-f]{40,64}$/, nullable: true });
    v.string(git.upstream, 'git.upstream', { max: LIMITS.pathLen, nullable: true });
    v.string(git.remote, 'git.remote', { max: LIMITS.pathLen, nullable: true });
    v.string(git.fingerprint, 'git.fingerprint', { pattern: SHA });
    const wt = git.workingTree;
    if (v.object(wt, 'git.workingTree', ['modified', 'added', 'deleted', 'renamed', 'untracked', 'conflicted', 'staged', 'total', 'truncated'])) {
        for (const k of ['modified', 'added', 'deleted', 'untracked', 'conflicted', 'staged']) {
            v.array(wt[k], `git.workingTree.${k}`, 2000, (el, p) => {
                if (v.string(el, p, { max: LIMITS.pathLen }) && !isSafeRelativePath(el))
                    v.fail(p, 'must be a project-relative path without ".."');
            });
        }
        v.array(wt.renamed, 'git.workingTree.renamed', 2000, (el, p) => {
            if (v.object(el, p, ['from', 'to'])) {
                for (const k of ['from', 'to']) {
                    if (v.string(el[k], `${p}.${k}`, { max: LIMITS.pathLen }) && !isSafeRelativePath(el[k]))
                        v.fail(`${p}.${k}`, 'must be a project-relative path without ".."');
                }
            }
        });
        v.integer(wt.total, 'git.workingTree.total', 0, Number.MAX_SAFE_INTEGER);
        v.boolean(wt.truncated, 'git.workingTree.truncated');
    }
}
const SAVE_FIELDS = [
    'objective', 'completed', 'inProgress', 'remaining', 'nextAction', 'decisions', 'blockers', 'assumptions',
    'tests', 'files', 'runningProcesses', 'relevantTools', 'notes', 'resumeInstructions', 'warnings',
];
/** Strictly validate task input supplied to `brb save`. */
export function validateSaveInput(raw) {
    const v = new Validator();
    if (!v.object(raw, '', SAVE_FIELDS))
        return { ok: false, errors: v.errors };
    const d = raw;
    v.string(d.objective, 'objective', { max: LIMITS.text, optional: true });
    v.string(d.nextAction, 'nextAction', { max: LIMITS.text, optional: true });
    v.string(d.notes, 'notes', { max: LIMITS.text, optional: true });
    v.string(d.resumeInstructions, 'resumeInstructions', { max: LIMITS.text, optional: true });
    for (const k of ['completed', 'inProgress', 'remaining', 'decisions', 'blockers', 'assumptions', 'runningProcesses', 'relevantTools', 'warnings']) {
        if (d[k] !== undefined)
            v.stringArray(d[k], k, LIMITS.items, LIMITS.item);
    }
    if (d.tests !== undefined)
        v.array(d.tests, 'tests', LIMITS.items, (el, p) => validateTest(v, el, p));
    if (d.files !== undefined) {
        v.array(d.files, 'files', LIMITS.files, (el, p) => {
            const pathValue = typeof el === 'string' ? el : (v.object(el, p, ['path', 'note']) ? el.path : undefined);
            if (typeof el !== 'string' && isPlainObject(el))
                v.string(el.note, `${p}.note`, { max: LIMITS.item, optional: true });
            if (v.string(pathValue, typeof el === 'string' ? p : `${p}.path`, { max: LIMITS.pathLen }) && !isSafeRelativePath(pathValue)) {
                v.fail(p, 'must be a project-relative path without ".." (absolute paths are not accepted)');
            }
        });
    }
    return v.ok ? { ok: true, input: d } : { ok: false, errors: v.errors };
}
