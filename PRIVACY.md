# Privacy policy

_Last updated: 2026-10-11 · Applies to BRB (Be Right Back) by g4lb_

**Short version:** BRB collects nothing, sends nothing anywhere, and has no servers. Everything it saves stays on your computer.

## What BRB stores

When you run `/brb`, or when you turn on Auto-BRB and it runs, BRB writes a checkpoint to a folder on your own machine: `~/.brb`, or the folder set in `BRB_HOME`. A checkpoint can contain:

- The task summary Claude writes for you: objective, progress, next step, decisions, blockers, test results, relevant file paths and notes.
- Repository metadata: branch, commit hash, the names of changed files, and SHA-256 fingerprints of those files. BRB never stores file contents.
- For automatic checkpoints only: up to five recent prompts from the session and the last assistant message, shortened.

Before saving, BRB replaces text that looks like a secret (API keys, tokens, passwords and similar) with `[REDACTED]`. It does not record the contents of sensitive files such as `.env` or private keys. This filtering is best effort and can't catch every secret.

## What BRB does not do

- It has no network access: no telemetry, no analytics, no crash reports and no update checks.
- It never uploads or shares checkpoints. Only you and the programs on your machine can read them. Files are created readable only by your user account.
- It never changes your code, your git history or your Claude settings.

Claude Code itself sends your conversation, including checkpoint content that Claude reads, to Anthropic as part of normal use. That is covered by Anthropic's own terms and privacy policy, not by this one.

## Your control

- See your checkpoints with `/brb list`, and export them with `/brb export`.
- Delete them with `/brb delete <id>` or `/brb clean`, or remove the `~/.brb` folder.
- Uninstalling BRB does not delete your checkpoints. Remove `~/.brb` yourself if you want them gone.

## Contact

Questions: open an issue at https://github.com/g4lb/brb-skill/issues or email galevgi@gmail.com.
