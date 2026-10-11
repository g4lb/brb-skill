# Checkpoint schema (version 2)

Each checkpoint is one JSON file in `~/.brb/projects/<name>-<hash>/checkpoints/`, named `<UTC timestamp>-<manual|auto>-<first 8 id chars>.json`. A Markdown handoff with the same base name is in `handoffs/`.

A complete real example: [`examples/checkpoint.json`](../examples/checkpoint.json). The authoritative definition is `src/checkpoint/types.ts`, and `src/checkpoint/schema.ts` enforces it.

| Field | Type | Notes |
| --- | --- | --- |
| `schemaVersion` | `2` | Required. Older versions are migrated on load. Newer versions are refused with an upgrade message. |
| `checkpointId` | UUID v4 | |
| `createdAt` | ISO-8601 UTC | |
| `type` | `"manual"` \| `"auto"` | |
| `trigger` | `"manual"` \| `"pre-compact"` \| `"session-end"` \| `"milestone"` | |
| `partial` | boolean | Manual checkpoint saved without an objective or a next action. |
| `producer` | `{ name: "brb", version }` | |
| `session.id` | string \| null | Claude Code session id, when known. |
| `project` | `{ root, identity, name }` | `identity` is the first 32 hex characters of SHA-256 of the normalized root. Loading checks that root and identity match the current project. |
| `git` | object | `{ available: false, reason }` or `{ available: true, branch, detached, head, upstream, remote, workingTree, fingerprint }`. `remote` has credentials stripped. `fingerprint` is SHA-256 of HEAD, branch and full porcelain status. |
| `git.workingTree` | object | `modified`, `added`, `deleted`, `renamed[{from,to}]`, `untracked`, `conflicted`, `staged` (project-relative paths), `total`, `truncated` (capped at 1,000 entries). |
| `task` | object | `source` (`claude` = written by Claude during /brb; `transcript` = extracted by a hook; `none`), `objective`, `completed[]`, `inProgress[]`, `remaining[]`, `nextAction`. |
| `files[]` | `{ path, note? }` | Relevant files named by Claude. Project-relative only. |
| `snapshot` | `{ files[], truncated }` | SHA-256 and size of in-flight and relevant files at save time, never content. `skipped` explains unhashed entries: `missing`, `too-large` (>5 MB), `sensitive`, `symlink`, `not-a-file`, `outside-project`, `limit`. |
| `decisions[]`, `blockers[]`, `assumptions[]` | string[] | |
| `tests[]` | `{ command, result, summary? }` | `result`: `passed`, `failed`, `partial`, `not-run`, `unknown`. |
| `environment` | object | `platform`, `nodeVersion`, `relevantTools[]`, `runningProcesses[]` (as reported by Claude; BRB does not inspect processes), `backgroundWork[]` (subagents and background commands still running at save time, which can change files after the checkpoint; added in version 2). |
| `context` | object \| null | Automatic checkpoints: `recentUserPrompts[]` (up to 5, each truncated to 1,000 chars) and `lastAssistantMessage`. |
| `notes` | string \| null | |
| `resume` | `{ instructions, warnings[] }` | |
| `redactions` | integer | How many secret-like values were replaced. |
| `integrity` | `{ algorithm: "sha256", digest }` | SHA-256 of the canonical JSON (sorted keys) of every other field. |

**Limits.** Free-text fields are capped at 4,000 characters, list items at 1,000, lists at 100 items, and relevant files at 300. Unknown fields are rejected.

## Validation on load

A file is used only if all of these pass:

1. It is a regular file (not a symlink), at most 4 MB, with a BRB file name.
2. It parses as JSON with a supported `schemaVersion`.
3. It matches the schema exactly, including path safety for every recorded path.
4. The integrity digest matches.
5. `project.root` and `project.identity` match the current project, and the file name matches the id and type.

Files that fail are listed as damaged by `/brb list` and skipped by `/brb:continue`.

## Migrations

`MIGRATIONS` in `src/checkpoint/schema.ts` maps each old version to a function that upgrades the document by one version. Before migrating, the loader checks the original document's digest, then re-seals the migrated document in memory. Migration never rewrites files on disk.

| From | To | Change |
| --- | --- | --- |
| 1 | 2 | Adds `environment.backgroundWork` as an empty list. |

When changing the schema:

1. Bump `SCHEMA_VERSION` in `src/checkpoint/types.ts`.
2. Add `MIGRATIONS[oldVersion]`.
3. Add a test that loads a stored checkpoint of the old version.
4. Document the change here and in `CHANGELOG.md`.
