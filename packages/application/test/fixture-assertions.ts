/** Fail explicitly when a scenario's required fixture row or byte is absent. */
export function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('Required fixture value is absent');
  return value;
}
