# Releasing

BRB follows [Semantic Versioning](https://semver.org/). Breaking changes include: an incompatible checkpoint schema without a migration, changed command syntax, and changed config keys.

The version appears in four places, and `npm run verify:dist` fails if they disagree:
`package.json`, `plugin/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `src/version.ts`.

## Release checklist

1. [ ] `main` is green in CI on Linux, macOS and Windows.
2. [ ] Bump the version in all four places (for example `1.0.0-rc.1` → `1.0.0`).
3. [ ] `npm run build` and commit `plugin/skills/*/scripts/brb.mjs`. Plugins and skills install from git with no build step.
4. [ ] Update `CHANGELOG.md`.
5. [ ] `npm run check`: typecheck, lint, unit and integration tests, dist verification.
6. [ ] `npm run validate:plugin` (validates the marketplace and the plugin)
7. [ ] `npm run test:e2e` against the current Claude Code release. Record the Claude Code version in the changelog.
8. [ ] Fresh install test in an isolated config:
   ```bash
   export CLAUDE_CONFIG_DIR="$(mktemp -d)"
   claude plugin marketplace add g4lb/brb-skill      # or a local path
   claude plugin install brb@brb
   claude plugin list                          # brb@brb enabled
   claude plugin uninstall brb@brb
   ls ~/.brb                                   # checkpoints still there
   ```
9. [ ] On Windows, run `/brb` and `/brb:continue` once by hand, and trigger `/compact` with Auto-BRB on.
10. [ ] Commit, then create an annotated tag: `git tag -a v<version> -m "BRB v<version>"`. The Release workflow expects the `v<version>` form.
11. [ ] Push the commit and the tag (`git push origin main && git push origin v<version>`), then run the **Release** workflow:
    ```bash
    gh workflow run release.yml -f version=<version> --ref v<version>
    gh run watch "$(gh run list --workflow release.yml --limit 1 --json databaseId --jq '.[0].databaseId')" --exit-status
    ```
    It re-runs `npm run check` on the tag and uploads `brb-<version>.tgz` as an artifact. It does **not** create the release.
12. [ ] Create the release from your own account, so you are its author (not `github-actions[bot]`):
    ```bash
    gh run download "$(gh run list --workflow release.yml --limit 1 --json databaseId --jq '.[0].databaseId')" -n brb-<version>
    gh release create v<version> brb-<version>.tgz --verify-tag --title "BRB v<version>" --notes-file <notes.md>
    ```
    Write the notes from the `CHANGELOG.md` section. Add `--draft` to review on GitHub before publishing.
13. [ ] Optional: submit to a Claude Code plugin marketplace, following its current publication requirements.

Never publish, push or tag from automation without a maintainer's explicit decision.
