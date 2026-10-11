import * as fs from 'node:fs';
import * as path from 'node:path';
import { readTail } from '../utils/fs.js';
import { isPlainObject } from '../utils/json.js';
import { truncate } from '../security/sanitize.js';
import type { TranscriptContext } from './build.js';

/**
 * Best-effort extraction of recent context from a Claude Code session
 * transcript (JSONL). The transcript format is internal to Claude Code and
 * may change between releases, so every field access is defensive and any
 * failure yields less context, never an error.
 */

const TAIL_BYTES = 4 * 1024 * 1024;
const MAX_PROMPTS = 5;

export interface TranscriptSummary extends TranscriptContext {
  /** Timestamp of the newest real developer prompt, if any. */
  lastUserPromptAt: string | null;
  userPromptCount: number;
}

export function isPlausibleTranscriptPath(p: unknown): p is string {
  if (typeof p !== 'string' || p.length === 0 || p.length > 4096) return false;
  if (!path.isAbsolute(p) || !p.endsWith('.jsonl')) return false;
  try {
    const st = fs.lstatSync(p);
    return st.isFile();
  } catch {
    return false;
  }
}

function textOf(content: unknown): string | null {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts = content
      .filter((c) => isPlainObject(c) && c.type === 'text' && typeof c.text === 'string')
      .map((c) => (c as { text: string }).text);
    return parts.length > 0 ? parts.join('\n') : null;
  }
  return null;
}

function hasToolResult(content: unknown): boolean {
  return Array.isArray(content) && content.some((c) => isPlainObject(c) && c.type === 'tool_result');
}

/** Prompts that are harness-generated rather than typed by the developer. */
function isSyntheticPrompt(text: string): boolean {
  const t = text.trimStart();
  return t.startsWith('<command-') || t.startsWith('<local-command') || t.startsWith('<system-reminder>') ||
    t.startsWith('<task-notification>') || t.startsWith('Caveat:') || t.startsWith('[Request interrupted') ||
    t.startsWith('This session is being continued from a previous conversation');
}

type TodoStatus = 'pending' | 'in_progress' | 'completed';

export function extractTranscript(file: string): TranscriptSummary {
  const summary: TranscriptSummary = { recentUserPrompts: [], lastAssistantMessage: null, todos: null, lastUserPromptAt: null, userPromptCount: 0 };
  let text: string;
  try {
    text = readTail(file, TAIL_BYTES).text;
  } catch {
    return summary;
  }
  const prompts: string[] = [];
  let todoWrite: { content: string; status: TodoStatus }[] | null = null;
  // TaskCreate/TaskUpdate (newer task tools): reconstruct from tool calls and results.
  const tasks = new Map<string, { subject: string; status: TodoStatus | 'deleted' }>();
  const pendingCreates = new Map<string, string>();
  let usedTaskTools = false;

  const lines = text.split('\n');
  for (const raw of lines) {
    if (!raw.trim()) continue;
    let entry: unknown;
    try {
      entry = JSON.parse(raw);
    } catch {
      continue; // first line of the tail may be cut mid-record
    }
    if (!isPlainObject(entry) || entry.isSidechain === true) continue;
    const msg = entry.message;
    if (!isPlainObject(msg)) continue;

    if (entry.type === 'user') {
      if (hasToolResult(msg.content)) {
        for (const c of msg.content as unknown[]) {
          if (!isPlainObject(c) || c.type !== 'tool_result' || typeof c.tool_use_id !== 'string') continue;
          const subject = pendingCreates.get(c.tool_use_id);
          const body = textOf(c.content) ?? (typeof c.content === 'string' ? c.content : '');
          const m = /Task #(\w+) created/.exec(body ?? '');
          if (subject !== undefined && m?.[1]) tasks.set(m[1], { subject, status: 'pending' });
        }
        continue;
      }
      if (entry.isMeta === true || entry.isCompactSummary === true || entry.isVisibleInTranscriptOnly === true) continue;
      const t = textOf(msg.content);
      if (!t || isSyntheticPrompt(t)) continue;
      prompts.push(truncate(t.trim(), 1000));
      summary.userPromptCount++;
      if (typeof entry.timestamp === 'string') summary.lastUserPromptAt = entry.timestamp;
    } else if (entry.type === 'assistant' && Array.isArray(msg.content)) {
      for (const c of msg.content as unknown[]) {
        if (!isPlainObject(c)) continue;
        if (c.type === 'text' && typeof c.text === 'string' && c.text.trim()) {
          summary.lastAssistantMessage = truncate(c.text.trim(), 2000);
        } else if (c.type === 'tool_use' && isPlainObject(c.input)) {
          const input = c.input;
          if (c.name === 'TodoWrite' && Array.isArray(input.todos)) {
            todoWrite = input.todos
              .filter((x): x is Record<string, unknown> => isPlainObject(x) && typeof x.content === 'string')
              .map((x) => ({ content: x.content as string, status: (x.status === 'completed' || x.status === 'in_progress' ? x.status : 'pending') }));
          } else if (c.name === 'TaskCreate' && typeof input.subject === 'string' && typeof c.id === 'string') {
            usedTaskTools = true;
            pendingCreates.set(c.id, input.subject);
          } else if (c.name === 'TaskUpdate' && (typeof input.taskId === 'string' || typeof input.taskId === 'number')) {
            usedTaskTools = true;
            const task = tasks.get(String(input.taskId));
            if (task) {
              if (typeof input.subject === 'string') task.subject = input.subject;
              if (input.status === 'completed' || input.status === 'in_progress' || input.status === 'pending' || input.status === 'deleted') task.status = input.status;
            }
          }
        }
      }
    }
  }

  summary.recentUserPrompts = prompts.slice(-MAX_PROMPTS);
  const toLists = (items: { content: string; status: TodoStatus }[]) => ({
    completed: items.filter((i) => i.status === 'completed').map((i) => truncate(i.content, 500)),
    inProgress: items.filter((i) => i.status === 'in_progress').map((i) => truncate(i.content, 500)),
    remaining: items.filter((i) => i.status === 'pending').map((i) => truncate(i.content, 500)),
  });
  if (usedTaskTools && tasks.size > 0) {
    summary.todos = toLists([...tasks.values()].filter((t) => t.status !== 'deleted').map((t) => ({ content: t.subject, status: t.status as TodoStatus })));
  } else if (todoWrite) {
    summary.todos = toLists(todoWrite);
  }
  return summary;
}
