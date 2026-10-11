import { spawn, spawnSync, execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export const CLI = path.resolve('dist', 'cli.js');

export function tmpDir(prefix = 'brb-test-'): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

export function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'user.name=BRB Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', ...args], {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** A git repository with one commit on `main`. */
export function makeRepo(): string {
  const dir = tmpDir('brb-repo-');
  git(dir, 'init', '-q');
  fs.writeFileSync(path.join(dir, 'README.md'), '# test\n');
  fs.writeFileSync(path.join(dir, 'app.js'), 'console.log(1);\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'init');
  return dir;
}

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function cleanEnv(home: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.BRB_HOOK_ACTIVE;
  delete env.BRB_DEBUG;
  delete env.CLAUDE_PROJECT_DIR;
  return { ...env, BRB_HOME: home, ...extra };
}

export function brb(cwd: string, home: string, args: string[], input?: string, extraEnv: Record<string, string> = {}): CliResult {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd, env: cleanEnv(home, extraEnv), input: input ?? '', encoding: 'utf8', timeout: 60_000,
  });
  return { code: r.status ?? -1, stdout: r.stdout, stderr: r.stderr };
}

export function brbAsync(cwd: string, home: string, args: string[], input?: string): Promise<CliResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], { cwd, env: cleanEnv(home) });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
    child.stdin.end(input ?? '');
  });
}

export const TASK = {
  objective: 'Implement authentication',
  completed: ['Login flow', 'Token storage'],
  inProgress: ['Token refresh'],
  remaining: ['Logout'],
  nextAction: 'Finish token refresh handling in src/auth.ts',
  decisions: ['Use httpOnly cookies'],
  tests: [{ command: 'npm test', result: 'failed', summary: '1 failing: refresh expiry' }],
  files: [{ path: 'app.js', note: 'entry point' }],
};

export function save(cwd: string, home: string, task: unknown = TASK, extra: string[] = []): CliResult {
  return brb(cwd, home, ['save', ...extra], JSON.stringify(task));
}

export function checkpointFiles(home: string): string[] {
  const projects = path.join(home, 'projects');
  if (!fs.existsSync(projects)) return [];
  const out: string[] = [];
  for (const p of fs.readdirSync(projects)) {
    const dir = path.join(projects, p, 'checkpoints');
    if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir)) out.push(path.join(dir, f));
  }
  return out.sort();
}

export function readJson(file: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
}

/** Write a minimal Claude Code-style transcript. */
export function writeTranscript(dir: string, entries: unknown[]): string {
  const file = path.join(dir, 'session.jsonl');
  fs.writeFileSync(file, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
  return file;
}

export function userEntry(text: string, timestamp = new Date().toISOString(), extra: Record<string, unknown> = {}): unknown {
  return { type: 'user', timestamp, message: { role: 'user', content: text }, ...extra };
}

export function hookInput(cwd: string, event: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ session_id: 'sess-1', cwd, hook_event_name: event, ...extra });
}

export const isWindows = process.platform === 'win32';
export const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
