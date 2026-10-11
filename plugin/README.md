# BRB — Be Right Back

**You leave. Your context stays.**

- `/brb` saves a checkpoint: your objective, what's done, what's left, the exact next step, decisions, test results and repository state.
- `/brb:continue` (or "I'm back") loads it in any session. It checks the repository for new commits, branch switches and files edited while you were away, then continues the task.
- `/brb status`, `/brb list` and `/brb clean` manage your checkpoints.
- `/brb auto on` saves checkpoints automatically before context compaction and at session end. It is off by default.

Everything stays local in `~/.brb`. BRB makes no network calls, never commits, pushes or deletes your work, and redacts secret-looking values before saving.

Requires Node.js 20 or later. Docs, privacy and source: https://github.com/g4lb/brb-skill
