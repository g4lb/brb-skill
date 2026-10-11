# Changelog

All notable changes to this project are documented here. This project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

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

### Known limitations

- Claude Code's built-in `/continue` takes that name, so resume is `/brb:continue`.
- Windows hook execution not yet verified end to end in Claude Code.

Verified against Claude Code 2.1.289.
