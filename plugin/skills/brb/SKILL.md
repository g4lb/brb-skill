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

For all actions except the pause flow: run the command with the Bash `description` **BRB · <action>** (for example **BRB · status**), copy its output into your reply inside a ```text code block, and stop.

## Pause flow

### 0. Tell the developer right away

Before any tool call, write this one line so the developer sees that BRB started:

> ⏸ BRB — pausing. Saving where we are…

Use the Bash `description` **BRB · saving checkpoint** for the save command, so the progress line in the terminal reads as BRB.

### 1. Stop at a safe point

- Do not start new changes.
- If an edit is half done and would leave a file broken, finish only that edit. Otherwise stop now.
- Never commit, push, stash, reset, revert, or discard changes. Never stop or kill processes. Never delete files. BRB records state. It does not change it.
- Do not start new background work (subagents, background commands). Do not send new messages to running subagents.
- Find all background work that is still running: subagents, background Bash commands, monitors. Record each in `backgroundWork` (step 2). Do not stop it.

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
| `backgroundWork` | Work that is still running in the background and can change files after the checkpoint: subagents, background commands. For each item, say what it does, which files or branch it changes, and where its result goes (for example "subagent: final review fixes on branch feat/x, edits apps/api/src, writes report to docs/fix-report.md"). Do not put this work in `completed`. |
| `relevantTools` | Tools or services the work depends on. |
| `notes` | Anything else a new session needs. Include the developer's note, if they gave one. |
| `resumeInstructions` | Special steps for resuming (for example "run npm install first"). |

Rules:

- If `backgroundWork` is not empty, `nextAction` must work in a new session too, where that work has stopped. Do not write only "wait for the subagent". Write how to check its result on disk (commits, files, report) and what to do if it did not finish.
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

- **Exit code 0:** the terminal may collapse tool output, so copy the tool's output into your reply, exactly as written, inside a ```text code block. Do not add counts, percentages, or checks that the output does not contain. Add nothing after it except, if needed, the partial-save note below.
- If the output says **"partially saved"**: tell the developer which fields are missing. Offer to save again with them.
- **Exit code not 0:** the checkpoint was **not** saved. Show the error and the hint from the output. Do not say the checkpoint is saved. If the error is about the JSON, fix the JSON and try again once.

Then stop. Do not continue the task after a pause.

### 5. After the pause

The developer may be away. Background work keeps running, and when it finishes you get a notification. This is not a request to continue.

- When a background task notification arrives after the pause, write one line: what finished, and whether it succeeded. Then stop.
- Do not start the next step. Do not commit, push, open or merge pull requests, deploy, edit files, or start or message agents.
- Continue only when the developer writes again, for example with `/brb continue`.
