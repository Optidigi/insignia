import { isDeepStrictEqual } from 'node:util';
export function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('Required fixture value absent');
  return value;
}
export function record(value: unknown): Record<string, unknown> {
  const isRecord = (input: unknown): input is Record<string, unknown> =>
    input !== null && typeof input === 'object' && !Array.isArray(input);
  if (!isRecord(value)) throw new Error('Expected fixture object');
  return value;
}
export function jsonRecord(text: string): Record<string, unknown> {
  const value: unknown = JSON.parse(text);
  return record(value);
}
export function graphqlRequest(text: string): { query: string; variables: Record<string, unknown> } {
  const value = jsonRecord(text);
  if (typeof value.query !== 'string') throw new Error('Expected GraphQL query');
  return { ...value, query: value.query, variables: record(value.variables) };
}
export function string(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Expected fixture string');
  return value;
}
export function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('Expected fixture array');
  return value;
}

/** Decode a persisted JSON copy only when every value equals its already typed data fixture. */
export function roundTripFixture<T>(fixture: T): T {
  const value: unknown = JSON.parse(JSON.stringify(fixture));
  const matches = (input: unknown): input is T => isDeepStrictEqual(input, fixture);
  if (!matches(value)) throw new Error('Persisted fixture changed JSON meaning');
  return value;
}

export function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error('Expected fixture integer');
  return value;
}
