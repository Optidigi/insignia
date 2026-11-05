import assert from 'node:assert/strict';
export function required<T>(value: T | null | undefined): T { assert.ok(value !== null && value !== undefined); return value; }
export function record(value: unknown): Record<string, unknown> { assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value)); return value as Record<string, unknown>; }
export function jsonRecord(value: string): Record<string, unknown> { return record(JSON.parse(value)); }
export function text(value: unknown): string { assert.equal(typeof value, 'string'); return value as string; }
export function array(value: unknown): unknown[] { assert.ok(Array.isArray(value)); return value; }
export function number(value: unknown): number { assert.equal(typeof value, 'number'); assert.ok(Number.isFinite(value)); return value as number; }
