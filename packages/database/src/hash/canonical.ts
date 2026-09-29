import { createHash } from 'node:crypto';

/** Object keys sort lexicographically by JavaScript code unit; array order remains semantic. */
export function canonicalJson(value: unknown): string {
  const ancestors = new WeakSet<object>();
  function serialize(part: unknown): string {
    if (part === null || typeof part === 'string' || typeof part === 'boolean') return JSON.stringify(part);
    if (typeof part === 'number') {
      if (!Number.isFinite(part)) throw new TypeError('non-finite number in JSON value');
      return JSON.stringify(part);
    }
    if (typeof part !== 'object') throw new TypeError('unsupported JSON value');
    if (ancestors.has(part)) throw new TypeError('cyclic JSON value');
    ancestors.add(part);
    try {
      if (Array.isArray(part)) {
        const items: string[] = [];
        for (let index = 0; index < part.length; index++) {
          if (!Object.hasOwn(part, index)) throw new TypeError('sparse JSON array');
          items.push(serialize(part[index]));
        }
        return `[${items.join(',')}]`;
      }
      if (Object.getPrototypeOf(part) !== Object.prototype && Object.getPrototypeOf(part) !== null)
        throw new TypeError('JSON object must be plain');
      const keys = Object.keys(part).sort();
      return `{${keys.map((key) => `${JSON.stringify(key)}:${serialize((part as Record<string, unknown>)[key])}`).join(',')}}`;
    } finally {
      ancestors.delete(part);
    }
  }
  return serialize(value);
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
