import * as os from 'node:os';
import { safeLine } from '../security/sanitize.js';

/** Step marks: done, needs attention, failed/missing, not applicable. */
export type Mark = '✓' | '!' | '✗' | '–';

const LABEL_WIDTH = 12;
const INDENT = '  ';

/** One aligned progress step: `  ✓ Label       detail`. */
export function step(mark: Mark, label: string, detail: string): string {
  return `${INDENT}${mark} ${label.padEnd(LABEL_WIDTH)} ${safeLine(detail)}`;
}

/** A detail line under the previous step, aligned with its detail column. */
export function sub(detail: string): string {
  return `${INDENT}  ${' '.repeat(LABEL_WIDTH)} ${safeLine(detail)}`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Show paths under the home directory as ~/… */
export function tildePath(p: string): string {
  const home = os.homedir();
  return home && p.startsWith(home) ? `~${p.slice(home.length)}` : p;
}

export function elapsed(startMs: number): string {
  const ms = Math.max(0, Math.round(performance.now() - startMs));
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}
