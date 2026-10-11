# Configuration

BRB works with no configuration. Settings exist only for Auto-BRB and the resume hint.

## Changing settings

Use the commands. They validate and write the file atomically:

```text
/brb auto on                         # enable for this project
/brb auto off
/brb auto status
/brb auto on --global                # enable for all projects
/brb auto set before-compaction off  # before-compaction | session-end | milestone | notify  → on|off
/brb auto set max 20                 # automatic checkpoints kept per project (1-100)
/brb auto set resume-hint off
```

## Files

| Scope | Path |
| --- | --- |
| Global | `~/.brb/config.json` |
| Project | `~/.brb/projects/<name>-<hash>/config.json` (`/brb status` prints the folder) |

They are merged in this order: built-in defaults, then global, then project. A project setting overrides a global one, key by key.

## Schema

```json
{
  "autoBRB": {
    "enabled": false,
    "beforeCompaction": true,
    "onSessionEnd": true,
    "onMilestone": false,
    "maxCheckpoints": 10,
    "notifyOnCheckpoint": true
  },
  "resumeHint": true
}
```

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `autoBRB.enabled` | boolean | `false` | Master switch for automatic checkpoints. |
| `autoBRB.beforeCompaction` | boolean | `true` | Save on the `PreCompact` hook (manual `/compact` and automatic compaction). |
| `autoBRB.onSessionEnd` | boolean | `true` | Save on the `SessionEnd` hook. |
| `autoBRB.onMilestone` | boolean | `false` | Save when a task in Claude's task list (`TodoWrite`/`TaskUpdate`) is marked completed. At most one per 10 minutes per session. |
| `autoBRB.maxCheckpoints` | integer 1–100 | `10` | Automatic checkpoints kept per project. Older ones are pruned after each automatic save. Manual checkpoints are never counted or pruned. |
| `autoBRB.notifyOnCheckpoint` | boolean | `true` | Return a one-line `systemMessage` when an automatic checkpoint is saved. It isn't shown for session end, because the session is closing. |
| `resumeHint` | boolean | `true` | At session start (`startup`/`clear`), add one line of context when an unresumed checkpoint under 14 days old exists. |

Validation is strict. Unknown keys, wrong types and out-of-range values are errors. **If any config file is invalid, Auto-BRB is treated as off** until the file is fixed, and `/brb status` shows the error.

`autoBRB` here is BRB's own file format. It isn't a Claude Code setting and doesn't go in `.claude/settings.json`.

## Environment variables

| Variable | Effect |
| --- | --- |
| `BRB_HOME` | Absolute path for all BRB data, instead of `~/.brb`. |
| `BRB_DEBUG=1` | Hooks append each payload's metadata (event, session id, reason, source; never tool input) to `<BRB_HOME>/logs/hooks-debug.log`. |
| `BRB_HOOK_ACTIVE` | Set internally while a hook runs, to prevent recursion. Don't set it yourself. |

## Hook registration

The plugin always registers its hooks (`hooks/hooks.json`). The hooks read the config and exit at once when their feature is off. To remove even that overhead, disable the plugin with `claude plugin disable brb@brb`.

| Hook | Matcher | Timeout | Command |
| --- | --- | --- | --- |
| `PreCompact` | all | 30 s | `brb hook pre-compact` |
| `SessionEnd` | all | 10 s | `brb hook session-end` |
| `SessionStart` | `startup\|clear\|compact` | 10 s | `brb hook session-start` |
| `PostToolUse` | `TodoWrite\|TaskUpdate` | 10 s | `brb hook post-tool-use` |

Claude Code gives all `SessionEnd` hooks a shared 1.5-second budget by default. Declaring a 10-second timeout raises that budget (up to Claude Code's 60-second maximum).
