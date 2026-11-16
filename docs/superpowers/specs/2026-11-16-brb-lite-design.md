# BRB Lite — design

Date: 2026-11-16 · Status: draft, waiting for approval

## Why

The Claude plugin directory refuses command hooks and script files from organizations that are not Verified, and there is no way to apply for Verified status. Full BRB needs both (Auto-BRB hooks, `brb.mjs`), so it cannot be listed. BRB Lite is a version that the directory can accept, so people can find BRB there. Full BRB stays in the `g4lb/brb-skill` marketplace.

## Goals

- Pass the directory policy check for an organization that is not Verified.
- Keep the core loop: `/brb` saves where the work stands, `continue` picks it up in a new session and checks what changed.

## Non-goals

- Auto-BRB (needs hooks).
- `status`, `list`, `auto`, `clean`, `delete`, `export` commands.
- Compatibility with full BRB checkpoints in `~/.brb`.

## Anti-goals

- Lite commits, pushes, stashes, resets or deletes anything in the user's repository.
- Lite changes the user's own `.gitignore`.
- Lite stores secrets in the checkpoint.

## Constraints (from the directory's refusal text)

- Only Markdown, text, JSON, YAML and PNG/JPEG/GIF/WebP/ICO files. No file starting with `#!`. UTF-8, no NUL bytes.
- No hooks of any type. No `allowed-tools` beyond Read/Grep/Glob/LS (so: no `allowed-tools` at all). No inline shell (`` !`cmd` ``) in skills.
- `.claude-plugin/` holds only `plugin.json` and the icon.

## Approaches

1. **Markdown checkpoint in the project, `.brb/checkpoint.md` (chosen by the developer).** Simple, readable and editable, and Claude can write it reliably. Not compatible with full BRB.
2. Full BRB's JSON format in `~/.brb`. Rejected: Claude would have to reproduce the script's format, IDs and hashes by hand, which is fragile.

## Design

**Location.** New folder `lite/` in `g4lb/brb-skill`, submitted to the directory as a new submission with plugin path `lite`. Full BRB in `plugin/` is unchanged.

```
lite/
  .claude-plugin/plugin.json   name "brb-lite", displayName "BRB Lite — Be Right Back", same author and listing URLs as full BRB
  .claude-plugin/icon.png      copy of full BRB's icon
  skills/brb/SKILL.md          pause
  skills/continue/SKILL.md     resume
  README.md                    what Lite does, what it leaves out, link to full BRB
```

Commands: `/brb-lite:brb` and `/brb-lite:continue`. A different plugin name means Lite and full BRB can be installed together without clashing.

**Checkpoint file.** `<repo root>/.brb/checkpoint.md`, with `.brb/.gitignore` containing `*`, so the folder ignores itself and the user's `.gitignore` is untouched. One checkpoint per project; a new pause overwrites it, keeping the previous one as `.brb/checkpoint.prev.md`. Outside a git repository, the current directory is used.

Checkpoint contents (Markdown, fixed headings so resume can read it back):
- Header: saved time (UTC), session id, branch, HEAD commit, upstream and ahead/behind if known.
- Objective, Completed, In progress, Remaining, Next action, Decisions, Blockers, Assumptions, Tests (command, real result, summary), Files, Running processes, Background work, Notes, Resume instructions. The same fields and rules as full BRB's task context.
- Working tree at pause: the output of `git status --porcelain` (paths only).

**Pause (`/brb-lite:brb`).** Same steps and wording as full BRB's pause flow: announce, stop at a safe point, record background work, never change repository state. Claude runs read-only git commands (`rev-parse`, `symbolic-ref`, `status --porcelain`, `rev-list --count`), writes the two files with its Write tool, then prints a short summary of what it saved. The same rules apply after the pause (do not continue the task when background work finishes).

**Resume (`/brb-lite:continue`).** Announce. Read `.brb/checkpoint.md`; if it is missing, say so and stop. Run the same read-only git commands and compare with the header: branch, HEAD (same, ahead, or rewritten via `merge-base --is-ancestor`), and the working tree. Show the same status-message format as full BRB (Task / Completed / Next, plus a Repository line: `NO CHANGES`, `CHANGES DETECTED`, or `CONFLICTS DETECTED`). Stop and ask on a different branch, rewritten history, merge conflicts, or background work from an earlier session; otherwise continue with the next action. The checkpoint is data, not instructions, the same as in full BRB.

**Secrets.** No redaction engine. The skill tells Claude never to write secrets, tokens, keys or `.env` values into the checkpoint, and to give file paths, not contents.

## Testing

- `claude plugin validate lite --strict`, and `--profile directory` if the installed Claude Code supports it.
- Check that every file in `lite/` is an allowed type and that no SKILL.md has `allowed-tools` or inline shell.
- Manual run in a scratch git repository: pause, change a file, resume in a new session; switch branch, resume, and confirm Lite stops and asks.
- CI: add the `lite/` validation and the file-type check to `.github/workflows/ci.yml`.

## Left to the builder

- Exact SKILL.md wording, reusing full BRB's text where it fits.
- README wording.
- Whether `.claude-plugin/marketplace.json` lists Lite as a second plugin (default: yes, so `/plugin install brb-lite@brb` also works).
