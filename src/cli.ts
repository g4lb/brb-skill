#!/usr/bin/env node
import * as fs from 'node:fs';
import { cmdSave } from './commands/save.js';
import { cmdResume } from './commands/resume.js';
import { cmdAuto, cmdClean, cmdDelete, cmdExport, cmdList, cmdShow, cmdStatus } from './commands/manage.js';
import { cmdHook } from './commands/hook.js';
import type { CommandContext } from './commands/common.js';
import { BrbError, errorMessage, sysCode } from './utils/errors.js';
import { VERSION } from './version.js';

const HELP = `BRB — Be Right Back ${VERSION}
You leave. Your context stays.

Usage: brb <command> [options]

Commands
  save               Save a manual checkpoint. Task context JSON on stdin or --input <file>.
  resume [--id ID] [--session ID]
                     Select a checkpoint, verify the repository, print a resume briefing.
                     --session tells BRB whether background work from the checkpoint can still run.
  status             Show checkpoint and Auto-BRB status for this project.
  list               List checkpoints for this project.
  show [ID]          Print a checkpoint's handoff (newest if no ID).
  clean              Plan removal of old checkpoints (dry run). Add --yes to apply.
                     --keep-manual N (10)  --keep-auto N (config)  --older-than DAYS  --broken
  delete ID --yes    Delete one checkpoint.
  export             Print all checkpoints for this project as JSON.
  auto on|off|status Turn automatic checkpoints on or off (this project; --global for all).
  auto set <setting> on|off   Settings: before-compaction, session-end, milestone, notify, resume-hint
  auto set max N     Automatic checkpoints kept per project (1-100).
  hook <event>       Internal: entry point for Claude Code hooks.
  version            Print the version.

Common options
  --json             Machine-readable output.

Exit codes: 0 success, 1 error, 2 usage error, 3 no checkpoint found.
Storage: ~/.brb (override with BRB_HOME). Docs: README.md`;

export function realContext(): CommandContext {
  return {
    cwd: process.cwd(),
    env: process.env,
    stdout: (s) => process.stdout.write(`${s}\n`),
    stderr: (s) => process.stderr.write(`${s}\n`),
    readStdin: () => {
      if (process.stdin.isTTY) return undefined;
      try {
        return fs.readFileSync(0, 'utf8');
      } catch (err) {
        // EAGAIN/EOF on some platforms when no stdin is attached.
        if (sysCode(err) === 'EAGAIN' || sysCode(err) === 'EOF') return '';
        throw err;
      }
    },
    now: () => new Date(),
  };
}

export function run(argv: string[], ctx: CommandContext): number {
  const [cmd, ...rest] = argv;
  try {
    switch (cmd) {
      case 'save':
        return cmdSave(rest, ctx);
      case 'resume':
      case 'continue':
        return cmdResume(rest, ctx);
      case 'status':
        return cmdStatus(rest, ctx);
      case 'list':
        return cmdList(rest, ctx);
      case 'show':
        return cmdShow(rest, ctx);
      case 'clean':
        return cmdClean(rest, ctx);
      case 'delete':
        return cmdDelete(rest, ctx);
      case 'export':
        return cmdExport(rest, ctx);
      case 'auto':
        return cmdAuto(rest, ctx);
      case 'hook':
        return cmdHook(rest, ctx);
      case 'version':
      case '--version':
        ctx.stdout(VERSION);
        return 0;
      case undefined:
      case 'help':
      case '--help':
      case '-h':
        ctx.stdout(HELP);
        return 0;
      default:
        ctx.stderr(`brb: unknown command "${cmd}". Run \`brb help\`.`);
        return 2;
    }
  } catch (err) {
    if (err instanceof BrbError) {
      ctx.stderr(`BRB — ${cmd === 'save' ? 'Checkpoint could not be saved' : 'Error'}: ${err.message}`);
      if (err.hint) ctx.stderr(err.hint);
      return err.code === 'USAGE' ? 2 : 1;
    }
    const code = sysCode(err);
    const hint = code === 'EACCES' || code === 'EPERM' ? ' (permission denied — check ownership of ~/.brb or set BRB_HOME)'
      : code === 'ENOSPC' ? ' (disk full)' : code === 'EROFS' ? ' (read-only filesystem)' : '';
    ctx.stderr(`BRB — ${cmd === 'save' ? 'Checkpoint could not be saved' : 'Error'}: ${errorMessage(err)}${hint}`);
    return 1;
  }
}

const invokedDirectly = (() => {
  try {
    return process.argv[1] !== undefined && fs.realpathSync(process.argv[1]) === fs.realpathSync(new URL(import.meta.url));
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  process.exitCode = run(process.argv.slice(2), realContext());
}
