/** JSON.stringify with recursively sorted object keys, for stable hashing. */
export function canonicalJson(value) {
    return JSON.stringify(sortKeys(value));
}
function sortKeys(value) {
    if (Array.isArray(value))
        return value.map(sortKeys);
    if (value && typeof value === 'object') {
        const out = {};
        for (const key of Object.keys(value).sort()) {
            const v = value[key];
            if (v !== undefined)
                out[key] = sortKeys(v);
        }
        return out;
    }
    return value;
}
export function isPlainObject(v) {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}
