import assert from 'node:assert/strict';
import { releaseProfile } from './profiles.mts';
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function object(value: unknown): Record<string, unknown> {
  assert(isRecord(value), 'Object required');
  return value;
}
export function text(value: unknown): string {
  assert(typeof value === 'string', 'String required');
  return value;
}
export function array(value: unknown): unknown[] {
  assert(Array.isArray(value), 'Array required');
  return value;
}
export function number(value: unknown): number {
  assert(typeof value === 'number' && Number.isFinite(value), 'Finite number required');
  return value;
}
export function boolean(value: unknown): boolean {
  assert(typeof value === 'boolean', 'Boolean required');
  return value;
}
export function required<T>(value: T | null | undefined): T {
  assert(value !== null && value !== undefined, 'Required boundary value absent');
  return value;
}
export function json(value: string): unknown {
  return JSON.parse(value);
}
export function expectedVersion(profileName?: string): string {
  return releaseProfile(profileName).versionId;
}
/** SDK code is independently byte-pinned; observations still enter as unknown.
 * Keep original method receivers rather than copying class methods out of their client. */
export function method(receiver: unknown, name: string): (...args: unknown[]) => unknown {
  const fn = object(receiver)[name];
  assert(typeof fn === 'function', `Expected SDK method ${name}`);
  return (...args: unknown[]): unknown => fn.apply(receiver, args);
}
export function callable(value: unknown): (...args: unknown[]) => unknown {
  assert(typeof value === 'function', 'Expected SDK callable');
  return (...args: unknown[]): unknown => value(...args);
}
