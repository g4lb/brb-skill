# Changelog

All notable changes to this project are documented here. This project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
