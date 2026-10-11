# BRB — You leave. Your context stays.

A lightweight Claude Code plugin for pausing and resuming AI-assisted development.

Type `/brb` before you step away. Type `/brb continue` (or `/brb:continue`) when you're back. BRB saves a structured, local checkpoint: the objective, what's done, what's left, the exact next step, decisions, test results and repository state. A new Claude Code session can then pick up the task without you explaining it again.

```text
> /brb

⏸ BRB — pausing. Saving where we are…

BRB — Checkpoint saved

  ✓ Project      my-awesome-app · feature/authentication @ 559b7d92
  ✓ Repository   2 changed paths recorded · 2 files fingerprinted
  ✓ Task         objective · next step · 3 done, 1 in progress, 2 left
  ✓ Context      2 decisions · 1 blocker · 1 test result · 2 key files
  ✓ Privacy      no secret-like values found
  ✓ Stored       checkpoint f726a311 · 62 ms
                 ~/.brb/projects/my-awesome-app-79903013a9ac/checkpoints/…-manual-f726a311.json

Next → In src/auth/refresh.ts, wire refreshToken() into the fetch wrapper so a 401
       triggers one refresh and a retry; then run npm test.

You can leave now.
Run /brb continue when you're back.
```

---

## Contents

- [Why BRB](#why-brb)
- [Install](#install)
- [Getting started](#getting-started)
- [Commands](#commands)
- [Resuming](#resuming)
- [Auto-BRB](#auto-brb)
- [How checkpoints work](#how-checkpoints-work)
- [Security and privacy](#security-and-privacy)
- [Supported platforms](#supported-platforms)
- [Limitations](#limitations)
- [Troubleshooting](#troubleshooting)
- [Upgrade, removal and data](#upgrade-removal-and-data)
- [Contributing](#contributing) · [License](#license)

## Why BRB

When you come back to an AI coding session, the useful context is gone. That happens after lunch, after the weekend, after a compaction or after closing the terminal. You re-explain the goal, re-list what was done, and hope nothing was half-finished.

BRB makes "pause" a real operation:

- **Structured, not a chat dump.** The checkpoint is versioned JSON plus a human-readable Markdown handoff.
- **Repository-aware.** BRB records the branch, HEAD and changed files, plus content hashes of in-flight files. On resume it reports new commits, branch switches, rewritten history and files edited while you were away.
- **Non-destructive.** BRB never commits, pushes, stashes, resets or deletes your files, and never stops processes.
- **Local and private.** Checkpoints live in `~/.brb`. No network calls and no telemetry.

## Install

Requirements: Claude Code with plugin support, **Node.js 20 or later** on your `PATH` (BRB's helper is a small Node script), and git (optional, but needed for repository verification).

### From GitHub (recommended)

Inside Claude Code:

```text
/plugin marketplace add g4lb/brb-skill
/plugin install brb@brb
```

Or from your shell:

```bash
claude plugin marketplace add g4lb/brb-skill
claude plugin install brb@brb
```

Restart Claude Code (or start a new session) to load the plugin.

### Project-level install

To share BRB with your team through a project's `.claude/settings.json`:

```bash
claude plugin install brb@brb --scope project
```

### Try it without installing

```bash
git clone https://github.com/g4lb/brb-skill.git
claude --plugin-dir ./brb-skill/plugin
```

### Manual install (no plugin system)

Clone the repository and load the `plugin/` folder with `--plugin-dir` as shown above. Each skill folder carries its built helper (`scripts/brb.mjs`), so no build step or `npm install` is needed. Installing BRB downloads no npm packages.

### With the skills CLI ([skills.sh](https://www.skills.sh/))

```bash
npx skills add g4lb/brb-skill
```

This installs the two skills on their own, without the plugin system. You get `/brb` (pause) and `/brb continue` (resume) with the same checkpoints and repository checks. **Not included:** Auto-BRB and the resume hint, because those need plugin hooks. For the full feature set, use the plugin install above. In this mode, resume with `/continue`, `/brb continue` or by saying "I'm back".

## Getting started

1. Work with Claude as usual.
2. Before you leave, type `/brb` (or just say "brb", "I need to leave", "save where we are").
3. Come back, in the same session or a new one, and type `/brb:continue` (or say "I'm back", "continue where we left off").

That's it. Everything else is optional.

## Commands

| Command | What it does |
| --- | --- |
| `/brb` | Pause: save a checkpoint of the current task. |
| `/brb:continue [id]` | Resume: load the right checkpoint, verify the repository, continue the task. |
| `/brb continue` | Same as `/brb:continue`, and the way to resume when BRB is installed with the skills CLI. |
| `/brb status` | What `/brb:continue` would load, how many checkpoints exist, Auto-BRB state. |
| `/brb list` | All checkpoints for this project. |
| `/brb show [id]` | Print a checkpoint's handoff. |
| `/brb auto on` / `off` / `status` | Turn automatic checkpoints on or off for this project. |
| `/brb clean` | Show which old checkpoints would be removed. Nothing is deleted until you confirm. |
| `/brb delete <id>` | Delete one checkpoint (asks first). |
| `/brb export` | Print all of this project's checkpoints as one JSON document. |

> **About `/continue`.** With a skills-CLI install, the resume skill is a standalone skill named `continue`, and typing `/continue` in an interactive session runs it. As a plugin, the skill is `/brb:continue`. In non-interactive `claude -p` runs, Claude Code reports `/continue` as unavailable. `/brb continue` and plain language ("I'm back") work in every mode.

Natural-language activation is **best effort**. Claude decides whether a phrase matches. Slash commands always work.

## Resuming

```text
> /brb continue

▶ BRB — welcome back. Loading your checkpoint…

BRB — Checkpoint found

  ✓ Found        my-awesome-app · f726a311 · manual · saved 2 h ago · feature/authentication
                 Selected because: latest checkpoint on branch feature/authentication (manual)
  ✓ Integrity    verified
  ✓ Context      objective · next step · 3 done, 1 in progress, 2 left
  ! Repository   CHANGES DETECTED — repository changed since the checkpoint
                 Now on feature/authentication at e8537645
                 - 1 new commit(s) since the checkpoint (559b7d92..e8537645).
                 - Edited after the checkpoint (re-read before changing): src/auth/refresh.ts.
  ✓ Resume       READY — picking up where you left off

Task: Implement authentication: login, token storage and token refresh.

Completed:
✓ Login flow
✓ Token storage
✓ Error handling for 401 responses

Next:
→ Wire refreshToken() into the fetch wrapper in src/auth/refresh.ts

Re-reading src/auth/refresh.ts first, since it changed while you were away…
```

With the plugin install, Claude Code also shows a one-line status from a BRB hook right after the helper runs, for example `BRB — Checkpoint found: ✓ Integrity verified · ! Repository CHANGES DETECTED · ✓ Resume READY`. That line doesn't depend on the model. Each line is one step BRB actually performed. **✓** means done, **!** means look at this, **✗** means missing or a conflict, and **–** means it doesn't apply. The marks and counts come from the helper, not from Claude, so they never claim more than what happened.

On resume, BRB:

1. **Selects a checkpoint deterministically.** It prefers checkpoints from the current branch. The newest manual checkpoint wins over an older automatic one. If a *newer* automatic checkpoint exists and the repository changed in between, BRB asks you which to use. An id (`/brb:continue 9410b410`) always wins.
2. **Validates it.** It checks the schema version, the field-by-field schema, an integrity digest, and that the checkpoint belongs to this project. Damaged files are skipped and reported.
3. **Verifies the repository.** It reports the branch, commits since the checkpoint, rewritten history, newly changed files, files that are no longer changed, files edited after the checkpoint (by content hash), missing files and merge conflicts.
4. **Decides whether to continue.** With no conflicts, Claude re-reads changed files and continues. If there's a branch switch, rewritten history, a checkpoint choice, an automatic or partial checkpoint, or suspicious content, Claude stops and asks you first.

The result is always one of: **PASSED**, **CHANGES DETECTED**, **CONFLICTS DETECTED** or **LIMITED** (e.g. no git). The resume status is **READY** or **NEEDS INPUT**.

## Auto-BRB

Auto-BRB saves checkpoints automatically at Claude Code lifecycle events. It is **off by default**.

```text
/brb auto on          # this project
/brb auto on --global # every project (a project setting still overrides)
/brb auto off
```

| Event | Hook | Default when Auto-BRB is on | What is saved |
| --- | --- | --- | --- |
| Before context compaction (manual `/compact` or automatic) | `PreCompact` | on | Repository state, recent prompts, last assistant message, Claude's task list |
| Session end (exit, `/clear`, logout) | `SessionEnd` | on | Same |
| A task in Claude's task list is marked completed | `PostToolUse` on `TodoWrite`/`TaskUpdate` | off | Same; at most one per 10 minutes |

After a compaction, BRB also tells the new context that a pre-compaction checkpoint exists.

**What automatic checkpoints can and can't know.** Hooks run outside the conversation, so they can't ask Claude to summarize. Automatic checkpoints contain repository state plus what BRB can *extract* from the session transcript: recent prompts, the last assistant message and the task list. They never invent an objective or a next step. Both are recorded as "not recorded". On resume, Claude says the checkpoint is automatic and confirms the goal with you. For a complete handoff, use `/brb`.

**Safety rules for Auto-BRB:**

- Automatic checkpoints never overwrite or prune manual ones. Retention (`maxCheckpoints`, default 10) applies to automatic checkpoints only.
- Duplicates are suppressed. The same trigger in the same session within a minute is saved once. A session end with no new prompts since the last checkpoint and an unchanged repository is skipped. Subagent sessions and empty sessions are skipped.
- Hooks never block Claude Code. A failing hook exits with a non-blocking error (shown by Claude Code as a hook error) and logs to `~/.brb/logs/hook-errors.log`. BRB never uses the exit code that would cancel a compaction.
- An invalid config file turns Auto-BRB off until it is fixed (fail safe).

Settings and file format: [docs/configuration.md](docs/configuration.md).

### Resume hint

When a new session starts in a project that has an unresumed checkpoint (newest on this branch, less than 14 days old), BRB adds one line of context telling Claude a checkpoint exists. The line contains only metadata (type, age, branch), never checkpoint text. Turn it off with `/brb auto set resume-hint off`.

## How checkpoints work

```text
~/.brb/
├── config.json                        # optional global settings
├── logs/hook-errors.log               # hook failures (Auto-BRB)
└── projects/<name>-<hash>/
    ├── config.json                    # optional per-project settings
    ├── state.json                     # bookkeeping: resume times, dedupe state
    ├── checkpoints/20261011T074546830Z-manual-9410b410.json
    └── handoffs/20261011T074546830Z-manual-9410b410.md
```

- **Project identity** is the git top-level directory (or the working directory outside git), resolved through symlinks. Every subdirectory of a repository maps to the same project. Each git worktree is its own project.
- **The checkpoint JSON** is versioned (`schemaVersion: 2`) and sealed with a SHA-256 integrity digest. The full schema is in [docs/checkpoint-schema.md](docs/checkpoint-schema.md). An example is in [examples/checkpoint.json](examples/checkpoint.json).
- **The handoff Markdown** is a readable summary you can open directly, even without BRB. [Example](examples/handoff.md).
- **Writes are atomic** (temp file, fsync, rename) and serialized per project with a lock. Concurrent saves never corrupt each other.
- **Where the data comes from.** For `/brb`, Claude writes the task summary from the live conversation. The BRB helper collects git state itself (read-only commands only), hashes in-flight files (only digests are kept, never content), redacts secrets, validates and saves. If saving fails, BRB says so. It never reports a checkpoint it did not write.

Set `BRB_HOME` to store data elsewhere. Checkpoints are never written inside your project.

## Security and privacy

- **Local only.** No network access, no telemetry, no analytics. The runtime has zero dependencies, and CI checks that it has no network APIs.
- **Non-destructive.** BRB runs only read-only git commands (`status`, `rev-parse`, `symbolic-ref`, `config --get`, `cat-file`, `merge-base`, `rev-list`). It deletes only its own checkpoint files, and only after you confirm (`clean --yes`, `delete --yes`).
- **Secret minimization.** File contents are never copied, only paths and hashes. Files such as `.env`, `*.pem`, `id_rsa` and `credentials.json` aren't even hashed. Saved text is scanned for common credential formats (cloud keys, GitHub/GitLab/Slack/Stripe/npm tokens, JWTs, private keys, `password=…`-style assignments, credentials in URLs) and they are replaced with `[REDACTED:…]`. **Redaction is best effort and cannot catch every secret.** Don't paste secrets into task notes.
- **Untrusted on load.** When BRB loads a checkpoint, it validates it strictly and strips terminal escape and bidi control characters. It then wraps the content in a `<brb-checkpoint-data>` block that Claude is told to treat as data, not instructions. Text that tries to close that block early is neutralized. Instruction-like or destructive content ("ignore previous instructions", `git reset --hard`, …) is flagged, and Claude must ask you before continuing. A checkpoint can't change BRB's configuration or Claude Code's permissions. Claude still asks for approval for every action as usual.
- **Filesystem safety.** Storage directories are created `0700` and files `0600`. Symlinked storage paths and symlinked checkpoint files are refused. Project-relative paths with `..` or absolute paths are rejected. File reads are size-limited.

Full threat model: [SECURITY.md](SECURITY.md). Privacy policy: [PRIVACY.md](PRIVACY.md).

## Supported platforms

| Platform | Status |
| --- | --- |
| macOS | Tested: unit, integration and Claude Code end-to-end tests. |
| Linux | Unit and integration tests run in CI (GitHub Actions `ubuntu-latest`). |
| Windows | Unit and integration tests run in CI (`windows-latest`). Hooks use `node "…"` commands. Running them through Claude Code on Windows has not been verified end to end. Symlink tests are skipped on Windows. |

Node.js 20 and 22 are tested.

## Limitations

- **Not a memory restore.** BRB preserves explicit task context and repository metadata. It doesn't restore Claude's conversation, hidden reasoning or the memory of running processes. A resumed session may still need to read files or ask you something.
- **`/continue` depends on the install mode.** It works interactively with the skills-CLI install. Plugin installs use `/brb:continue`. `/brb continue` always works (see [Commands](#commands)).
- **Skills-CLI installs have no hooks.** `npx skills add` copies only the skills, so Auto-BRB and the resume hint are unavailable there.
- **Automatic checkpoints are extractive.** They rely on the transcript file. Its format is internal to Claude Code and may change. If parsing fails, BRB still saves repository state and marks the task context as unavailable.
- **Running processes are not inspected.** BRB records the processes Claude reports (for example, a dev server it started). It doesn't read the OS process table or restart anything.
- **SessionEnd has a short time budget** in Claude Code. BRB requests 10 seconds. On extremely slow filesystems or huge repositories, a session-end checkpoint can be cut short. Use `/brb` before you close the session.
- **Non-interactive runs.** With Auto-BRB on, `claude -p` sessions also produce session-end checkpoints (Claude Code reports them with a generic end reason). Retention keeps this bounded.
- **Moving a project** to a different path gives it a new identity. Old checkpoints stay under the old identity.
- **Very large working trees** are capped at 1,000 recorded paths and 500 hashed files. Verification is then marked partial.
- **Secret detection is pattern based** and can miss secrets.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `/brb` isn't recognized | Run `/plugin` and check that `brb@brb` is installed and enabled, then start a new session. |
| `node: command not found` | Install Node.js 20+ and make sure it is on the `PATH` that Claude Code uses. |
| "Checkpoint could not be saved: … permission denied" | Check ownership of `~/.brb`, or set `BRB_HOME` to a writable absolute path. |
| "Refusing to use … it is a symbolic link" | BRB won't write through symlinks. Point `BRB_HOME` at a real directory. |
| "BRB_HOME … is inside this project" | Checkpoints must live outside the repository. Move `BRB_HOME` or unset it. |
| "No checkpoint found for this project" | Run `/brb status` from the same repository. Checkpoints are per project root. |
| "N other checkpoint file(s) are damaged" | `/brb list` shows why. The `.md` handoff next to a damaged file is often still readable. `/brb clean --broken` removes damaged files (after confirmation). |
| "written by a newer BRB" | Upgrade BRB. Older BRB versions can't read newer checkpoints. |
| Auto-BRB doesn't save | Run `/brb auto status`. Invalid config disables it. Look at `~/.brb/logs/hook-errors.log`. Set `BRB_DEBUG=1` to log every hook payload's metadata to `~/.brb/logs/hooks-debug.log`. |
| Claude asks before continuing | That is intended when the branch changed, history was rewritten, the checkpoint is automatic or partial, or its text looks like instructions. |

You can also run the helper directly: `node <skill folder>/scripts/brb.mjs help`.

## Upgrade, removal and data

- **Upgrade:** `claude plugin update brb@brb` (or `/plugin` → update). Checkpoints are stored outside the plugin and are kept.
- **Disable Auto-BRB:** `/brb auto off` (add `--global` if you enabled it globally).
- **Remove BRB:** `claude plugin uninstall brb@brb`. **Uninstalling does not delete your checkpoints.** They stay in `~/.brb`.
- **Export:** `/brb export` prints all of a project's checkpoints as JSON. You can also copy `~/.brb`.
- **Delete checkpoints:** `/brb delete <id>`, `/brb clean` (dry run first), or remove `~/.brb` (all projects) or one `~/.brb/projects/<name>-<hash>/` folder yourself.
- **Old schema versions:** checkpoints carry `schemaVersion`. Newer BRB releases migrate older checkpoints when loading them. An older BRB refuses newer checkpoints with an upgrade message instead of guessing.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Architecture notes: [docs/architecture.md](docs/architecture.md).

```bash
npm ci
npm run check      # typecheck, lint, unit and integration tests, dist verification
npm run test:e2e   # optional: drives the real Claude Code CLI (uses model tokens)
```

## License

[MIT](LICENSE) © g4lb
