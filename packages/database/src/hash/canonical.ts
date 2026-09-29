import { createHash } from 'node:crypto';

/** Object keys sort lexicographically by JavaScript code unit; array order remains semantic. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('non-finite number in JSON value');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((part) => canonicalJson(part)).join(',')}]`;
  if (typeof value === 'object') {
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
      throw new TypeError('JSON object must be plain');
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  throw new TypeError('unsupported JSON value');
}

export function sha256CanonicalJson(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

/** The root revisionContentHash is excluded to avoid a self-referential digest. */
export function revisionContentHash(value: unknown): string {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const { revisionContentHash: _ignored, ...content } = value as Record<string, unknown>;
    return sha256CanonicalJson(content);
  }
  return sha256CanonicalJson(value);
}
