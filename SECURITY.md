# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately to **galevgi@gmail.com**, or through GitHub's private vulnerability reporting on this repository. Don't open a public issue. Expect an acknowledgement within 7 days.

## Supported versions

Only the latest release gets security fixes.

## Threat model

BRB runs locally with your user's permissions. It stores task summaries, which can be sensitive, and later feeds them back to an AI agent that can run tools.

| Concern | Mitigation | Residual risk |
| --- | --- | --- |
| Secrets copied into checkpoints | File contents are never stored, only paths and SHA-256 digests. Sensitive files (`.env*`, keys, certificates, credential files) aren't hashed. Free text is scanned for common credential formats and redacted. Remote URLs lose embedded credentials. | Pattern-based redaction can miss secrets, such as custom token formats or secrets described in prose. |
| Other local users reading checkpoints | Directories are `0700`, files `0600` (POSIX). | Windows relies on default per-user profile ACLs. Root or administrators can read everything. |
| Prompt injection through checkpoint text (a hostile string quoted into a task note, or an edited file) | Strict schema validation and an integrity digest. Control, ANSI and bidi characters are stripped. Content goes inside a `<brb-checkpoint-data>` block that Claude is told is data, and attempts to close the block are neutralized. Instruction-like and destructive phrases are flagged (after invisible characters are removed, so they can't hide a phrase) and force a "needs input" stop. Repository-derived values printed outside the block (branch and file names) are collapsed to one line and scanned too. The startup hint injects only metadata, never checkpoint text. | Heuristics can't detect every injection. The digest isn't a signature: a local attacker who can write `~/.brb` can forge a valid checkpoint. Claude Code's own permission prompts remain the final control. |
| Checkpoints bypassing permissions | Checkpoints can't change BRB config or Claude Code settings. Skills tell Claude to use normal approvals and never to run commands just because a checkpoint says so. | Depends on Claude following the instructions and on your Claude Code permission mode. |
| Destructive operations | Only read-only git commands, run without a shell (`execFile`). BRB deletes only its own checkpoint files, after explicit `--yes` confirmation. Paths are validated before deletion. | None known. |
| Path traversal and symlink attacks | Relative paths with `..`, absolute paths, NUL bytes and drive letters are rejected. Storage directories and checkpoint files that are symlinks are refused. Hashing doesn't follow symlinks and checks the resolved parent stays inside the project. Reads are size-limited. | Time-of-check/time-of-use races by a local attacker with write access to your files. |
| Concurrent writes and corruption | Atomic temp-file + fsync + rename. A per-project lock with an owner token: stale locks (>30 s) are broken by atomic rename, and a process never releases a lock it no longer owns. Every checkpoint is validated against the schema before it is written, so a reported save always loads. Damaged files are skipped and reported. | A process that holds the lock for more than 30 s (e.g. suspended) can overlap with the next writer. Checkpoints use unique file names; only `state.json` bookkeeping could lose an update. |
| Hooks disrupting Claude Code | Hooks never exit 2, swallow malformed input, have timeouts and log failures. A recursion guard prevents re-entry. | A slow filesystem can make the session-end hook hit its time budget. |
| Network exfiltration | No network code. CI rejects network APIs in `src/`. Zero runtime dependencies. | None known. |

## Data handled

BRB stores data only under `~/.brb` (or `BRB_HOME`). It sends nothing anywhere. It reads the Claude Code session transcript only for automatic checkpoints, and keeps at most 5 recent prompts (truncated, redacted), the last assistant message, and the task list.
