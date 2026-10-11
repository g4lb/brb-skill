# Architecture

BRB is a Claude Code plugin made of three parts:

Everything Claude Code installs lives in `plugin/`. That folder has no `package.json`, so installing BRB never runs `npm install`. Development tooling (TypeScript sources, tests, lint) stays at the repository root, and the marketplace entry points at `./plugin`.

1. **Skills** (`plugin/skills/brb/SKILL.md`, `plugin/skills/continue/SKILL.md`). These are instructions for Claude. They cover what to collect when pausing, how to call the helper, and how to treat a loaded checkpoint.
2. **A helper CLI** (`scripts/brb.mjs` inside each skill folder, bundled from `src/` with esbuild). Each skill carries its own copy and calls it through `${CLAUDE_SKILL_DIR}`, so a skill works whether Claude Code installed the whole plugin or the skills CLI copied the skill folder alone. The hooks use the copy in the `brb` skill. A dependency-free Node.js program that does everything that must be deterministic: git inspection, hashing, redaction, validation, atomic persistence, selection, verification and retention.
3. **Hooks** (`plugin/hooks/hooks.json`). Lifecycle hooks call the same CLI for Auto-BRB and the resume hint.

The split is deliberate. Only Claude knows the task: the goal, what's done, the next step. Only deterministic code should decide what is on disk, whether the data is valid, and whether the repository changed. Claude never writes checkpoint files directly. It hands a JSON task summary to `brb save`, and the CLI builds, redacts, validates and seals the checkpoint.

```text
            /brb                                   /brb:continue
             │                                          │
   Claude writes task JSON                   Claude runs `brb resume`
             │                                          │
             ▼                                          ▼
  ┌──────── brb save ────────┐           ┌──────── brb resume ─────────┐
  │ validate input (strict)  │           │ list + validate checkpoints │
  │ git state (read-only)    │           │ select (deterministic)      │
  │ hash in-flight files     │           │ compare repo vs checkpoint  │
  │ redact secrets           │           │ sanitize + flag injection   │
  │ seal (sha256 digest)     │           │ print briefing in a         │
  │ lock → atomic write      │           │ <brb-checkpoint-data> block │
  └────────────┬─────────────┘           └──────────────┬──────────────┘
               ▼                                        ▼
        ~/.brb/projects/<name>-<hash>/{checkpoints,handoffs}/…

  PreCompact / SessionEnd / PostToolUse ──► brb hook <event> ──► auto checkpoint
  SessionStart ──► brb hook session-start ──► one-line metadata hint
```

## Source layout

| Path | Responsibility |
| --- | --- |
| `src/cli.ts` | Entry point, command dispatch, error-to-exit-code mapping. |
| `src/commands/` | One module per command group: `save`, `resume`, `manage` (status, list, show, clean, delete, export, auto), `hook`. `common.ts` holds argument parsing and project resolution. |
| `src/checkpoint/` | The checkpoint model: `types.ts` (schema types), `schema.ts` (validation, integrity, migrations), `build.ts` (assemble + redact + seal), `git.ts` (read-only git), `snapshot.ts` (content hashes), `transcript.ts` (best-effort extraction for auto checkpoints), `handoff.ts` (Markdown), `store.ts` (persistence, listing, retention, state), `paths.ts` (storage layout, project identity). |
| `src/recovery/` | `select.ts` (deterministic checkpoint choice), `compare.ts` (repository verification). |
| `src/config/` | Strict config loading and merging (defaults → global → project). |
| `src/security/` | `redact.ts` (secret patterns, sensitive paths), `sanitize.ts` (control characters, delimiter neutralization, injection heuristics). |
| `src/utils/` | Atomic writes, locking, safe reads, path validation, a small validator. |

## Key decisions

**Storage outside the plugin and the project.** `CLAUDE_PLUGIN_DATA` is deleted by `claude plugin uninstall` unless you pass `--keep-data`. That would silently delete saved work, so BRB uses `~/.brb` (or `BRB_HOME`). Storing checkpoints inside the project would risk committing them.

**Project identity = resolved git top-level path.** It is simple and deterministic, and it works without network access or a remote. Subdirectories map to the same project, and worktrees are distinct. A moved project gets a new identity. That is the trade-off for not trusting mutable data such as remotes.

**Integrity digest, not a signature.** The SHA-256 digest over canonical JSON detects truncation, bit rot and casual edits. It isn't a security boundary: anyone who can write `~/.brb` can recompute it. Security on load comes from schema validation, sanitization and the data-block contract, not from the digest.

**Resume state lives outside checkpoints.** Resume timestamps and dedupe data go in `state.json`, so checkpoints stay immutable and their digests stay valid. A corrupt `state.json` is ignored; it is advisory only.

**Locking with `mkdir`.** Exclusive directory creation is atomic on every supported OS and needs no native modules. Locks older than 30 s are treated as abandoned.

**Hooks never block.** Hooks exit 0, or 1 on failure (a non-blocking error in Claude Code). They never exit 2, which would block compaction. Every hook returns immediately when its feature is disabled, so the always-registered hooks cost one short Node process per event.

**Synchronous code.** The CLI is short-lived and runs strictly in order. Synchronous filesystem calls make the atomicity and locking easy to reason about.

## Checkpoint selection

See `src/recovery/select.ts`. In order:

1. An explicit id or unique prefix wins.
2. The pool is checkpoints from the current branch. If there are none, all checkpoints, with `branchMismatch` set.
3. The newest manual checkpoint wins if no automatic checkpoint is newer.
4. If an automatic checkpoint is newer: when the git fingerprint (HEAD plus full status) is unchanged since the manual one, the manual one wins and the automatic one is redundant. Otherwise the manual one is selected and `needsChoice` is set, so Claude asks the developer.
5. Ties are broken by `createdAt`, then `checkpointId`, so the result never depends on directory order.

## Repository verification

See `src/recovery/compare.ts`. The levels are ordered `passed < limited < changed < conflict`, and the highest finding wins.

- **conflict:** project root missing, branch changed, HEAD no longer contains the checkpoint commit, in-flight files missing, unresolved merge conflicts.
- **changed:** new commits on top, files edited after the checkpoint (content hash differs), newly changed files, files no longer changed.
- **limited:** no git at save or resume time, capped working tree, commits could not be compared.

## Testing

- `tests/unit`: pure logic (redaction, sanitization, schema, selection, parsing, filesystem primitives).
- `tests/integration`: spawns the built CLI against temporary git repositories, with an isolated `BRB_HOME`. It covers the spec's pause/resume, persistence, Auto-BRB and security scenarios (test names are prefixed with the scenario number, e.g. `S14`).
- `tests/e2e/claude-e2e.sh`: drives the real `claude` CLI with `--plugin-dir`. It is not run in CI because it needs authentication and spends tokens.
