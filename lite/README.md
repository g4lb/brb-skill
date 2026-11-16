# BRB — Be Right Back (skills-only edition)

Pause your Claude Code work and pick it up later, even in a new session.

This is the skills-only edition of [BRB](https://github.com/g4lb/brb-skill), the one listed in the Claude plugin directory. It has no hooks and no scripts: Claude writes and reads a plain Markdown checkpoint itself.

## Install

Install BRB from the Claude plugin directory. The `g4lb/brb-skill` marketplace (`/plugin marketplace add g4lb/brb-skill`, then `/plugin install brb@brb`) installs full BRB instead. Both are named `brb`, so install only one of them.

## Use

| Command | What it does |
| --- | --- |
| `/brb:brb [note]` | Stops at a safe point and saves where the work stands: objective, what is done, what is in progress, the exact next step, decisions, test results, files, background work, and the repository state. |
| `/brb:continue` | Loads the checkpoint, checks what changed in the repository since then (branch, new commits, changed files, merge conflicts), shows a short summary, and continues — or stops and asks when something does not match. |

You can also say "brb", "I need to leave" or "I'm back".

## Where the checkpoint is

`<your repository>/.brb/checkpoint.md`. It is plain Markdown, so you can read and edit it. The previous checkpoint is kept as `.brb/checkpoint.prev.md`.

The `.brb/` folder contains its own `.gitignore` (`*`), so git ignores it and your `.gitignore` is not changed. Outside a git repository, the checkpoint goes in the current folder.

## What it does not change

This edition only reads repository state (`git status`, `git rev-parse`, and similar). It never commits, pushes, stashes, resets, deletes files or stops processes.

## Compared with full BRB

This edition leaves out:

- **Auto-BRB** — automatic checkpoints before context compaction and at session end (needs hooks).
- `status`, `list`, `show`, `clean`, `delete` and `export` commands, and more than one saved checkpoint per project.
- Automatic secret redaction and file content hashes. It tells Claude not to write secrets into the checkpoint, but nothing checks it. Changes to files that were already modified at pause time are not detected.

If you want those, install full BRB from the `g4lb/brb-skill` marketplace.

## Privacy

Nothing leaves your computer. The checkpoint is a file in your project. See [PRIVACY.md](https://github.com/g4lb/brb-skill/blob/main/PRIVACY.md).

## License

MIT
