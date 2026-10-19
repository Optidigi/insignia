import assert from 'node:assert/strict';

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function object(value: unknown): Record<string, unknown> {
  assert.ok(isObject(value), 'object required');
  return value;
}
export function jsonRecord(text: string): Record<string, unknown> {
  const value: unknown = JSON.parse(text);
  return object(value);
}
export function requiredEnv(name: string): string {
  const value = process.env[name];
  assert.ok(value, `Required fixture environment: ${name}`);
  return value;
}
