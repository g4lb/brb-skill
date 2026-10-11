# Platform research notes (Phase 1)

These notes record what Claude Code supports, as verified while building BRB 1.0 against Claude Code 2.1.289 (October 2026). They also record which BRB features depend on each capability. Sources: the official docs at code.claude.com (skills, hooks, plugins, marketplaces), the `claude plugin --help` output, and direct experiments with `claude -p --plugin-dir`.

## Verified directly

| Capability | Finding | How it was verified |
| --- | --- | --- |
| Plugin skills as slash commands | `skills/<name>/SKILL.md` in plugin `brb` becomes `/brb:<name>`. The bare `/<name>` also works unless another command already uses the name. | `/brb status` and `/brb:continue` ran through `claude -p --plugin-dir`. |
| `/continue` | In non-interactive `claude -p`, `/continue` (like `/resume`) is reported as "isn't available in this environment". **In an interactive session, a standalone skill named `continue` (skills-CLI install) does run on `/continue`.** Plugin installs expose the skill as `/brb:continue`. `/brb continue` works in every mode. | `claude -p` experiment; interactive `/continue` ran BRB's skill on 2026-10-11 |
| Skill substitutions | `${CLAUDE_SKILL_DIR}`, `${CLAUDE_SESSION_ID}` and `$ARGUMENTS` are substituted in skill content, both for plugin skills and for standalone skills in `.claude/skills/`. | E2E in both install modes; the session id was recorded in a saved checkpoint. |
| Skills CLI (`npx skills add`) | Discovers skills through `.claude-plugin/marketplace.json`, copies each skill folder (including `scripts/`) into `.claude/skills/<name>/`, and does not install hooks. It reports anonymous install telemetry for public repositories, which is how skills.sh lists them. Opt out with `DISABLE_TELEMETRY=1`. | Isolated install test with telemetry off |
| Natural-language activation | "I need to leave, be right back" made Claude invoke the `brb` skill. | E2E session 1 |
| `SessionStart` `additionalContext` | Injected into Claude's context. | E2E: Claude quoted the hint. |
| `PreCompact` hook | Fires for `/compact`. The input has `session_id`, `transcript_path`, `cwd`, `trigger`. | E2E: an automatic `pre-compact` checkpoint was created. |
| `SessionEnd` hook | Fires in `-p` mode with `reason: "other"`. The docs list `prompt_input_exit` for non-interactive exits, but in practice `other` was reported. | `BRB_DEBUG=1` hook log |
| Uninstall data deletion | `claude plugin uninstall` removes the plugin data directory (`~/.claude/plugins/data/<id>/`) unless `--keep-data` is passed. | `claude plugin uninstall --help` |
| Marketplace install | `claude plugin marketplace add <path or owner/repo>` then `claude plugin install brb@brb` installs and enables the plugin. | Isolated `CLAUDE_CONFIG_DIR` experiment |
| `claude plugin validate --strict` | Passes for the marketplace (repository root) and the plugin (`plugin/`). | Local run |
| Dependency install | Claude Code runs `npm install` (including dev dependencies) in an installed plugin that has a `package.json`. BRB's plugin folder therefore has none. | Fresh install from GitHub produced a 47 MB `node_modules` before the layout change |
| Transcript format | JSONL with `type: user/assistant`, `message.content`, `isMeta`, `isSidechain`, `isCompactSummary`, `timestamp`; task tools `TodoWrite` (`input.todos`) and `TaskCreate`/`TaskUpdate` (results contain `Task #N created`). **The docs state that this format is internal and may change.** | Local transcripts |

| Hook `systemMessage` display | PostToolUse `systemMessage` is shown to the user. Claude Code prefixes **each line** with `PostToolUse:Bash says:`, so BRB sends one line. The `if` filter (`Bash(node *brb.mjs*)`) limits the hook to BRB's own commands. | stream-json `system/informational` event |
| Skill message ordering | Asked to post a status message before continuing, Sonnet and Opus in `claude -p` often skip it and summarize only at the end. The pre-tool announcement line is followed reliably. The hook line makes the status visible regardless. | Repeated `claude -p` runs |

## From documentation (not independently exercised)

- Hook exit code 2 blocks `PreCompact`. BRB never uses it.
- `SessionEnd` hooks share a 1.5-second budget by default, raised by a longer per-hook `timeout` up to 60 seconds. They are not killed on exit.
- Default hook timeout is 600 s for command hooks.
- `PostToolUse` input includes `tool_name`, `tool_input` and `tool_response`.
- Hook JSON output `systemMessage` is shown to the user.
- Skill `!`command`` injection aborts the whole skill if the command exits non-zero. BRB doesn't use injection: the skills run the helper as normal Bash calls, so standard permission prompts apply.

## Not supported / not implemented

| Requested | Status |
| --- | --- |
| Detecting crashes, power loss, killed terminals | No hook fires reliably. Auto-BRB can't recover these. Use `/brb` or keep Auto-BRB's other triggers on. |
| Generic "task completion" detection | Approximated only by task-list completion (`onMilestone`, off by default). |
| Asking Claude to summarize from a hook | Hooks run outside the model turn. Automatic checkpoints are extractive and never invent objectives. |
| Inspecting OS processes | Not done. BRB records only the processes Claude reports. |
| Bare `/continue` for the plugin install | Not verified interactively; documented as `/brb:continue`. |
