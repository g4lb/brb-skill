import { isPlainObject } from './json.js';
/** Minimal structural validator. Collects every problem with its JSON path. */
export class Validator {
    errors = [];
    fail(path, msg) {
        if (this.errors.length < 50)
            this.errors.push(`${path || '<root>'}: ${msg}`);
    }
    object(v, path, allowed) {
        if (!isPlainObject(v)) {
            this.fail(path, 'expected an object');
            return false;
        }
        if (allowed) {
            for (const k of Object.keys(v)) {
                if (!allowed.includes(k))
                    this.fail(`${path}.${k}`, `unknown field (allowed: ${allowed.join(', ')})`);
            }
        }
        return true;
    }
    string(v, path, opts = {}) {
        if (v === undefined && opts.optional)
            return true;
        if (v === null && opts.nullable)
            return true;
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
    boolean(v, path) {
        if (typeof v !== 'boolean') {
            this.fail(path, 'expected true or false');
            return false;
        }
        return true;
    }
    integer(v, path, min, max, opts = {}) {
        if (v === null && opts.nullable)
            return true;
        if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
            this.fail(path, `expected an integer from ${min} to ${max}`);
            return false;
        }
        return true;
    }
    oneOf(v, path, values) {
        if (typeof v !== 'string' || !values.includes(v)) {
            this.fail(path, `expected one of: ${values.join(', ')}`);
            return false;
        }
        return true;
    }
    array(v, path, maxItems, item) {
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
    stringArray(v, path, maxItems, maxLen) {
        return this.array(v, path, maxItems, (el, p) => this.string(el, p, { max: maxLen }));
    }
    get ok() {
        return this.errors.length === 0;
    }
}
