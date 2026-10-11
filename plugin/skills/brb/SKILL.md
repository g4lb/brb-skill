---
name: brb
description: Pause the current coding work and save a BRB checkpoint (objective, progress, next step, decisions, tests, repository state) so the work can be resumed later, even in a new session. Use when the developer runs /brb, or says they need to leave or pause, for example "brb", "be right back", "I need to leave", "pause my work", "save where we are", "I'm heading out". Also handles /brb continue, status, list, show, auto on, auto off, clean, delete, export.
argument-hint: "[continue | status | list | show [id] | auto on|off|status | clean | delete <id> | export]"
---

# BRB — pause work

BRB saves a structured checkpoint so the developer can leave and resume later with `/brb continue` (or `/brb:continue` when BRB is installed as a plugin).
The BRB command-line tool does the saving. Run it with:

```
node "${CLAUDE_SKILL_DIR}/scripts/brb.mjs" <command>
```

In the steps below, `BRB` means that full command.

Arguments given: `$ARGUMENTS`

## Choose the action

Read the first word of the arguments:

| First word | Run |
| --- | --- |
| empty, `save`, or any other text | **Pause flow** (below). Treat other text as a note from the developer. |
| `status` | `BRB status` |
| `list` | `BRB list` |
| `show` | `BRB show [id]` |
| `auto` | `BRB auto on`, `BRB auto off`, `BRB auto status`, or `BRB auto set <setting> <value>`. Add `--global` only if the developer asks for all projects. |
| `clean` | `BRB clean` with any options given. This is a dry run. Show the plan. Run again with `--yes` only after the developer confirms. |
| `delete` | `BRB delete <id>`. Show what would be deleted. Add `--yes` only after the developer confirms. |
| `export` | `BRB export` |
| `help` | `BRB help` |
| `continue` or `resume` | Do not use this skill. Invoke the BRB resume skill instead, passing any checkpoint id: it is `brb:continue` when BRB is installed as a plugin, and `continue` when its skills are installed on their own. |

For all actions except the pause flow: run the command, show the output to the developer, and stop.

## Pause flow

### 1. Stop at a safe point

- Do not start new changes.
- If an edit is half done and would leave a file broken, finish only that edit. Otherwise stop now.
- Never commit, push, stash, reset, revert, or discard changes. Never stop or kill processes. Never delete files. BRB records state. It does not change it.

### 2. Write the task context

Write a JSON object from what you know in this conversation. Include only facts from this session. If you do not know a field, leave it out. Do not guess.

| Field | Content |
| --- | --- |
| `objective` | The development goal, in one or two sentences. |
| `completed` | Work that is done and checked. |
| `inProgress` | Work that is started but not done. Say what state it is in. |
| `remaining` | Work not started yet. |
| `nextAction` | The exact next step: which file, which function, what to do. Make it specific enough for a new session to start without asking. |
| `decisions` | Technical decisions made, with the reason. |
| `blockers` | Known problems, open questions, things waiting on someone. |
| `assumptions` | Assumptions the work depends on. |
| `tests` | Test runs from this session: `{"command": "...", "result": "passed" \| "failed" \| "partial" \| "not-run" \| "unknown", "summary": "..."}`. Use the real result. Do not report a test you did not run. |
| `files` | Relevant files as project-relative paths, optionally with a note: `{"path": "src/auth.ts", "note": "refresh logic here"}`. |
| `runningProcesses` | Background processes you started that may still run (for example "dev server on port 3000, started with npm run dev"). Do not stop them. |
| `relevantTools` | Tools or services the work depends on. |
| `notes` | Anything else a new session needs. Include the developer's note, if they gave one. |
| `resumeInstructions` | Special steps for resuming (for example "run npm install first"). |

Rules:

- Do not copy secrets, tokens, passwords, keys, or `.env` values into any field. BRB redacts common secret formats, but it cannot catch everything.
- Do not copy file contents. Give paths. BRB records git state and file hashes by itself.
- Keep each list item to one line.

### 3. Save

Run this in one Bash call. Put the JSON between the markers:

```bash
node "${CLAUDE_SKILL_DIR}/scripts/brb.mjs" save --session "${CLAUDE_SESSION_ID}" <<'BRB_JSON'
{ ...the JSON object... }
BRB_JSON
```

If the shell does not support `<<'BRB_JSON'` here-documents (for example PowerShell), write the JSON to a temporary file outside the project and run `node "${CLAUDE_SKILL_DIR}/scripts/brb.mjs" save --session "${CLAUDE_SESSION_ID}" --input <file>` instead.

### 4. Report the result

- **Exit code 0:** show the developer the tool's output, as written. Do not add counts, percentages, or checks that the output does not contain.
- If the output says **"partially saved"**: tell the developer which fields are missing. Offer to save again with them.
- **Exit code not 0:** the checkpoint was **not** saved. Show the error and the hint from the output. Do not say the checkpoint is saved. If the error is about the JSON, fix the JSON and try again once.

Then stop. Do not continue the task after a pause.
