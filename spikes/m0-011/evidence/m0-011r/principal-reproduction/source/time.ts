/** Normalize exact RFC3339 instants at an external boundary to millisecond UTC. */
export function canonicalInstant(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!parts) return null;
  const year = Number(parts[1]), month = Number(parts[2]), day = Number(parts[3]);
  const hour = Number(parts[4]), minute = Number(parts[5]), second = Number(parts[6]);
  const millisecond = Number((parts[7] ?? '').padEnd(3, '0'));
  const local = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  const check = new Date(local);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() + 1 !== month ||
      check.getUTCDate() !== day || check.getUTCHours() !== hour ||
      check.getUTCMinutes() !== minute || check.getUTCSeconds() !== second ||
      check.getUTCMilliseconds() !== millisecond) return null;
  const offsetHours = Number(parts[10] ?? '0'), offsetMinutes = Number(parts[11] ?? '0');
  if (offsetHours > 23 || offsetMinutes > 59) return null;
  const offset = (parts[9] === '-' ? -1 : 1) * (offsetHours * 60 + offsetMinutes) * 60_000;
  const time = local - offset;
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}
