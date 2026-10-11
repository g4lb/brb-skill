# Contributing to BRB

Thanks for helping. BRB is deliberately small. Before adding a feature, ask whether it makes `/brb` → leave → `/brb:continue` more reliable or safer.

## Setup

```bash
git clone https://github.com/g4lb/brb-skill.git && cd brb-skill
npm ci
npm run check        # typecheck, lint, unit and integration tests, dist verification
claude --plugin-dir ./plugin # try your changes in Claude Code
```

Requirements: Node.js 20+ and git. The E2E suite (`npm run test:e2e`) also needs an authenticated `claude` CLI, and it spends model tokens.

## Ground rules

- **No runtime dependencies.** The helper ships as plain JavaScript in `plugin/dist/`. Dev dependencies are fine, but they stay at the repository root: `plugin/` must never contain a `package.json`, or Claude Code would run `npm install` for every user.
- **Commit `plugin/dist/`.** Plugins install from git with no build step. Run `npm run build` and commit the result. CI fails if `plugin/dist/` is stale.
- **Read-only git only.** Never add a git command that changes the repository, index, stash or refs. CI checks this.
- **No network access.** CI checks this too.
- **Never block Claude Code.** Hooks must exit 0 or 1. Never 2.
- **Never invent context.** If information isn't available, record it as missing.
- **Treat checkpoints as untrusted on load.** Any new field must be validated in `schema.ts`, sanitized when printed, and covered by tests.
- **Schema changes** need a version bump and a migration. See [docs/checkpoint-schema.md](docs/checkpoint-schema.md).
- TypeScript strict mode, ESLint clean, and tests for every behavior change.

## Tests

| Suite | Command | What |
| --- | --- | --- |
| Unit | `npm run test:unit` | Pure logic |
| Unit + integration | `npm test` | Also spawns the built CLI against temp git repos |
| E2E | `npm run test:e2e` | Real Claude Code CLI with `--plugin-dir` |

Integration tests use an isolated `BRB_HOME` and temporary repositories. They never touch your real `~/.brb`.

## Pull requests

Keep PRs focused. Describe the user-visible change, update `CHANGELOG.md` under *Unreleased*, and update the docs if behavior changes. Report security issues privately (see [SECURITY.md](SECURITY.md)), not in public issues.
