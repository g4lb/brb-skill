import { isPlainObject } from './json.js';

/** Minimal structural validator. Collects every problem with its JSON path. */
export class Validator {
  readonly errors: string[] = [];

  fail(path: string, msg: string): void {
    if (this.errors.length < 50) this.errors.push(`${path || '<root>'}: ${msg}`);
  }

  object(v: unknown, path: string, allowed?: readonly string[]): v is Record<string, unknown> {
    if (!isPlainObject(v)) {
      this.fail(path, 'expected an object');
      return false;
    }
    if (allowed) {
      for (const k of Object.keys(v)) {
        if (!allowed.includes(k)) this.fail(`${path}.${k}`, `unknown field (allowed: ${allowed.join(', ')})`);
      }
    }
    return true;
  }

  string(v: unknown, path: string, opts: { max?: number; nullable?: boolean; pattern?: RegExp; optional?: boolean } = {}): boolean {
    if (v === undefined && opts.optional) return true;
    if (v === null && opts.nullable) return true;
    if (typeof v !== 'string') {
      this.fail(path, opts.nullable ? 'expected a string or null' : 'expected a string');
      return false;
    }
    if (opts.max !== undefined && v.length > opts.max) {
      this.fail(path, `longer than ${opts.max} characters`);
      return false;
    }
    if (opts.pattern && !opts.pattern.test(v)) {
      this.fail(path, 'has an invalid format');
      return false;
    }
    return true;
  }

  boolean(v: unknown, path: string): boolean {
    if (typeof v !== 'boolean') {
      this.fail(path, 'expected true or false');
      return false;
    }
    return true;
  }

  integer(v: unknown, path: string, min: number, max: number, opts: { nullable?: boolean } = {}): boolean {
    if (v === null && opts.nullable) return true;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
      this.fail(path, `expected an integer from ${min} to ${max}`);
      return false;
    }
    return true;
  }

  oneOf<T extends string>(v: unknown, path: string, values: readonly T[]): v is T {
    if (typeof v !== 'string' || !values.includes(v as T)) {
      this.fail(path, `expected one of: ${values.join(', ')}`);
      return false;
    }
    return true;
  }

  array(v: unknown, path: string, maxItems: number, item: (el: unknown, p: string) => void): boolean {
    if (!Array.isArray(v)) {
      this.fail(path, 'expected an array');
      return false;
    }
    if (v.length > maxItems) {
      this.fail(path, `more than ${maxItems} items`);
      return false;
    }
    v.forEach((el, i) => item(el, `${path}[${i}]`));
    return true;
  }

  stringArray(v: unknown, path: string, maxItems: number, maxLen: number): boolean {
    return this.array(v, path, maxItems, (el, p) => this.string(el, p, { max: maxLen }));
  }

  get ok(): boolean {
    return this.errors.length === 0;
  }
}
