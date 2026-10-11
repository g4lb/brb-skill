# Changelog

All notable changes to this project are documented here. This project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.1.0] — 2026-10-11

### Fixed

- Pausing while background work ran (a subagent or a background command) saved a checkpoint that showed the repository as settled. That work kept changing files after the checkpoint, and `/brb continue` then reported its edits as unexplained changes. When the background work finished, Claude could also continue the task while the developer was away.

### Added

- `backgroundWork` in the task context. `/brb` records running background work and shows `! Background … still running; files may change after this checkpoint`.
- `brb resume --session <id>`. The resume briefing says whether background work from the checkpoint can still run (same session) or stopped with the earlier session (new session; `NEEDS INPUT`), and explains changes it made.
- The pause skill tells Claude not to continue the task when a background task finishes after the pause.
- Hook status messages. Claude Code shows its spinner with a BRB message while a BRB hook runs (for example "⏸ BRB · tucking your work into a checkpoint before compaction…").

### Changed

- Checkpoint schema version 2 (adds `environment.backgroundWork`). Version 1 checkpoints are migrated on load. BRB 1.0.0 refuses version 2 checkpoints with an upgrade message.

Verified against Claude Code 2.1.289.

## [1.0.0] — 2026-10-11

First stable release. Install with `/plugin marketplace add g4lb/brb-skill` then `/plugin install brb@brb`, or skills only with `npx skills add g4lb/brb-skill`.

### Changed

- The installable plugin lives in `plugin/` with no `package.json`, so installing never runs `npm install` (it previously pulled ~47 MB of development dependencies).
- The helper is bundled into `scripts/brb.mjs` inside each skill folder, and skills reference it with `${CLAUDE_SKILL_DIR}`.

### Added

- Plugin hook `post-bash` (PostToolUse on Bash, filtered with `if: Bash(node *brb.mjs*)`) shows a one-line BRB status in the terminal after save/resume, independent of the model.
- Step-by-step status output for save and resume (✓ ! ✗ – marks, timing, aligned columns). The skills announce themselves before running, label their terminal progress line "BRB · …", and show the helper's status block verbatim.
- Install with the skills CLI: `npx skills add g4lb/brb-skill` (skills only; Auto-BRB requires the plugin install).

## [1.0.0-rc.1] — 2026-10-11

First release candidate.

### Added

- `/brb`: pause and save a structured checkpoint (objective, completed, in progress, remaining, next action, decisions, blockers, assumptions, tests, relevant files, reported processes, notes) plus a Markdown handoff.
- `/brb:continue`: deterministic checkpoint selection, validation, repository verification (branch, commits, rewritten history, changed and edited files, conflicts), and a resume briefing that wraps checkpoint data as untrusted.
- `/brb status | list | show | clean | delete | export | auto`.
- Auto-BRB (off by default): checkpoints on `PreCompact`, `SessionEnd` and (optionally) task completion, with dedupe, retention for automatic checkpoints only, and manual-checkpoint protection.
- Resume hint at session start (metadata only).
- Versioned checkpoint schema (v1) with integrity digest and a migration framework.
- Secret redaction, sensitive-path skipping, symlink and traversal protection, atomic writes, per-project locking.
- Unit, integration and Claude Code end-to-end tests. CI on Linux, macOS and Windows.

### Known limitations (still apply in 1.0.0)

- Windows: unit and integration tests pass in CI, but `/brb`, resume and the Auto-BRB hooks have not been exercised by hand inside Claude Code on Windows.
- As a plugin, resume is `/brb:continue` (`/brb continue` works everywhere).

Verified against Claude Code 2.1.289.
