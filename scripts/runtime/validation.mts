import assert from 'node:assert/strict';
export function object(value: unknown): Record<string, unknown> {
  assert(value !== null && typeof value === 'object' && !Array.isArray(value));
  return Object.fromEntries(Object.entries(value));
}
export function array(value: unknown): unknown[] {
  assert(Array.isArray(value));
  return value;
}
export function text(value: unknown): string {
  assert(typeof value === 'string');
  return value;
}
export function number(value: unknown): number {
  assert(typeof value === 'number' && Number.isFinite(value));
  return value;
}
export function required<T>(value: T | null | undefined): T {
  assert(value !== null && value !== undefined);
  return value;
}
export function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}
export function errorCode(value: unknown): unknown {
  return value && typeof value === 'object' && 'code' in value ? value.code : undefined;
}
