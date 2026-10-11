import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildCheckpoint } from '../checkpoint/build.js';
import { collectGitState } from '../checkpoint/git.js';
import { renderHandoff } from '../checkpoint/handoff.js';
import { brbHome } from '../checkpoint/paths.js';
import { listCheckpoints, pruneAuto, readState, withProjectLock, writeCheckpoint, writeState } from '../checkpoint/store.js';
import { extractTranscript, isPlausibleTranscriptPath } from '../checkpoint/transcript.js';
import { loadConfig } from '../config/config.js';
import { errorMessage } from '../utils/errors.js';
import { isPlainObject } from '../utils/json.js';
import { ensurePrivateDir } from '../utils/fs.js';
import { latestUnresumed } from './resume.js';
import { relativeTime, resolveProject, shortId } from './common.js';
export const HOOK_EVENTS = ['pre-compact', 'session-end', 'session-start', 'post-tool-use'];
const DEDUPE_WINDOW_MS = 60_000;
const MILESTONE_MIN_INTERVAL_MS = 10 * 60_000;
const COMPACT_HINT_WINDOW_MS = 15 * 60_000;
const RESUME_HINT_MAX_AGE_MS = 14 * 86_400_000;
const RECURSION_ENV = 'BRB_HOOK_ACTIVE';
export function cmdHook(argv, ctx) {
    const event = argv[0];
    if (!event || !HOOK_EVENTS.includes(event)) {
        ctx.stderr(`brb hook: unknown event "${argv[0] ?? ''}" (supported: ${HOOK_EVENTS.join(', ')})`);
        return 1;
    }
    if (ctx.env[RECURSION_ENV])
        return 0; // already inside a BRB hook; never recurse
    process.env[RECURSION_ENV] = '1';
    let input = {};
    try {
        const raw = ctx.readStdin();
        const parsed = raw && raw.trim() ? JSON.parse(raw.length > 1_000_000 ? '{}' : raw) : {};
        if (isPlainObject(parsed))
            input = parsed;
    }
    catch {
        input = {};
    }
    if (ctx.env.BRB_DEBUG === '1') {
        const { tool_input: _omit, ...meta } = input;
        void _omit;
        appendLog(ctx, 'hooks-debug.log', `${event} ${JSON.stringify(meta)}`);
    }
    const cwd = typeof input.cwd === 'string' && path.isAbsolute(input.cwd) ? input.cwd : (ctx.env.CLAUDE_PROJECT_DIR ?? ctx.cwd);
    let project;
    try {
        project = resolveProject(cwd, ctx.env);
    }
    catch {
        return 0; // not a usable project directory; nothing to checkpoint
    }
    try {
        switch (event) {
            case 'session-start':
                return sessionStart(project, input, ctx);
            case 'pre-compact':
                return autoCheckpoint(project, input, 'pre-compact', ctx);
            case 'session-end':
                return autoCheckpoint(project, input, 'session-end', ctx);
            case 'post-tool-use':
                return postToolUse(project, input, ctx);
        }
    }
    catch (err) {
        const msg = `BRB: automatic checkpoint failed (${event}): ${errorMessage(err)}`;
        logHookError(ctx, msg);
        ctx.stderr(msg);
        return 1;
    }
    return 0;
}
function sessionId(input) {
    return typeof input.session_id === 'string' && input.session_id.length <= 200 ? input.session_id : null;
}
function autoCheckpoint(project, input, trigger, ctx) {
    const { config } = loadConfig(project, brbHome(ctx.env));
    const a = config.autoBRB;
    if (!a.enabled)
        return 0;
    if (trigger === 'pre-compact' && !a.beforeCompaction)
        return 0;
    if (trigger === 'session-end' && !a.onSessionEnd)
        return 0;
    if (trigger === 'milestone' && !a.onMilestone)
        return 0;
    if (input.agent_id)
        return 0; // subagent sessions are part of a parent session
    // Non-interactive `claude -p` runs end with this reason; checkpointing every scripted run would only add noise.
    if (trigger === 'session-end' && input.reason === 'prompt_input_exit')
        return 0;
    const sid = sessionId(input);
    const transcript = isPlausibleTranscriptPath(input.transcript_path) ? extractTranscript(input.transcript_path) : null;
    if (trigger === 'session-end' && transcript && transcript.userPromptCount === 0)
        return 0; // empty session
    const now = ctx.now();
    const git = collectGitState(project.root);
    const saved = withProjectLock(project, () => {
        const state = readState(project);
        // Duplicate suppression: the same trigger for the same session within a minute.
        if (state.lastAuto && state.lastAuto.trigger === trigger && state.lastAuto.sessionId === sid && now.getTime() - Date.parse(state.lastAuto.at) < DEDUPE_WINDOW_MS) {
            return null;
        }
        // Redundancy: a checkpoint for this session already captures this repository state, and the developer typed nothing since.
        if (trigger === 'session-end' && sid) {
            const latest = listCheckpoints(project).valid.find((s) => s.checkpoint.session.id === sid);
            if (latest && git.available && latest.checkpoint.git.available && latest.checkpoint.git.fingerprint === git.fingerprint &&
                (!transcript?.lastUserPromptAt || transcript.lastUserPromptAt <= latest.checkpoint.createdAt)) {
                return null;
            }
        }
        const { checkpoint } = buildCheckpoint({ project, type: 'auto', trigger, sessionId: sid, git, transcript, now });
        writeCheckpoint(project, checkpoint, renderHandoff(checkpoint));
        state.lastAuto = { sessionId: sid, trigger, at: now.toISOString(), checkpointId: checkpoint.checkpointId };
        writeState(project, state);
        pruneAuto(project, a.maxCheckpoints);
        return checkpoint;
    });
    if (saved && a.notifyOnCheckpoint && trigger !== 'session-end') {
        ctx.stdout(JSON.stringify({ systemMessage: `BRB: automatic checkpoint ${shortId(saved)} saved (${trigger}).` }));
    }
    return 0;
}
function postToolUse(project, input, ctx) {
    const { config } = loadConfig(project, brbHome(ctx.env));
    if (!config.autoBRB.enabled || !config.autoBRB.onMilestone)
        return 0;
    const sid = sessionId(input) ?? 'unknown';
    const ti = isPlainObject(input.tool_input) ? input.tool_input : {};
    let completedNow = null;
    if (input.tool_name === 'TodoWrite' && Array.isArray(ti.todos)) {
        completedNow = ti.todos.filter((t) => isPlainObject(t) && t.status === 'completed').length;
    }
    else if (input.tool_name === 'TaskUpdate' && ti.status === 'completed') {
        completedNow = -1; // a task was just completed; count is not available
    }
    if (completedNow === null)
        return 0;
    const now = ctx.now();
    const due = withProjectLock(project, () => {
        const state = readState(project);
        const prev = state.milestones[sid];
        const increased = completedNow === -1 || completedNow > (prev?.completed ?? 0);
        const tooSoon = prev !== undefined && now.getTime() - Date.parse(prev.at) < MILESTONE_MIN_INTERVAL_MS;
        if (!increased) {
            // A new, shorter task list started: track from its count so its completions count as milestones.
            if (completedNow !== -1 && prev && completedNow < prev.completed) {
                state.milestones[sid] = { completed: completedNow, at: prev.at };
                writeState(project, state);
            }
            return false;
        }
        if (tooSoon) {
            if (completedNow !== -1)
                state.milestones[sid] = { completed: completedNow, at: prev.at };
            writeState(project, state);
            return false;
        }
        state.milestones[sid] = { completed: completedNow === -1 ? (prev?.completed ?? 0) + 1 : completedNow, at: now.toISOString() };
        writeState(project, state);
        return true;
    });
    return due ? autoCheckpoint(project, input, 'milestone', ctx) : 0;
}
function sessionStart(project, input, ctx) {
    const { config } = loadConfig(project, brbHome(ctx.env));
    const now = ctx.now();
    let context = null;
    const sid = sessionId(input);
    if (input.source === 'compact' && config.autoBRB.enabled) {
        const recent = listCheckpoints(project).valid.find((s) => s.checkpoint.trigger === 'pre-compact' && s.checkpoint.session.id === sid &&
            now.getTime() - Date.parse(s.checkpoint.createdAt) < COMPACT_HINT_WINDOW_MS);
        if (recent) {
            context = `BRB saved automatic checkpoint ${shortId(recent.checkpoint)} just before this context compaction. If details of earlier work are missing from the summary, the brb continue skill can load it (run: brb resume --id ${shortId(recent.checkpoint)}).`;
        }
    }
    else if ((input.source === 'startup' || input.source === 'clear' || input.source === undefined) && config.resumeHint) {
        const cp = latestUnresumed(project);
        if (cp && now.getTime() - Date.parse(cp.createdAt) < RESUME_HINT_MAX_AGE_MS) {
            const branch = cp.git.available ? (cp.git.branch ?? 'detached HEAD') : 'no git';
            // Only metadata is injected here, never checkpoint text, so a tampered checkpoint cannot inject instructions at startup.
            context = `A BRB checkpoint (${cp.type}, saved ${relativeTime(cp.createdAt, now)}, branch ${branch}) exists for this project and has not been resumed. If the developer says they are back or asks to continue earlier work, use the BRB continue skill.`;
        }
    }
    if (context) {
        ctx.stdout(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context } }));
    }
    return 0;
}
function logHookError(ctx, msg) {
    appendLog(ctx, 'hook-errors.log', msg);
}
function appendLog(ctx, name, msg) {
    try {
        const dir = path.join(brbHome(ctx.env), 'logs');
        ensurePrivateDir(dir);
        const file = path.join(dir, name);
        try {
            if (fs.statSync(file).size > 256 * 1024)
                fs.renameSync(file, `${file}.1`);
        }
        catch { /* no log yet */ }
        fs.appendFileSync(file, `${ctx.now().toISOString()} ${msg}\n`, { mode: 0o600 });
    }
    catch { /* logging must never fail the hook */ }
}
