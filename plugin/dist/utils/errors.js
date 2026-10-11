/** Error with a stable machine-readable code and an actionable message. */
export class BrbError extends Error {
    code;
    hint;
    constructor(code, message, hint) {
        super(message);
        this.name = 'BrbError';
        this.code = code;
        this.hint = hint;
    }
}
export function errorMessage(err) {
    if (err instanceof Error)
        return err.message;
    return String(err);
}
/** Node system errors carry a `code` such as ENOENT or EACCES. */
export function sysCode(err) {
    if (err && typeof err === 'object' && 'code' in err) {
        const code = err.code;
        return typeof code === 'string' ? code : undefined;
    }
    return undefined;
}
