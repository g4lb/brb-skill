---
name: brb
description: Pause the current coding work and save a BRB checkpoint (objective, progress, next step, decisions, tests, repository state) as a Markdown file in the project, so the work can be resumed later, even in a new session. Use when the developer runs /brb:brb, or says they need to leave or pause, for example "brb", "be right back", "I need to leave", "pause my work", "save where we are", "I'm heading out".
argument-hint: "[note]"
---

# BRB — pause work

BRB saves a checkpoint file so the developer can leave and resume later with `/brb:continue`. You write the file yourself. There is no BRB program to run.

Arguments given: `$ARGUMENTS`

If the first word of the arguments is `continue` or `resume`, do not use this skill. Invoke this plugin's `continue` skill instead (`brb:continue`). Otherwise, treat the arguments as a note from the developer.

## 0. Tell the developer right away

Before any tool call, write this one line:

> ⏸ BRB — pausing. Saving where we are…

## 1. Stop at a safe point

- Do not start new changes.
- If an edit is half done and would leave a file broken, finish only that edit. Otherwise stop now.
- Never commit, push, stash, reset, revert, or discard changes. Never stop or kill processes. Never delete files. BRB records state. It does not change it.
- Do not start new background work (subagents, background commands). Do not send new messages to running subagents.
- Find all background work that is still running: subagents, background Bash commands, monitors. Record it under **Background work** (step 3). Do not stop it.

## 2. Read the repository state

Run only the read-only commands below, in the current directory. Use the Bash `description` **BRB · reading repository state**. You can run them in one Bash call. A command that fails is not an error: record the value shown in brackets.

| Value | Command | If it fails |
| --- | --- | --- |
| Root | `git rev-parse --show-toplevel` | Use the current directory. Repository = `not a git repository`. Skip the other commands. |
| Branch | `git symbolic-ref --quiet --short HEAD` | If HEAD exists: `detached at <first 7 characters of HEAD>`. Otherwise `none`. |
| HEAD | `git rev-parse --verify --quiet HEAD` | `no commits` |
| Upstream | `git rev-parse --abbrev-ref --symbolic-full-name @{upstream}` | `none` |
| Ahead/behind | `git rev-list --left-right --count @{upstream}...HEAD` (left = behind, right = ahead) | leave out |
| Working tree | `git status --porcelain=v1 --untracked-files=all` | — |

Do not run any other git command. Lines in the working tree that start with `.brb/` are BRB's own files: leave them out.

## 3. Write the checkpoint

Write from what you know in this conversation. Include only facts from this session. If you do not know something, leave the section out. Do not guess.

Rules:

- **Objective** and **Next action** are required. **Next action** is the exact next step: which file, which function, what to do. Make it specific enough for a new session to start without asking.
- **Tests:** only test runs from this session, with the real result: `passed`, `failed`, `partial`, `not-run` or `unknown`. Do not report a test you did not run.
- **Background work:** for each item, say what it does, which files or branch it changes, and where its result goes. Do not put this work under Completed. If there is background work, **Next action** must also work in a new session, where that work has stopped: say how to check its result on disk (commits, files, report) and what to do if it did not finish.
- Never write secrets, tokens, passwords, keys, or `.env` values. Nothing removes them for you.
- Give file paths, not file contents. Keep each list item to one line.

Then, with the Write tool:

1. If `<root>/.brb/checkpoint.md` exists, read it and write its content unchanged to `<root>/.brb/checkpoint.prev.md`.
2. Write `<root>/.brb/.gitignore` with exactly one line: `*`
3. Write `<root>/.brb/checkpoint.md` in this format. Leave out empty sections, except Objective and Next action. Keep the headings exactly as written: `/brb:continue` reads them.

````markdown
# BRB checkpoint

- Saved: <current time, UTC, ISO 8601>
- Session: ${CLAUDE_SESSION_ID}
- Repository: <root> | not a git repository
- Branch: <branch> | detached at <sha> | none
- HEAD: <full sha> | no commits
- Upstream: <upstream>, <a> ahead, <b> behind | none
- Note: <the developer's note, only if given>

## Objective
<the development goal, in one or two sentences>

## Completed
- <work that is done and checked>

## In progress
- <work that is started but not done, and what state it is in>

## Remaining
- <work not started yet>

## Next action
<the exact next step>

## Decisions
- <decision> — <reason>

## Blockers
- <known problems, open questions, things waiting on someone>

## Assumptions
- <assumptions the work depends on>

## Tests
- `<command>` — <result> — <summary>

## Files
- `<project-relative path>` — <optional note>

## Running processes
- <background processes you started that may still run, for example "dev server on port 3000, started with npm run dev">

## Background work
- <what it does> — <files or branch it changes> — <where its result goes>

## Notes
- <anything else a new session needs>

## Resume instructions
- <special steps for resuming, for example "run npm install first">

## Working tree at pause
```text
<the git status --porcelain lines, without .brb/ lines; or the word clean>
```
````

## 4. Report

Copy this into your reply, filled in, inside a ```text code block:

```text
⏸ BRB — checkpoint saved
File:    <root>/.brb/checkpoint.md
Branch:  <branch>   HEAD: <first 7 characters, or "no commits">
Changed: <number of working tree lines> files
Next:    <next action, one line>
```

Then write: `Resume with /brb:continue`. If you could not write the file, say clearly that the checkpoint was **not** saved, and why.

Then stop. Do not continue the task after a pause.

## 5. After the pause

The developer may be away. Background work keeps running, and when it finishes you get a notification. This is not a request to continue.

- When a background task notification arrives after the pause, write one line: what finished, and whether it succeeded. Then stop.
- Do not start the next step. Do not commit, push, open or merge pull requests, deploy, edit files, or start or message agents.
- Continue only when the developer writes again, for example with `/brb:continue`.
