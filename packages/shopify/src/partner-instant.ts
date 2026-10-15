/** Normalize only instants exactly representable at the application's millisecond boundary.
 * Extra zero precision is representational; nonzero discarded digits are unavailable authority. */
export function partnerInstant(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/);
  if (!match) return null;
  const [, day, hour, minute, second, fraction = '', zone] = match;
  if (
    !day ||
    !zone ||
    Number(hour) > 23 ||
    Number(minute) > 59 ||
    Number(second) > 59 ||
    /[1-9]/.test(fraction.slice(3))
  )
    return null;
  if (zone === '-00:00' || (zone !== 'Z' && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4)) > 59))) return null;
  const calendar = new Date(`${day}T00:00:00.000Z`);
  if (!Number.isFinite(+calendar) || calendar.toISOString().slice(0, 10) !== day) return null;
  const instant = new Date(`${day}T${hour}:${minute}:${second}.${fraction.slice(0, 3).padEnd(3, '0')}${zone}`);
  if (!Number.isFinite(+instant)) return null;
  const normalized = instant.toISOString();
  return /^\d{4}-/.test(normalized) ? normalized : null;
}
