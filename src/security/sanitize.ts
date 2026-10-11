/**
 * Checkpoint content is untrusted when loaded: the file may have been edited,
 * or the saved text may quote hostile input. These helpers make it safe to
 * place inside a delimited data block and flag instruction-like content.
 */

export const DATA_TAG = 'brb-checkpoint-data';

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g;
const TAG_RE = new RegExp(`<\\s*/?\\s*${DATA_TAG}`, 'gi');

/** Remove terminal escapes, control and bidi characters; neutralize our delimiter tag. */
export function sanitizeText(s: string): string {
  return s.replace(ANSI, '').replace(CONTROL, '').replace(TAG_RE, (m) => m.replace('<', '‹'));
}

/**
 * Sanitize text that is printed outside the data block (branch names, file
 * paths, project names). Git allows newlines in file names, so line breaks
 * are collapsed: one value can never start a new line of output.
 */
export function safeLine(s: string): string {
  return sanitizeText(s).replace(/[\r\n\u2028\u2029]+/g, ' ');
}

const SUSPICIOUS: { label: string; re: RegExp }[] = [
  { label: 'asks to ignore or override instructions', re: /\b(ignore|disregard|forget|override)\b[^.\n]{0,40}\b(previous|prior|above|all|system|earlier)\b[^.\n]{0,20}\b(instructions?|rules|prompts?|messages?)\b/i },
  { label: 'claims to be a system or developer message', re: /<\s*\/?\s*(system|developer|assistant)[\s>]|\bsystem prompt\b|\byou are now\b/i },
  { label: 'asks to bypass permissions or approvals', re: /\b(bypass|skip|disable|without)\b[^.\n]{0,30}\b(permission|approval|confirmation|sandbox)s?\b|--dangerously|bypassPermissions/i },
  { label: 'contains a destructive command', re: /\brm\s+-[a-z]*r[a-z]*f|\bgit\s+(reset\s+--hard|clean\s+-[a-z]*f|push\s+(-f|--force)|checkout\s+--\s+\.)|\bdrop\s+(table|database)\b|\bmkfs\b|\bdd\s+if=/i },
  { label: 'asks to send data to a remote location', re: /\b(curl|wget|Invoke-WebRequest)\b[^\n]{0,80}\b(-d|--data|-F|--upload-file|-T)\b|\b(exfiltrate|upload)\b[^.\n]{0,40}\b(secret|token|key|credential)s?\b/i },
];

/**
 * Return human-readable labels for instruction-like or dangerous content.
 * Strings are collected from any JSON-like value and sanitized first, so
 * zero-width characters or terminal escapes cannot hide a phrase from the
 * check while still rendering as that phrase.
 */
export function detectSuspicious(value: unknown): string[] {
  const parts: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === 'string') parts.push(sanitizeText(v));
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(value);
  const text = parts.join('\n');
  return SUSPICIOUS.filter(({ re }) => re.test(text)).map(({ label }) => label);
}

export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(0, max - 1))}…`;
}
