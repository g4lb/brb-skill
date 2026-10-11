/**
 * Best-effort secret redaction for free text stored in checkpoints.
 *
 * BRB never copies file contents into checkpoints; the text it stores comes
 * from Claude's task summary or from recent prompts in the transcript. These
 * patterns catch common credential formats. They cannot catch every secret.
 */
const RULES = [
    { name: 'private-key', re: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g },
    { name: 'aws-access-key', re: /\b(?:AKIA|ASIA|AGPA|AIDA|AROA|ANPA|ANVA|AIPA)[A-Z0-9]{16}\b/g },
    { name: 'github-token', re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{22,255})\b/g },
    { name: 'gitlab-token', re: /\bglpat-[A-Za-z0-9_-]{20,}\b/g },
    { name: 'slack-token', re: /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g },
    { name: 'slack-webhook', re: /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+/g },
    { name: 'anthropic-key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
    { name: 'openai-key', re: /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}\b/g },
    { name: 'stripe-key', re: /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g },
    { name: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
    { name: 'npm-token', re: /\bnpm_[A-Za-z0-9]{36}\b/g },
    { name: 'jwt', re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
    { name: 'bearer', re: /\b((?:Bearer|Basic)\s+)([A-Za-z0-9._~+/=-]{16,})/gi, keepPrefix: true },
    { name: 'url-credentials', re: /\b([a-z][a-z0-9+.-]*:\/\/)([^\s:/@]+:[^\s/@]+)(?=@)/gi, keepPrefix: true },
    {
        name: 'assignment',
        re: /\b((?:[A-Za-z0-9_]*(?:password|passwd|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|private[_-]?key|client[_-]?secret|auth|credential)s?["']?)\s*[:=]\s*["']?)([^\s"',;]{6,})/gi,
        keepPrefix: true,
    },
];
export function redact(input) {
    let text = input;
    let count = 0;
    for (const rule of RULES) {
        text = text.replace(rule.re, (match, prefix, secret) => {
            if (!rule.keepPrefix) {
                count++;
                return `[REDACTED:${rule.name}]`;
            }
            if (typeof secret !== 'string' || secret.startsWith('[REDACTED'))
                return match;
            count++;
            return `${String(prefix)}[REDACTED:${rule.name}]`;
        });
    }
    return { text, count };
}
/** Recursively redact every string inside a JSON-like value. */
export function redactDeep(value, counter) {
    if (typeof value === 'string') {
        const r = redact(value);
        counter.count += r.count;
        return r.text;
    }
    if (Array.isArray(value))
        return value.map((v) => redactDeep(v, counter));
    if (value && typeof value === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(value))
            out[k] = redactDeep(v, counter);
        return out;
    }
    return value;
}
/** Strip user:password from a git remote URL. */
export function sanitizeRemoteUrl(url) {
    return url.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@\s]+@/i, '$1');
}
const SENSITIVE_PATH = /(^|[\\/])(\.env(\..*)?|.*\.pem|.*\.key|.*\.p12|.*\.pfx|id_rsa.*|id_ed25519.*|\.npmrc|\.pypirc|\.netrc|credentials(\.json)?|secrets?\.(json|ya?ml|toml))$/i;
/** True for paths whose contents commonly hold credentials. BRB records such paths but never hashes them. */
export function isSensitivePath(p) {
    return SENSITIVE_PATH.test(p);
}
