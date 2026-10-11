import { sanitizeText } from '../security/sanitize.js';
import type { Checkpoint } from './types.js';

const s = (t: string) => sanitizeText(t).replace(/\r\n?/g, '\n');
/** Single-line form for list items. */
const line = (t: string) => s(t).replace(/\n+/g, ' ').trim();

function list(items: string[], empty = '_None recorded._'): string {
  if (items.length === 0) return empty;
  return items.map((i) => `- ${line(i)}`).join('\n');
}

/**
 * Render a self-contained Markdown handoff. It is useful even without BRB:
 * a developer (or a fresh Claude session) can read it directly.
 */
export function renderHandoff(cp: Checkpoint): string {
  const t = cp.task;
  const out: string[] = [];
  out.push(`# BRB handoff — ${line(cp.project.name)}`);
  out.push('');
  out.push(`- **Checkpoint:** \`${cp.checkpointId}\` (${cp.type}, trigger: ${cp.trigger}${cp.partial ? ', partial' : ''})`);
  out.push(`- **Saved:** ${cp.createdAt}`);
  out.push(`- **Project root:** \`${line(cp.project.root)}\``);
  if (cp.git.available) {
    out.push(`- **Branch:** ${cp.git.branch ? `\`${line(cp.git.branch)}\`` : '(detached HEAD)'} at \`${cp.git.head?.slice(0, 12) ?? 'no commits'}\``);
  } else {
    out.push(`- **Git:** unavailable (${line(cp.git.reason)})`);
  }
  out.push('');

  out.push('## Current task');
  if (t.source === 'none') out.push('_No task context was available when this checkpoint was saved. Only repository metadata was recorded._');
  else if (t.source === 'transcript') out.push('_Automatic checkpoint: task details below were extracted from the session transcript and were not reviewed by Claude._');
  out.push('');
  out.push(t.objective ? s(t.objective) : '_Objective not recorded._');
  out.push('');

  out.push('## Next step');
  out.push(t.nextAction ? s(t.nextAction) : '_Not recorded. Inspect the repository and ask the developer before continuing._');
  out.push('');

  out.push('## Completed');
  out.push(list(t.completed));
  out.push('');
  out.push('## In progress');
  out.push(list(t.inProgress));
  out.push('');
  out.push('## Remaining');
  out.push(list(t.remaining));
  out.push('');

  out.push('## Decisions');
  out.push(list(cp.decisions));
  out.push('');
  out.push('## Blockers and known problems');
  out.push(list(cp.blockers));
  out.push('');
  if (cp.assumptions.length > 0) {
    out.push('## Assumptions');
    out.push(list(cp.assumptions));
    out.push('');
  }

  out.push('## Tests');
  if (cp.tests.length === 0) out.push('_No test runs recorded._');
  else for (const test of cp.tests) out.push(`- \`${line(test.command)}\` — **${test.result}**${test.summary ? `: ${line(test.summary)}` : ''}`);
  out.push('');

  out.push('## Relevant files');
  if (cp.files.length === 0) out.push('_None listed._');
  else for (const f of cp.files) out.push(`- \`${line(f.path)}\`${f.note ? ` — ${line(f.note)}` : ''}`);
  out.push('');

  if (cp.git.available) {
    const wt = cp.git.workingTree;
    out.push('## Working tree at checkpoint');
    const rows: [string, string[]][] = [
      ['Modified', wt.modified], ['Added', wt.added], ['Deleted', wt.deleted],
      ['Renamed', wt.renamed.map((r) => `${r.from} → ${r.to}`)], ['Untracked', wt.untracked], ['Conflicted', wt.conflicted],
    ];
    const nonEmpty = rows.filter(([, items]) => items.length > 0);
    if (nonEmpty.length === 0) out.push('_Clean._');
    for (const [label, items] of nonEmpty) {
      out.push(`**${label} (${items.length})**`);
      out.push(items.slice(0, 100).map((i) => `- \`${line(i)}\``).join('\n'));
      if (items.length > 100) out.push(`- … ${items.length - 100} more`);
    }
    if (wt.truncated) out.push(`_List capped: git reported ${wt.total} entries._`);
    out.push('');
  }

  if (cp.environment.runningProcesses.length > 0 || cp.environment.relevantTools.length > 0) {
    out.push('## Environment');
    if (cp.environment.runningProcesses.length > 0) {
      out.push('Processes reported as running at checkpoint time (they may have stopped; BRB does not restart them):');
      out.push(list(cp.environment.runningProcesses));
    }
    if (cp.environment.relevantTools.length > 0) {
      out.push('Relevant tools:');
      out.push(list(cp.environment.relevantTools));
    }
    out.push('');
  }

  if (cp.context) {
    out.push('## Recent conversation (extracted)');
    if (cp.context.recentUserPrompts.length > 0) {
      out.push('Recent developer prompts, oldest first:');
      out.push(cp.context.recentUserPrompts.map((p) => `> ${line(p)}`).join('\n>\n'));
    }
    if (cp.context.lastAssistantMessage) {
      out.push('');
      out.push('Last assistant message:');
      out.push(`> ${line(cp.context.lastAssistantMessage)}`);
    }
    out.push('');
  }

  if (cp.notes) {
    out.push('## Notes');
    out.push(s(cp.notes));
    out.push('');
  }

  out.push('## Resume guidance');
  if (cp.resume.instructions) out.push(s(cp.resume.instructions));
  out.push(list(cp.resume.warnings, ''));
  out.push('- Check the repository for changes made after this checkpoint before editing files.');
  out.push('- This handoff records task context only. It is not a copy of the earlier conversation.');
  if (cp.redactions > 0) out.push(`- ${cp.redactions} value(s) that looked like secrets were redacted.`);
  out.push('');
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}
