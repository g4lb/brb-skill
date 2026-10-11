import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import { BrbError, sysCode } from './errors.js';
const isWindows = process.platform === 'win32';
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;
/**
 * Create `dir` (and parents) with private permissions. Refuses to use a path
 * whose final component is a symlink or a non-directory, so a planted link
 * cannot redirect checkpoint writes elsewhere.
 */
export function ensurePrivateDir(dir) {
    let st;
    try {
        st = fs.lstatSync(dir);
    }
    catch (err) {
        if (sysCode(err) !== 'ENOENT')
            throw err;
    }
    if (!st) {
        fs.mkdirSync(dir, { recursive: true, mode: DIR_MODE });
        st = fs.lstatSync(dir);
    }
    if (st.isSymbolicLink()) {
        throw new BrbError('UNSAFE_PATH', `Refusing to use ${dir}: it is a symbolic link.`, 'Remove the link or set BRB_HOME to a real directory.');
    }
    if (!st.isDirectory()) {
        throw new BrbError('UNSAFE_PATH', `Refusing to use ${dir}: it is not a directory.`);
    }
    if (!isWindows && (st.mode & 0o077) !== 0 && typeof process.getuid === 'function' && st.uid === process.getuid()) {
        fs.chmodSync(dir, DIR_MODE);
    }
}
/**
 * Write a file atomically: write to a unique temp file in the same directory,
 * fsync, then rename over the target. Readers see the old or the new content,
 * never a partial file.
 */
export function atomicWriteFile(target, data) {
    const dir = path.dirname(target);
    ensurePrivateDir(dir);
    assertNotSymlink(target);
    const tmp = path.join(dir, `.${path.basename(target)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
    let fd;
    try {
        fd = fs.openSync(tmp, 'wx', FILE_MODE);
        fs.writeSync(fd, data);
        fs.fsyncSync(fd);
        fs.closeSync(fd);
        fd = undefined;
        fs.renameSync(tmp, target);
    }
    catch (err) {
        if (fd !== undefined) {
            try {
                fs.closeSync(fd);
            }
            catch { /* already failing */ }
        }
        try {
            fs.unlinkSync(tmp);
        }
        catch { /* temp may not exist */ }
        throw err;
    }
}
function assertNotSymlink(file) {
    try {
        if (fs.lstatSync(file).isSymbolicLink()) {
            throw new BrbError('UNSAFE_PATH', `Refusing to write ${file}: it is a symbolic link.`);
        }
    }
    catch (err) {
        if (sysCode(err) !== 'ENOENT')
            throw err;
    }
}
/**
 * Read a regular file, refusing symlinks and files over `maxBytes`.
 * Returns undefined when the file does not exist.
 */
export function readRegularFile(file, maxBytes) {
    let st;
    try {
        st = fs.lstatSync(file);
    }
    catch (err) {
        if (sysCode(err) === 'ENOENT')
            return undefined;
        throw err;
    }
    if (st.isSymbolicLink()) {
        throw new BrbError('UNSAFE_PATH', `Refusing to read ${file}: it is a symbolic link.`);
    }
    if (!st.isFile()) {
        throw new BrbError('UNSAFE_PATH', `Refusing to read ${file}: it is not a regular file.`);
    }
    if (st.size > maxBytes) {
        throw new BrbError('TOO_LARGE', `Refusing to read ${file}: ${st.size} bytes exceeds the ${maxBytes}-byte limit.`);
    }
    return fs.readFileSync(file, 'utf8');
}
/** Read at most the last `maxBytes` of a regular file. */
export function readTail(file, maxBytes) {
    const st = fs.lstatSync(file);
    if (!st.isFile())
        throw new BrbError('UNSAFE_PATH', `${file} is not a regular file.`);
    const start = Math.max(0, st.size - maxBytes);
    const length = st.size - start;
    const buf = Buffer.alloc(length);
    const fd = fs.openSync(file, 'r');
    try {
        let read = 0;
        while (read < length) {
            const n = fs.readSync(fd, buf, read, length - read, start + read);
            if (n === 0)
                break;
            read += n;
        }
    }
    finally {
        fs.closeSync(fd);
    }
    return { text: buf.toString('utf8'), truncated: start > 0 };
}
/**
 * True when `child` resolves to a location inside `parent` (or equal to it).
 * Both are resolved first; this prevents `..` traversal.
 */
export function isInside(parent, child) {
    const rel = path.relative(path.resolve(parent), path.resolve(child));
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}
/** Validate a repository-relative path recorded in a checkpoint. */
export function isSafeRelativePath(p) {
    if (p.length === 0 || p.length > 4096)
        return false;
    if (p.includes('\0'))
        return false;
    if (path.isAbsolute(p) || path.win32.isAbsolute(p) || /^[a-zA-Z]:/.test(p))
        return false;
    const parts = p.split(/[\\/]+/);
    return !parts.includes('..');
}
const sleepBuf = new Int32Array(new SharedArrayBuffer(4));
export function sleepSync(ms) {
    Atomics.wait(sleepBuf, 0, 0, ms);
}
/**
 * Cross-process mutual exclusion using an exclusive `mkdir`, which is atomic
 * on every supported platform. A lock older than `staleMs` is treated as
 * abandoned (for example, a process that crashed) and broken.
 */
export function withLock(lockDir, fn, opts = {}) {
    const timeoutMs = opts.timeoutMs ?? 5000;
    const staleMs = opts.staleMs ?? 30_000;
    const deadline = Date.now() + timeoutMs;
    ensurePrivateDir(path.dirname(lockDir));
    const token = `${process.pid}.${randomBytes(8).toString('hex')}`;
    const ownerFile = path.join(lockDir, 'owner');
    for (;;) {
        try {
            fs.mkdirSync(lockDir, { mode: DIR_MODE });
            break;
        }
        catch (err) {
            if (sysCode(err) !== 'EEXIST')
                throw err;
            try {
                const age = Date.now() - fs.statSync(lockDir).mtimeMs;
                if (age > staleMs) {
                    // Break a stale lock by renaming it first: rename is atomic, so only one
                    // contender can claim it, and nobody can delete a lock someone just re-created.
                    const grave = `${lockDir}.stale.${token}`;
                    fs.renameSync(lockDir, grave);
                    fs.rmSync(grave, { recursive: true, force: true });
                    continue;
                }
            }
            catch {
                continue; // lock vanished or another process broke it first; retry
            }
            if (Date.now() > deadline) {
                throw new BrbError('LOCKED', 'Another BRB operation is in progress for this project.', `Try again in a moment. If no BRB process is running, remove ${lockDir}.`);
            }
            sleepSync(25 + Math.floor(Math.random() * 50));
        }
    }
    try {
        fs.writeFileSync(ownerFile, `${token} ${new Date().toISOString()}\n`, { mode: FILE_MODE });
        return fn();
    }
    finally {
        // Release only a lock we still own; if it was broken as stale meanwhile, leave the new owner's lock alone.
        let owned = false;
        try {
            owned = fs.readFileSync(ownerFile, 'utf8').startsWith(`${token} `);
        }
        catch { /* lock gone */ }
        if (owned) {
            const grave = `${lockDir}.done.${token}`;
            try {
                fs.renameSync(lockDir, grave);
                fs.rmSync(grave, { recursive: true, force: true });
            }
            catch { /* already released */ }
        }
    }
}
